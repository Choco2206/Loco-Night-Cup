'use strict';

const { updateEventData } = require('../events/event-repository');
const { findTeamById, isTeamMember } = require('../teams/team-service');

const ROUND_ORDER = ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];
const MATCH_STATUSES = ['open', 'pending_confirmation', 'admin_decision_required', 'confirmed', 'locked'];

function nowIso() {
  return new Date().toISOString();
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

function isTeamParticipant(participant) {
  return participant?.type === 'team' && participant.teamId;
}

function isRealMatch(match) {
  return isTeamParticipant(match?.home) && isTeamParticipant(match?.away);
}

function getRound(event, roundKey) {
  return event.knockout?.rounds?.[roundKey] || null;
}

function getMatches(round) {
  return round?.matches || [];
}

function findMatch(round, matchId) {
  return getMatches(round).find(match => String(match.id) === String(matchId)) || null;
}

function normalizeMatch(match) {
  if (!match) return match;
  if (!MATCH_STATUSES.includes(match.status)) match.status = isRealMatch(match) ? 'open' : 'locked';
  match.reports = Array.isArray(match.reports) ? match.reports : [];
  if (match.result === undefined) match.result = null;
  return match;
}

function normalizeRound(round) {
  for (const match of getMatches(round)) normalizeMatch(match);
}

function getUserParticipantKeysForMatch(match, userId) {
  return [match.home, match.away]
    .filter(isTeamParticipant)
    .filter(participant => isTeamMember(findTeamById(participant.teamId), userId))
    .map(participantKey);
}

function getUserSelectableMatches(round, userId) {
  normalizeRound(round);
  return getMatches(round)
    .filter(isRealMatch)
    .filter(match => match.status === 'open' || match.status === 'pending_confirmation')
    .map(match => ({
      match,
      participantKeys: getUserParticipantKeysForMatch(match, userId),
    }))
    .filter(entry => entry.participantKeys.length > 0);
}

function getAdminSelectableMatches(round) {
  normalizeRound(round);
  return getMatches(round).filter(isRealMatch);
}

function parseGoals(value, label) {
  const clean = String(value || '').trim();
  if (!/^\d{1,2}$/.test(clean)) throw new Error(`${label} muss eine Zahl zwischen 0 und 99 sein.`);
  return Number(clean);
}

function assertNoDraw(homeGoals, awayGoals) {
  if (Number(homeGoals) === Number(awayGoals)) {
    throw new Error('In der K.O.-Phase ist kein Unentschieden erlaubt. Spielt Verlaengerung und Elfmeterschiessen, bis ein Sieger feststeht.');
  }
}

function reportsMatch(first, second) {
  return Number(first.homeGoals) === Number(second.homeGoals)
    && Number(first.awayGoals) === Number(second.awayGoals);
}

function chooseWinner(match, homeGoals, awayGoals) {
  return Number(homeGoals) > Number(awayGoals)
    ? { winner: match.home, loser: match.away }
    : { winner: match.away, loser: match.home };
}

function setNextParticipant(rounds, target, participant) {
  if (!target || !participant) return false;
  const targetRound = rounds[target.roundKey];
  const targetMatch = findMatch(targetRound, target.matchId);
  if (!targetMatch || !['home', 'away'].includes(target.side)) return false;
  targetMatch[target.side] = cloneParticipant(participant);
  if (isRealMatch(targetMatch) && targetMatch.status === 'locked') {
    targetMatch.status = 'open';
    targetMatch.release = { ...(targetMatch.release || {}), releasedAt: targetMatch.release?.releasedAt || nowIso() };
  }
  targetMatch.meta = { ...(targetMatch.meta || {}), updatedAt: nowIso() };
  return true;
}

function applyConfirmedResult(event, match, { homeGoals, awayGoals, source, actorUserId }) {
  assertNoDraw(homeGoals, awayGoals);
  const timestamp = nowIso();
  const { winner, loser } = chooseWinner(match, homeGoals, awayGoals);
  match.status = 'confirmed';
  match.result = {
    homeGoals: Number(homeGoals),
    awayGoals: Number(awayGoals),
    confirmedAt: timestamp,
    source,
    adminUserId: source === 'admin' ? String(actorUserId) : null,
  };
  match.winner = cloneParticipant(winner);
  match.loser = cloneParticipant(loser);
  match.meta = { ...(match.meta || {}), updatedAt: timestamp };

  const rounds = event.knockout?.rounds || {};
  setNextParticipant(rounds, match.next, match.winner);
  setNextParticipant(rounds, match.loserNext, match.loser);
  updateRoundStatuses(event);
  updatePlacementsIfReady(event);
}

function applyReports(event, match) {
  const uniqueReports = [];
  for (const report of match.reports || []) {
    if (!uniqueReports.some(entry => entry.participantKey === report.participantKey)) uniqueReports.push(report);
  }

  if (uniqueReports.length < 2) {
    match.status = 'pending_confirmation';
    match.result = null;
    return;
  }

  const [first, second] = uniqueReports;
  if (!reportsMatch(first, second)) {
    match.status = 'admin_decision_required';
    match.result = null;
    return;
  }

  applyConfirmedResult(event, match, {
    homeGoals: Number(first.homeGoals),
    awayGoals: Number(first.awayGoals),
    source: 'teams',
    actorUserId: first.submittedByUserId,
  });
}

function updateRoundStatuses(event) {
  for (const roundKey of ROUND_ORDER) {
    const round = event.knockout?.rounds?.[roundKey];
    if (!round?.matches?.length) {
      if (round) round.status = 'not_needed';
      continue;
    }
    if (round.matches.every(match => match.status === 'confirmed')) {
      round.status = 'completed';
      round.completedAt = round.completedAt || nowIso();
      continue;
    }
    if (round.matches.some(match => match.status === 'admin_decision_required')) {
      round.status = 'admin_decision_required';
      continue;
    }
    if (round.matches.some(match => isRealMatch(match) && ['open', 'pending_confirmation'].includes(match.status))) {
      round.status = 'open';
      continue;
    }
    round.status = 'locked';
  }
}

function setCeremonyReady(event, placements, timestamp) {
  event.ceremony = event.ceremony || {};
  event.ceremony.status = 'ready';
  event.ceremony.placements = {
    ...(event.ceremony.placements || {}),
    firstTeamId: placements.first?.teamId || null,
    secondTeamId: placements.second?.teamId || null,
    thirdTeamId: placements.third?.teamId || null,
    fourthTeamId: placements.fourth?.teamId || null,
  };
  event.ceremony.readyAt = event.ceremony.readyAt || timestamp;
}

function updatePlacementsIfReady(event) {
  const finalMatch = event.knockout?.rounds?.final?.matches?.[0];
  const thirdPlaceMatch = event.knockout?.rounds?.third_place?.matches?.[0];
  if (!finalMatch || finalMatch.status !== 'confirmed') return false;
  if (thirdPlaceMatch && thirdPlaceMatch.status !== 'confirmed') return false;

  const timestamp = nowIso();
  const placements = {
    first: finalMatch.winner || null,
    second: finalMatch.loser || null,
    third: thirdPlaceMatch?.winner || null,
    fourth: thirdPlaceMatch?.loser || null,
  };

  event.knockout.placements = {
    ...placements,
    firstTeamId: placements.first?.teamId || null,
    secondTeamId: placements.second?.teamId || null,
    thirdTeamId: placements.third?.teamId || null,
    fourthTeamId: placements.fourth?.teamId || null,
    decidedAt: event.knockout.placements?.decidedAt || timestamp,
    source: event.knockout.placements?.source || 'results',
  };
  event.knockout.status = 'completed';
  event.knockout.completedAt = event.knockout.completedAt || timestamp;
  event.status = 'ceremony';
  setCeremonyReady(event, placements, timestamp);
  return true;
}

function submitTeamResult({ eventKey, roundKey, matchId, participantKeyValue, userId, homeGoals, awayGoals }) {
  let outcome;
  const parsedHome = parseGoals(homeGoals, 'Heimtore');
  const parsedAway = parseGoals(awayGoals, 'Auswaertstore');
  assertNoDraw(parsedHome, parsedAway);

  updateEventData(eventKey, event => {
    const round = getRound(event, roundKey);
    if (!round) throw new Error('K.O.-Runde wurde nicht gefunden.');
    normalizeRound(round);

    const match = findMatch(round, matchId);
    if (!match || !isRealMatch(match)) throw new Error('K.O.-Spiel wurde nicht gefunden.');
    if (!['open', 'pending_confirmation'].includes(match.status)) throw new Error('Dieses K.O.-Spiel kann aktuell nicht gemeldet werden.');
    const validKeys = [participantKey(match.home), participantKey(match.away)];
    if (!validKeys.includes(participantKeyValue)) throw new Error('Du darfst dieses K.O.-Spiel nicht melden.');
    if (!getUserParticipantKeysForMatch(match, userId).includes(participantKeyValue)) throw new Error('Du bist fuer dieses Team nicht berechtigt.');

    const report = {
      participantKey: participantKeyValue,
      submittedByUserId: String(userId),
      homeGoals: parsedHome,
      awayGoals: parsedAway,
      submittedAt: nowIso(),
    };
    match.reports = (match.reports || []).filter(entry => entry.participantKey !== participantKeyValue);
    match.reports.push(report);
    applyReports(event, match);
    match.meta = { ...(match.meta || {}), updatedAt: nowIso() };
    event.meta = { ...(event.meta || {}), updatedAt: nowIso() };
    outcome = { event, round, match, status: match.status, completed: event.knockout.status === 'completed' };
    return event;
  });

  return outcome;
}

function setAdminResult({ eventKey, roundKey, matchId, adminUserId, homeGoals, awayGoals }) {
  let outcome;
  const parsedHome = parseGoals(homeGoals, 'Heimtore');
  const parsedAway = parseGoals(awayGoals, 'Auswaertstore');
  assertNoDraw(parsedHome, parsedAway);

  updateEventData(eventKey, event => {
    const round = getRound(event, roundKey);
    if (!round) throw new Error('K.O.-Runde wurde nicht gefunden.');
    normalizeRound(round);

    const match = findMatch(round, matchId);
    if (!match || !isRealMatch(match)) throw new Error('K.O.-Spiel wurde nicht gefunden.');

    match.reports = [];
    match.adminDecision = {
      setByUserId: String(adminUserId),
      setAt: nowIso(),
    };
    applyConfirmedResult(event, match, {
      homeGoals: parsedHome,
      awayGoals: parsedAway,
      source: 'admin',
      actorUserId: adminUserId,
    });
    event.meta = { ...(event.meta || {}), updatedAt: nowIso() };
    outcome = { event, round, match, status: match.status, completed: event.knockout.status === 'completed' };
    return event;
  });

  return outcome;
}

module.exports = {
  getAdminSelectableMatches,
  getMatches,
  getUserSelectableMatches,
  isRealMatch,
  participantKey,
  setAdminResult,
  submitTeamResult,
  updatePlacementsIfReady,
  updateRoundStatuses,
};
