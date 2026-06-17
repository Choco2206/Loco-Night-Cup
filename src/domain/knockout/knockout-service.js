'use strict';

const { readEventData, updateEventData } = require('../events/event-repository');
const { buildKnockoutRounds } = require('./knockout-bracket');
const { qualifyTeams } = require('./knockout-qualification');
const { upsertKnockoutPost } = require('./knockout-posts');

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
  if (event.groups?.status !== 'completed') {
    throw new Error('Die K.O.-Phase kann erst erstellt werden, wenn die Gruppenphase abgeschlossen ist.');
  }
  if (event.knockout?.status && event.knockout.status !== 'not_created') {
    throw new Error('Die K.O.-Phase wurde fuer dieses Event bereits erstellt.');
  }
}

function buildKnockoutState({ eventKey, event, actorUserId = null, now = new Date() }) {
  assertCanCreateKnockout(event);
  const timestamp = nowIso(now);
  const qualification = qualifyTeams(event);
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
    round.messageId = refs.messageId || round.messageId || null;
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

  const post = await upsertKnockoutPost({ client, guild, eventKey, event: result.event });
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
