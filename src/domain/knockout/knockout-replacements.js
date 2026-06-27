'use strict';

const { readEventData, updateEventData } = require('../events/event-repository');
const { isTeamOrUserBanned } = require('../bans');
const { findTeamById, isValidTournamentTeam, listVisibleTeams } = require('../teams/team-service');
const { participantKey, updatePlacementsIfReady, updateRoundStatuses } = require('./knockout-results');

const ROUND_ORDER = ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];

function nowIso(now = new Date()) {
  return now.toISOString();
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function isTeamParticipant(participant) {
  return participant?.type === 'team' && participant.teamId;
}

function isRealMatch(match) {
  return isTeamParticipant(match?.home) && isTeamParticipant(match?.away);
}

function participantLabel(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'placeholder') return participant.displayName || 'TBD';
  if (participant.type === 'team') return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId;
  return participant.displayName || 'TBD';
}

function getRound(event, roundKey) {
  return event.knockout?.rounds?.[roundKey] || null;
}

function getMatch(round, matchId) {
  return (round?.matches || []).find(match => String(match.id) === String(matchId)) || null;
}

function getTargetMatch(event, target) {
  if (!target) return null;
  return getMatch(getRound(event, target.roundKey), target.matchId);
}

function targetHasConcreteParticipant(event, target) {
  const match = getTargetMatch(event, target);
  if (!match || !['home', 'away'].includes(target.side)) return false;
  return isTeamParticipant(match[target.side]);
}

function assertReplacementAllowed(event, match, side) {
  if (!match) throw new Error('K.O.-Match wurde nicht gefunden.');
  if (!['home', 'away'].includes(side)) throw new Error('Zu ersetzende Match-Seite wurde nicht gefunden.');
  if (!isTeamParticipant(match[side])) throw new Error('Dieser Slot enthaelt kein ersetzbares Team.');

  if (['final', 'third_place'].includes(match.roundKey) && match.status === 'confirmed') {
    throw new Error('Dieses Match ist bereits final abgeschlossen.');
  }

  if (match.status === 'confirmed' && (targetHasConcreteParticipant(event, match.next) || targetHasConcreteParticipant(event, match.loserNext))) {
    throw new Error('Dieses Match ist bereits abgeschlossen und die naechste Runde wurde bereits erzeugt. Bitte erst Ergebnis zuruecksetzen oder Admin-Override nutzen.');
  }
}

function activeKnockoutTeamIds(event, { ignoreMatchId = null, ignoreSide = null } = {}) {
  const ids = new Set();
  for (const roundKey of ROUND_ORDER) {
    const round = event.knockout?.rounds?.[roundKey];
    for (const match of round?.matches || []) {
      for (const side of ['home', 'away']) {
        if (ignoreMatchId && String(match.id) === String(ignoreMatchId) && side === ignoreSide) continue;
        const participant = match[side];
        if (isTeamParticipant(participant) && match.status !== 'confirmed') ids.add(String(participant.teamId));
      }
    }
  }
  return ids;
}

function collectWaitlistTeamIds(event) {
  return [
    ...(Array.isArray(event.checkin?.waitlistTeamIds) ? event.checkin.waitlistTeamIds : []),
    ...(Array.isArray(event.format?.waitlistTeamIds) ? event.format.waitlistTeamIds : []),
    ...(Array.isArray(event.knockout?.waitlistTeamIds) ? event.knockout.waitlistTeamIds : []),
  ].filter(Boolean).map(String);
}

function candidateEntry(team, source) {
  return {
    id: String(team.id),
    label: team.clubName || String(team.id),
    description: source === 'waitlist' ? 'Warteliste / Nachruecker' : 'Registriert, nicht aktiv im K.O.',
    source,
  };
}

function getReplacementCandidates({ eventKey, roundKey, matchId, side }) {
  const event = readEventData(eventKey);
  const round = getRound(event, roundKey);
  const match = getMatch(round, matchId);
  assertReplacementAllowed(event, match, side);

  const activeIds = activeKnockoutTeamIds(event, { ignoreMatchId: match.id, ignoreSide: side });
  const oldTeamId = String(match[side].teamId);
  const byId = new Map(listVisibleTeams()
    .filter(team => isValidTournamentTeam(team))
    .map(team => [String(team.id), team]));

  const result = [];
  const seen = new Set([oldTeamId]);
  for (const teamId of collectWaitlistTeamIds(event)) {
    const team = byId.get(String(teamId));
    if (!team || seen.has(String(team.id))) continue;
    if (activeIds.has(String(team.id))) continue;
    if (isTeamOrUserBanned(team)) continue;
    result.push(candidateEntry(team, 'waitlist'));
    seen.add(String(team.id));
  }

  const rest = [...byId.values()]
    .filter(team => !seen.has(String(team.id)))
    .filter(team => !activeIds.has(String(team.id)))
    .filter(team => !isTeamOrUserBanned(team))
    .sort((a, b) => String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de', { sensitivity: 'base' }));

  for (const team of rest) result.push(candidateEntry(team, 'registered'));
  return result;
}

function createParticipantFromTeam(previousParticipant, team) {
  return {
    ...clone(previousParticipant),
    type: 'team',
    teamId: String(team.id),
    displayName: team.clubName || String(team.id),
    participantKey: `team:${team.id}`,
  };
}

function clearMatchProgress(match, adminUserId, now) {
  const timestamp = nowIso(now);
  match.status = isRealMatch(match) ? 'open' : 'locked';
  match.result = null;
  match.reports = [];
  match.winner = null;
  match.loser = null;
  match.adminDecision = null;
  match.replacementReset = {
    resetAt: timestamp,
    resetByUserId: String(adminUserId),
  };
  match.release = {
    ...(match.release || {}),
    releasedAt: match.release?.releasedAt || timestamp,
    replacementResetAt: timestamp,
  };
  match.meta = { ...(match.meta || {}), updatedAt: timestamp };
}

function replaceKnockoutTeam({ eventKey, roundKey, matchId, side, replacementTeamId, adminUserId, reason = null, now = new Date() }) {
  let outcome;

  updateEventData(eventKey, event => {
    const round = getRound(event, roundKey);
    const match = getMatch(round, matchId);
    assertReplacementAllowed(event, match, side);

    const newTeam = findTeamById(replacementTeamId);
    if (!newTeam || !isValidTournamentTeam(newTeam)) throw new Error('Ersatzteam wurde nicht gefunden.');
    if (isTeamOrUserBanned(newTeam)) throw new Error('Ersatzteam ist gesperrt.');

    const activeIds = activeKnockoutTeamIds(event, { ignoreMatchId: match.id, ignoreSide: side });
    if (activeIds.has(String(newTeam.id))) throw new Error('Ersatzteam ist bereits aktiv im K.O.-Bracket.');

    const oldParticipant = clone(match[side]);
    const oldTeam = isTeamParticipant(oldParticipant) ? findTeamById(oldParticipant.teamId) : null;
    match[side] = createParticipantFromTeam(oldParticipant, newTeam);
    clearMatchProgress(match, adminUserId, now);

    event.knockout.replacementHistory = Array.isArray(event.knockout.replacementHistory)
      ? event.knockout.replacementHistory
      : [];
    event.knockout.replacementHistory.push({
      round: roundKey,
      matchId: String(match.id),
      oldTeamId: oldParticipant?.teamId ? String(oldParticipant.teamId) : null,
      newTeamId: String(newTeam.id),
      side,
      adminId: String(adminUserId),
      timestamp: nowIso(now),
      reason: reason ? String(reason) : null,
    });

    updateRoundStatuses(event);
    updatePlacementsIfReady(event);
    event.knockout.status = event.knockout.status === 'completed' ? 'created' : event.knockout.status;
    event.knockout.meta = { ...(event.knockout.meta || {}), updatedAt: nowIso(now) };
    event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };

    outcome = { event, round, match, oldParticipant, oldTeam, newTeam };
    return event;
  });

  return outcome;
}

function getReplaceableMatches(eventKey, roundKey) {
  const event = readEventData(eventKey);
  const round = getRound(event, roundKey);
  if (!round) throw new Error('K.O.-Runde wurde nicht gefunden.');
  return (round.matches || [])
    .filter(match => isRealMatch(match))
    .map(match => ({
      match,
      value: String(match.id),
      label: `${participantLabel(match.home)} vs ${participantLabel(match.away)}`,
      description: match.status === 'confirmed' ? 'Bestaetigt' : `Status: ${match.status}`,
    }));
}

module.exports = {
  getReplacementCandidates,
  getReplaceableMatches,
  participantLabel,
  replaceKnockoutTeam,
};
