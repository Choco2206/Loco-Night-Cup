'use strict';

const { updateEventData } = require('../events/event-repository');
const { findTeamById, isTeamMember } = require('../teams/team-service');
const { rankGroupRows } = require('./group-ranking');

const REAL_MATCH_STATUSES = ['open', 'pending_confirmation', 'admin_decision_required', 'confirmed'];
const RESULT_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000;

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

function isRealMatch(match) {
  return match?.home?.type === 'team' && match?.away?.type === 'team';
}

function isTeamVsByeMatch(match) {
  const participantTypes = [match?.home?.type, match?.away?.type];
  return participantTypes.includes('team') && participantTypes.includes('bye');
}

function isAdminScorableMatch(match) {
  return isRealMatch(match) || isTeamVsByeMatch(match);
}

function getGroup(event, groupKey) {
  if (String(groupKey).toLowerCase() === 'league' && event.leaguePhase?.phaseType === 'league') return event.leaguePhase;
  return event.groups?.groups?.[groupKey] || null;
}

function getMatches(group) {
  return (group.matchdays || []).flatMap(matchday => matchday.matches || []);
}

function findMatch(group, matchId) {
  return getMatches(group).find(match => String(match.id) === String(matchId)) || null;
}

function getMatchSlot(match) {
  return Number(match.matchday || match.release?.slot || 0);
}

function isMatchReleased(match) {
  if (!isRealMatch(match)) return false;
  return Boolean(match.release?.releasedAt);
}

function getCurrentReleasedSlot(group) {
  const slots = [...new Set(getMatches(group)
    .filter(isRealMatch)
    .map(getMatchSlot)
    .filter(Boolean))]
    .sort((a, b) => a - b);

  for (const slot of slots) {
    const slotMatches = getMatches(group).filter(match => isRealMatch(match) && getMatchSlot(match) === slot);
    if (!slotMatches.length) continue;
    if (!slotMatches.some(isMatchReleased)) continue;
    if (!slotMatches.every(match => match.status === 'confirmed')) return slot;
  }

  return null;
}

function normalizeMatchState(match) {
  if (!isRealMatch(match)) {
    match.reports = Array.isArray(match.reports) ? match.reports : [];
    const hasConfirmedAdminScore = isTeamVsByeMatch(match)
      && match.status === 'confirmed'
      && Number.isFinite(Number(match.result?.homeGoals))
      && Number.isFinite(Number(match.result?.awayGoals));
    if (hasConfirmedAdminScore) return match;
    match.status = 'bye';
    match.result = null;
    return match;
  }

  if (!REAL_MATCH_STATUSES.includes(match.status)) match.status = 'open';
  match.reports = Array.isArray(match.reports) ? match.reports : [];
  if (match.result === undefined) match.result = null;
  return match;
}

function normalizeGroupMatches(group) {
  for (const match of getMatches(group)) {
    normalizeMatchState(match);
  }
}

function isParticipantInMatch(match, participantKeyValue) {
  return [participantKey(match.home), participantKey(match.away)].includes(participantKeyValue);
}

function getUserParticipantKeysForMatch(match, userId) {
  return [match.home, match.away]
    .filter(participant => participant?.type === 'team')
    .filter(participant => isTeamMember(findTeamById(participant.teamId), userId))
    .map(participantKey);
}

function getUserSelectableMatches(group, userId) {
  normalizeGroupMatches(group);
  const currentSlot = getCurrentReleasedSlot(group);
  if (!currentSlot) return [];
  return getMatches(group)
    .filter(match => isRealMatch(match))
    .filter(isMatchReleased)
    .filter(match => getMatchSlot(match) === currentSlot)
    .filter(match => ['open', 'pending_confirmation'].includes(match.status))
    .map(match => ({
      match,
      participantKeys: getUserParticipantKeysForMatch(match, userId),
    }))
    .filter(entry => entry.participantKeys.length > 0);
}

function getAdminSelectableMatches(group) {
  normalizeGroupMatches(group);
  const matches = getMatches(group).filter(match => isAdminScorableMatch(match));
  if (group.phaseType === 'league') return matches.filter(match => getMatchSlot(match) === Number(group.currentMatchday || 0));
  return matches;
}

function parseGoals(value, label) {
  const clean = String(value || '').trim();
  if (!/^\d{1,2}$/.test(clean)) throw new Error(`${label} muss eine Zahl zwischen 0 und 99 sein.`);
  return Number(clean);
}

function reportsMatch(first, second) {
  return Number(first.homeGoals) === Number(second.homeGoals)
    && Number(first.awayGoals) === Number(second.awayGoals);
}

function applyReports(match) {
  const uniqueParticipantReports = [];
  for (const report of match.reports || []) {
    if (!uniqueParticipantReports.some(entry => entry.participantKey === report.participantKey)) {
      uniqueParticipantReports.push(report);
    }
  }

  if (uniqueParticipantReports.length < 2) {
    match.status = 'pending_confirmation';
    match.result = null;
    const firstReport = uniqueParticipantReports[0];
    match.confirmation = {
      ...(match.confirmation || {}),
      startedAt: match.confirmation?.startedAt || firstReport?.submittedAt || nowIso(),
      expiresAt: match.confirmation?.expiresAt || new Date(Date.now() + RESULT_CONFIRMATION_TIMEOUT_MS).toISOString(),
    };
    return;
  }

  match.confirmation = null;

  const [first, second] = uniqueParticipantReports;
  if (reportsMatch(first, second)) {
    match.status = 'confirmed';
    match.result = {
      homeGoals: Number(first.homeGoals),
      awayGoals: Number(first.awayGoals),
      confirmedAt: nowIso(),
      source: 'teams',
    };
    return;
  }

  match.status = 'admin_decision_required';
  match.result = null;
}

function createStanding(slot) {
  return {
    slot: slot.slot,
    participantKey: slot.participantKey || participantKey(slot),
    teamId: slot.teamId,
    byeId: slot.byeId,
    type: slot.type,
    displayName: slot.displayName || findTeamById(slot.teamId)?.clubName || slot.teamId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function addResult(row, goalsFor, goalsAgainst) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  row.goalDifference = row.goalsFor - row.goalsAgainst;
  if (goalsFor > goalsAgainst) {
    row.wins += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

function recalculateGroupStandings(group) {
  const rows = (group.slots || [])
    .filter(slot => group.phaseType === 'league' ? ['team', 'bye'].includes(slot.type) : slot.type === 'team')
    .map(createStanding);
  const byKey = new Map(rows.map(row => [row.participantKey, row]));

  for (const match of getMatches(group)) {
    if (!isAdminScorableMatch(match) || match.status !== 'confirmed' || !match.result) continue;
    const homeRow = byKey.get(participantKey(match.home));
    const awayRow = byKey.get(participantKey(match.away));
    if (homeRow) addResult(homeRow, Number(match.result.homeGoals), Number(match.result.awayGoals));
    if (awayRow) addResult(awayRow, Number(match.result.awayGoals), Number(match.result.homeGoals));
  }

  group.standings = rows;
  group.standings = rankGroupRows(group);
  return rows;
}

function isGroupComplete(group) {
  normalizeGroupMatches(group);
  const scorableMatches = getMatches(group).filter(isAdminScorableMatch);
  return scorableMatches.every(match => match.status === 'confirmed');
}

function updateGroupCompletion(event, group) {
  if (!isGroupComplete(group)) return false;

  if (group.phaseType === 'league') {
    group.allMatchesConfirmedAt = group.allMatchesConfirmedAt || nowIso();
    return true;
  }

  const timestamp = nowIso();
  group.completedAt = group.completedAt || timestamp;
  group.status = 'completed';

  const allGroupsComplete = Object.values(event.groups?.groups || {}).every(isGroupComplete);
  if (allGroupsComplete) {
    event.groups.status = 'completed';
    event.groups.completedAt = event.groups.completedAt || timestamp;
  }

  return true;
}

function submitTeamResult({ eventKey, groupKey, matchId, participantKeyValue, userId, homeGoals, awayGoals }) {
  let outcome;

  updateEventData(eventKey, event => {
    const group = getGroup(event, groupKey);
    if (!group) throw new Error('Gruppe wurde nicht gefunden.');
    normalizeGroupMatches(group);

    const match = findMatch(group, matchId);
    if (!match || !isRealMatch(match)) throw new Error('Spiel wurde nicht gefunden.');
    if (!isMatchReleased(match) || getMatchSlot(match) !== getCurrentReleasedSlot(group)) throw new Error('Dieses Spiel ist noch nicht freigegeben.');
    if (!['open', 'pending_confirmation'].includes(match.status)) throw new Error('Dieses Spiel kann aktuell nicht gemeldet werden.');
    if (!isParticipantInMatch(match, participantKeyValue)) throw new Error('Du darfst dieses Spiel nicht melden.');
    if (!getUserParticipantKeysForMatch(match, userId).includes(participantKeyValue)) throw new Error('Du bist fuer dieses Team nicht berechtigt.');

    const report = {
      participantKey: participantKeyValue,
      submittedByUserId: String(userId),
      homeGoals: parseGoals(homeGoals, 'Heimtore'),
      awayGoals: parseGoals(awayGoals, 'Auswaertstore'),
      submittedAt: nowIso(),
    };

    match.reports = (match.reports || []).filter(entry => entry.participantKey !== participantKeyValue);
    match.reports.push(report);
    applyReports(match);
    match.meta = { ...(match.meta || {}), updatedAt: nowIso() };

    recalculateGroupStandings(group);
    const completed = updateGroupCompletion(event, group);
    event.meta = { ...(event.meta || {}), updatedAt: nowIso() };
    outcome = { event, group, match, completed, status: match.status };
    return event;
  });

  return outcome;
}

function setAdminResult({ eventKey, groupKey, matchId, adminUserId, homeGoals, awayGoals }) {
  let outcome;

  updateEventData(eventKey, event => {
    const group = getGroup(event, groupKey);
    if (!group) throw new Error('Gruppe wurde nicht gefunden.');
    normalizeGroupMatches(group);

    const match = findMatch(group, matchId);
    if (!match || !isAdminScorableMatch(match)) throw new Error('Spiel wurde nicht gefunden.');

    match.reports = [];
    match.confirmation = null;
    match.result = {
      homeGoals: parseGoals(homeGoals, 'Heimtore'),
      awayGoals: parseGoals(awayGoals, 'Auswaertstore'),
      confirmedAt: nowIso(),
      source: 'admin',
      adminUserId: String(adminUserId),
    };
    match.status = 'confirmed';
    match.adminDecision = {
      setByUserId: String(adminUserId),
      setAt: nowIso(),
    };
    match.meta = { ...(match.meta || {}), updatedAt: nowIso() };

    recalculateGroupStandings(group);
    const completed = updateGroupCompletion(event, group);
    event.meta = { ...(event.meta || {}), updatedAt: nowIso() };
    outcome = { event, group, match, completed, status: match.status };
    return event;
  });

  return outcome;
}

function autoConfirmFirstReport({ eventKey, groupKey, matchId, now = new Date() }) {
  let outcome = null;
  updateEventData(eventKey, event => {
    const group = getGroup(event, groupKey);
    const match = group ? findMatch(group, matchId) : null;
    const reports = match?.reports || [];
    const expiresAt = match?.confirmation?.expiresAt ? new Date(match.confirmation.expiresAt) : null;
    if (!match || match.status !== 'pending_confirmation' || reports.length !== 1) return event;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || now.getTime() < expiresAt.getTime()) return event;

    const report = reports[0];
    match.status = 'confirmed';
    match.result = {
      homeGoals: Number(report.homeGoals),
      awayGoals: Number(report.awayGoals),
      confirmedAt: now.toISOString(),
      source: 'team_timeout',
      submittedByUserId: report.submittedByUserId,
    };
    match.confirmation = null;
    match.meta = { ...(match.meta || {}), updatedAt: now.toISOString() };
    recalculateGroupStandings(group);
    const completed = updateGroupCompletion(event, group);
    event.meta = { ...(event.meta || {}), updatedAt: now.toISOString() };
    outcome = { event, group, match, completed, status: match.status };
    return event;
  });
  return outcome;
}

module.exports = {
  autoConfirmFirstReport,
  getAdminSelectableMatches,
  getCurrentReleasedSlot,
  getMatches,
  getMatchSlot,
  getUserSelectableMatches,
  isAdminScorableMatch,
  isGroupComplete,
  isMatchReleased,
  isRealMatch,
  isTeamVsByeMatch,
  participantKey,
  recalculateGroupStandings,
  setAdminResult,
  submitTeamResult,
  updateGroupCompletion,
};

