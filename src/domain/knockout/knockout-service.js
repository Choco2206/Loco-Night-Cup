'use strict';

const { readEventData, updateEventData } = require('../events/event-repository');
const { refreshLiveSchedule } = require('../live-schedule');
const { buildKnockoutRounds } = require('./knockout-bracket');
const { qualifyTeams } = require('./knockout-qualification');
const { qualifyLeagueTopEight } = require('../league-phase/league-phase-results');
const { upsertKnockoutPost } = require('./knockout-posts');
const { upsertBomberRound32Post } = require('./bomber-x-loco-round32-post');
const { isBomberXLocoEvent } = require('../events/bomber-x-loco-config');

function nowIso(now = new Date()) {
  return now.toISOString();
}

function createEmptyPlacements() {
  return {
    firstTeamId: null,
    secondTeamId: null,
    thirdTeamId: null,
    fourthTeamId: null,
  };
}

function assertCanCreateKnockout(event) {
  const leagueComplete = event.leaguePhase?.phaseType === 'league' && event.leaguePhase?.status === 'completed';
  if (!leagueComplete && event.groups?.status !== 'completed') {
    throw new Error('Die K.O.-Phase kann erst erstellt werden, wenn die Gruppenphase abgeschlossen ist.');
  }
  if (event.knockout?.status && event.knockout.status !== 'not_created') {
    throw new Error('Die K.O.-Phase wurde für dieses Event bereits erstellt.');
  }
}

function buildKnockoutState({ eventKey, event, actorUserId = null, now = new Date() }) {
  assertCanCreateKnockout(event);
  const timestamp = nowIso(now);
  const leagueMode = event.leaguePhase?.phaseType === 'league';
  const leagueQualified = leagueMode ? qualifyLeagueTopEight(event) : null;
  if (leagueMode && leagueQualified.length !== 8) throw new Error('Die Ligaphase benötigt 8 echte Teams für das Viertelfinale.');
  const qualification = leagueMode ? { qualifiedTeams: leagueQualified, rule: 'league_top_8' } : qualifyTeams(event);
  const bracket = buildKnockoutRounds({
    eventKey,
    qualifiedTeams: qualification.qualifiedTeams,
    createdAt: timestamp,
  });

  return {
    status: 'created',
    createdAt: timestamp,
    createdByUserId: actorUserId ? String(actorUserId) : null,
    firstRoundKey: bracket.firstRoundKey,
    categoryId: null,
    overviewChannelId: null,
    overviewMessageId: null,
    channelId: null,
    messageId: null,
    source: {
      qualifiedRule: qualification.rule,
      avoidSameGroupRematches: true,
      groupCompletedAt: event.groups?.completedAt || null,
      leagueCompletedAt: event.leaguePhase?.completedAt || null,
    },
    qualifiedTeams: qualification.qualifiedTeams,
    rounds: bracket.rounds,
    placements: createEmptyPlacements(),
    meta: {
      updatedAt: timestamp,
    },
  };
}

function applyPostRefs(event, post) {
  if (!post) return;

  event.knockout.categoryId = post.categoryId || event.knockout.categoryId || null;
  event.knockout.overviewChannelId = post.overviewChannelId || event.knockout.overviewChannelId || null;
  event.knockout.overviewMessageId = post.overviewMessageId || event.knockout.overviewMessageId || null;
  event.knockout.channelId = event.knockout.overviewChannelId;
  event.knockout.messageId = event.knockout.overviewMessageId;

  for (const [roundKey, refs] of Object.entries(post.roundPosts || {})) {
    const round = event.knockout.rounds?.[roundKey];
    if (!round) continue;
    round.channelId = refs.channelId || round.channelId || null;
    round.videoChannelId = refs.videoChannelId || round.videoChannelId || null;
    round.messageId = refs.messageId || round.messageId || null;
    round.resultsChannelId = refs.resultsChannelId || round.resultsChannelId || null;
    round.resultsMessageId = refs.resultsMessageId || round.resultsMessageId || null;
  }
}

async function createKnockoutPhase({ eventKey, actorUserId = null, client = null, guild = null, now = new Date() }) {
  let result;

  updateEventData(eventKey, event => {
    const knockout = buildKnockoutState({ eventKey, event, actorUserId, now });
    event.status = 'knockout';
    event.knockout = knockout;
    event.meta = {
      ...(event.meta || {}),
      updatedAt: knockout.createdAt,
    };
    result = { event, knockout };
    return event;
  });

  let post = await upsertKnockoutPost({ client, guild, eventKey, event: result.event });
  if (post) {
    updateEventData(eventKey, event => {
      applyPostRefs(event, post);
      event.knockout.meta = {
        ...(event.knockout.meta || {}),
        updatedAt: nowIso(),
      };
      event.meta = {
        ...(event.meta || {}),
        updatedAt: nowIso(),
      };
      result = { event, knockout: event.knockout, post };
      return event;
    });
  }

  const currentAfterBasePost = readEventData(eventKey);
  const needsRound32Post = isBomberXLocoEvent(currentAfterBasePost)
    && currentAfterBasePost.knockout?.rounds?.round_of_32?.matches?.length > 0
    && currentAfterBasePost.knockout.rounds.round_of_32.status !== 'not_needed';

  if (needsRound32Post) {
    const round32Post = await upsertBomberRound32Post({
      client,
      guild,
      eventKey,
      event: currentAfterBasePost,
    });

    if (round32Post) {
      updateEventData(eventKey, event => {
        const round = event.knockout?.rounds?.round_of_32;
        if (round) {
          round.channelId = round32Post.channelId || round.channelId || null;
          round.messageId = round32Post.messageId || round.messageId || null;
          round.resultsChannelId = round32Post.resultsChannelId || round.resultsChannelId || null;
          round.resultsMessageId = round32Post.resultsMessageId || round.resultsMessageId || null;
        }
        event.knockout.meta = { ...(event.knockout.meta || {}), updatedAt: nowIso() };
        event.meta = { ...(event.meta || {}), updatedAt: nowIso() };
        result = { event, knockout: event.knockout, post };
        return event;
      });

      post = {
        ...(post || {}),
        roundPosts: {
          ...(post?.roundPosts || {}),
          round_of_32: round32Post,
        },
      };
    }
  }

  await refreshLiveSchedule(client, eventKey, readEventData(eventKey)).catch(error => {
    console.warn(`[live-schedule] Refresh nach K.O.-Erstellung für ${eventKey} fehlgeschlagen: ${error.message}`);
  });

  if (client) {
    const { syncPhaseInfoChannels } = require('../tournament-leadership');
    await syncPhaseInfoChannels(client, eventKey).catch(error => {
      console.warn(`[tournament-leadership] K.O.-Info-Kanäle für ${eventKey} konnten nicht synchronisiert werden: ${error.message}`);
    });
  }

  return {
    ...result,
    event: readEventData(eventKey),
    post,
  };
}

module.exports = {
  buildKnockoutState,
  createKnockoutPhase,
};
