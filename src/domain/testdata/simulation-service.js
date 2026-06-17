'use strict';

const { updateEventData } = require('../events/event-repository');
const { refreshGroupPosts } = require('../groups/group-posts');
const {
  getMatches,
  isRealMatch,
  recalculateGroupStandings,
  updateGroupCompletion,
} = require('../groups/group-results');
const { maybePostHallOfFameCeremony } = require('../ceremony');
const { upsertKnockoutPost } = require('../knockout/knockout-posts');

const KNOCKOUT_ROUND_ORDER = ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];

function nowIso() {
  return new Date().toISOString();
}

function randomGoals() {
  return Math.floor(Math.random() * 6);
}

function randomGroupResult() {
  return {
    homeGoals: randomGoals(),
    awayGoals: randomGoals(),
  };
}

function randomKnockoutResult() {
  let homeGoals = randomGoals();
  let awayGoals = randomGoals();
  if (homeGoals === awayGoals) {
    if (Math.random() >= 0.5) homeGoals += 1;
    else awayGoals += 1;
  }
  return { homeGoals, awayGoals };
}

function isTeamParticipant(participant) {
  return participant?.type === 'team' && participant.teamId;
}

function isByeParticipant(participant) {
  return participant?.type === 'bye';
}

function isResolvableKnockoutMatch(match) {
  const homeTeam = isTeamParticipant(match.home);
  const awayTeam = isTeamParticipant(match.away);
  if (homeTeam && awayTeam) return true;
  if (homeTeam && isByeParticipant(match.away)) return true;
  if (awayTeam && isByeParticipant(match.home)) return true;
  return false;
}

function participantKey(participant) {
  if (!participant) return null;
  if (participant.participantKey) return participant.participantKey;
  if (participant.type === 'team') return `team:${participant.teamId}`;
  if (participant.type === 'bye') return `bye:${participant.byeId}`;
  return null;
}

function cloneParticipant(participant) {
  return participant ? JSON.parse(JSON.stringify(participant)) : null;
}

function completeGroupMatch(match, actorUserId, timestamp) {
  const result = randomGroupResult();
  match.status = 'confirmed';
  match.result = {
    homeGoals: result.homeGoals,
    awayGoals: result.awayGoals,
    confirmedAt: timestamp,
    source: 'test_simulation',
    adminUserId: String(actorUserId),
  };
  match.reports = [];
  match.confirmedBy = [participantKey(match.home), participantKey(match.away)].filter(Boolean);
  match.adminDecision = {
    setByUserId: String(actorUserId),
    setAt: timestamp,
    reason: 'test_simulation',
  };
  match.meta = { ...(match.meta || {}), updatedAt: timestamp };
}

async function refreshGroups(client, eventKey, event) {
  if (!client) return;
  for (const group of Object.values(event.groups?.groups || {})) {
    await refreshGroupPosts({ client, eventKey, event, group }).catch(error => {
      console.error(`Gruppen-Simulation: Gruppe ${group.groupKey} konnte nicht aktualisiert werden.`, error);
    });
  }
}

async function simulateGroupPhase({ eventKey, actorUserId, client }) {
  let outcome;
  const timestamp = nowIso();

  updateEventData(eventKey, event => {
    const groups = event.groups?.groups || {};
    const groupList = Object.values(groups);
    if (!groupList.length) throw new Error('Fuer dieses Event existieren keine Gruppen.');

    let simulatedMatches = 0;
    for (const group of groupList) {
      for (const match of getMatches(group)) {
        if (!isRealMatch(match)) continue;
        completeGroupMatch(match, actorUserId, timestamp);
        simulatedMatches += 1;
      }
      recalculateGroupStandings(group);
      updateGroupCompletion(event, group);
    }

    if (simulatedMatches === 0) throw new Error('Es wurden keine echten Gruppenspiele gefunden.');

    event.groups.status = 'completed';
    event.groups.completedAt = event.groups.completedAt || timestamp;
    event.status = 'groups';
    event.meta = { ...(event.meta || {}), updatedAt: timestamp };
    outcome = { event, simulatedMatches, groups: groupList.length };
    return event;
  });

  await refreshGroups(client, eventKey, outcome.event);
  return outcome;
}

function chooseWinner(match, result) {
  if (isTeamParticipant(match.home) && isTeamParticipant(match.away)) {
    return result.homeGoals > result.awayGoals
      ? { winner: match.home, loser: match.away }
      : { winner: match.away, loser: match.home };
  }
  if (isTeamParticipant(match.home)) return { winner: match.home, loser: match.away || null };
  if (isTeamParticipant(match.away)) return { winner: match.away, loser: match.home || null };
  return { winner: null, loser: null };
}

function setNextParticipant(rounds, target, participant) {
  if (!target || !participant) return false;
  const targetRound = rounds[target.roundKey];
  const targetMatch = (targetRound?.matches || []).find(match => String(match.id) === String(target.matchId));
  if (!targetMatch || !['home', 'away'].includes(target.side)) return false;
  targetMatch[target.side] = cloneParticipant(participant);
  targetMatch.meta = { ...(targetMatch.meta || {}), updatedAt: nowIso() };
  return true;
}

function completeKnockoutMatch(match, actorUserId, timestamp) {
  const result = isTeamParticipant(match.home) && isTeamParticipant(match.away)
    ? randomKnockoutResult()
    : {
      homeGoals: isTeamParticipant(match.home) ? 1 : 0,
      awayGoals: isTeamParticipant(match.away) ? 1 : 0,
    };
  const { winner, loser } = chooseWinner(match, result);
  if (!winner) return false;

  match.status = 'confirmed';
  match.result = {
    homeGoals: result.homeGoals,
    awayGoals: result.awayGoals,
    confirmedAt: timestamp,
    source: 'test_simulation',
    adminUserId: String(actorUserId),
  };
  match.reports = [];
  match.winner = cloneParticipant(winner);
  match.loser = cloneParticipant(loser);
  match.adminDecision = {
    setByUserId: String(actorUserId),
    setAt: timestamp,
    reason: 'test_simulation',
  };
  match.meta = { ...(match.meta || {}), updatedAt: timestamp };
  return true;
}

function updateRoundStatus(round) {
  if (!round?.matches?.length) {
    if (round) round.status = 'not_needed';
    return;
  }

  if (round.matches.every(match => match.status === 'confirmed')) {
    round.status = 'completed';
    round.completedAt = round.completedAt || nowIso();
    return;
  }

  if (round.matches.some(isResolvableKnockoutMatch)) {
    round.status = 'open';
    return;
  }

  round.status = 'locked';
}

function applyPlacements(event, timestamp) {
  const finalMatch = event.knockout?.rounds?.final?.matches?.[0];
  const thirdPlaceMatch = event.knockout?.rounds?.third_place?.matches?.[0];
  const first = finalMatch?.winner || null;
  const second = finalMatch?.loser || null;
  const third = thirdPlaceMatch?.winner || null;
  const fourth = thirdPlaceMatch?.loser || null;

  event.knockout.placements = {
    first,
    second,
    third,
    fourth,
    firstTeamId: first?.teamId || null,
    secondTeamId: second?.teamId || null,
    thirdTeamId: third?.teamId || null,
    fourthTeamId: fourth?.teamId || null,
    decidedAt: timestamp,
    source: 'test_simulation',
  };

  event.ceremony = event.ceremony || {};
  if (event.ceremony.status !== 'posted') event.ceremony.status = 'ready';
  event.ceremony.placements = {
    ...(event.ceremony.placements || {}),
    firstTeamId: first?.teamId || null,
    secondTeamId: second?.teamId || null,
    thirdTeamId: third?.teamId || null,
    fourthTeamId: fourth?.teamId || null,
  };
  event.ceremony.readyAt = event.ceremony.readyAt || timestamp;
}

async function simulateKnockoutPhase({ eventKey, actorUserId, client, guild = null }) {
  let outcome;
  const timestamp = nowIso();

  updateEventData(eventKey, event => {
    if (!event.knockout || event.knockout.status === 'not_created') {
      throw new Error('Fuer dieses Event existiert noch keine K.O.-Phase.');
    }

    const rounds = event.knockout.rounds || {};
    let simulatedMatches = 0;

    for (const roundKey of KNOCKOUT_ROUND_ORDER) {
      const round = rounds[roundKey];
      if (!round?.matches?.length || round.status === 'not_needed') continue;

      for (const match of round.matches) {
        if (match.status === 'confirmed') continue;
        if (!isResolvableKnockoutMatch(match)) continue;

        if (!completeKnockoutMatch(match, actorUserId, timestamp)) continue;
        simulatedMatches += 1;
        setNextParticipant(rounds, match.next, match.winner);
        setNextParticipant(rounds, match.loserNext, match.loser);
      }

      updateRoundStatus(round);
    }

    for (const roundKey of KNOCKOUT_ROUND_ORDER) updateRoundStatus(rounds[roundKey]);

    const finalMatch = rounds.final?.matches?.[0];
    const thirdPlaceMatch = rounds.third_place?.matches?.[0];
    if (!finalMatch || finalMatch.status !== 'confirmed') throw new Error('K.O.-Simulation konnte das Finale nicht abschliessen.');
    if (thirdPlaceMatch && thirdPlaceMatch.status !== 'confirmed') throw new Error('K.O.-Simulation konnte Platz 3 nicht abschliessen.');

    event.knockout.status = 'completed';
    event.knockout.completedAt = event.knockout.completedAt || timestamp;
    applyPlacements(event, timestamp);
    event.status = 'ceremony';
    event.meta = { ...(event.meta || {}), updatedAt: timestamp };
    outcome = { event, simulatedMatches, placements: event.knockout.placements };
    return event;
  });

  const post = await upsertKnockoutPost({ client, guild, eventKey, event: outcome.event });
  const ceremony = await maybePostHallOfFameCeremony({ guild, eventKey }).catch(error => {
    console.warn(`K.O.-Simulation: Hall of Fame konnte nicht automatisch gepostet werden: ${error.message}`);
    return { posted: false, reason: 'error', error };
  });
  return { ...outcome, post, ceremony };
}

module.exports = {
  simulateGroupPhase,
  simulateKnockoutPhase,
};
