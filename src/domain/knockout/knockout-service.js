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
      event.knockout.channelId = post.channelId;
      event.knockout.messageId = post.messageId;
      for (const round of Object.values(event.knockout.rounds || {})) {
        if (round.matches?.length) round.channelId = post.channelId;
        if (round.roundKey === event.knockout.firstRoundKey) round.messageId = post.messageId;
      }
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
