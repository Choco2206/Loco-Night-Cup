'use strict';

const { readEventData, updateEventData } = require('../events/event-repository');
const { updateTeamsData } = require('./team-repository');
const { ensureTeamHistory } = require('./team-achievements');

function nowIso() {
  return new Date().toISOString();
}

function isTeamParticipant(participant) {
  return participant?.type === 'team' && (participant.teamId || participant.id);
}

function getParticipantTeamId(participant) {
  return participant?.teamId || participant?.id || null;
}

function isConfirmedRealMatch(match) {
  return isTeamParticipant(match?.home)
    && isTeamParticipant(match?.away)
    && match.status === 'confirmed'
    && Number.isFinite(Number(match.result?.homeGoals))
    && Number.isFinite(Number(match.result?.awayGoals));
}

function collectGroupMatches(event) {
  return Object.values(event.groups?.groups || {})
    .flatMap(group => group.matchdays || [])
    .flatMap(matchday => matchday.matches || []);
}

function collectKnockoutMatches(event) {
  return Object.values(event.knockout?.rounds || {})
    .flatMap(round => round.matches || []);
}

function createEmptyMatchStats() {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  };
}

function addMatch(stats, goalsFor, goalsAgainst) {
  stats.played += 1;
  stats.goalsFor += goalsFor;
  stats.goalsAgainst += goalsAgainst;
  if (goalsFor > goalsAgainst) stats.wins += 1;
  else if (goalsFor === goalsAgainst) stats.draws += 1;
  else stats.losses += 1;
}

function collectActiveParticipantTeamIds(event) {
  const size = Number(event.format?.size || 0);
  const participants = Array.isArray(event.format?.participants)
    ? event.format.participants.slice(0, size || undefined)
    : [];
  return [...new Set(participants.filter(isTeamParticipant).map(participant => String(getParticipantTeamId(participant))))];
}

function collectEventTeamStats(event) {
  const teamStats = new Map();
  const ensureStats = teamId => {
    const id = String(teamId);
    if (!teamStats.has(id)) teamStats.set(id, createEmptyMatchStats());
    return teamStats.get(id);
  };

  const matches = [...collectGroupMatches(event), ...collectKnockoutMatches(event)];
  for (const match of matches) {
    if (!isConfirmedRealMatch(match)) continue;
    const homeTeamId = String(match.home.teamId);
    const awayTeamId = String(match.away.teamId);
    const homeGoals = Number(match.result.homeGoals);
    const awayGoals = Number(match.result.awayGoals);
    addMatch(ensureStats(homeTeamId), homeGoals, awayGoals);
    addMatch(ensureStats(awayTeamId), awayGoals, homeGoals);
  }

  return teamStats;
}

function applyTeamStatsForEvent(eventKey) {
  const event = readEventData(eventKey);
  const currentState = event?.ceremony?.teamStats || {};
  if (currentState.appliedAt) return { applied: false, reason: 'already_applied', state: currentState };
  if (event?.knockout?.status !== 'completed') return { applied: false, reason: 'knockout_not_completed' };

  const participantTeamIds = collectActiveParticipantTeamIds(event);
  if (!participantTeamIds.length) return { applied: false, reason: 'missing_participants' };

  const timestamp = nowIso();
  const eventStats = collectEventTeamStats(event);
  const participantSet = new Set(participantTeamIds.map(String));
  const appliedTeams = [];

  updateTeamsData(data => {
    const teamsById = new Map((Array.isArray(data.teams) ? data.teams : []).map(team => [String(team.id), team]));
    for (const teamId of participantTeamIds) {
      const team = teamsById.get(String(teamId));
      if (!team || team.status === 'deleted') continue;
      ensureTeamHistory(team);
      const stats = eventStats.get(String(teamId)) || createEmptyMatchStats();
      team.history.cupsPlayed += 1;
      team.history.matches.played += stats.played;
      team.history.matches.wins += stats.wins;
      team.history.matches.draws += stats.draws;
      team.history.matches.losses += stats.losses;
      team.history.matches.goalsFor += stats.goalsFor;
      team.history.matches.goalsAgainst += stats.goalsAgainst;
      team.meta = { ...(team.meta || {}), updatedAt: timestamp };
      appliedTeams.push({ teamId: String(teamId), clubName: team.clubName, stats });
    }
    return data;
  });

  let state;
  updateEventData(eventKey, storedEvent => {
    storedEvent.ceremony = storedEvent.ceremony || {};
    if (storedEvent.ceremony.teamStats?.appliedAt) {
      state = storedEvent.ceremony.teamStats;
      return storedEvent;
    }
    storedEvent.ceremony.teamStats = {
      appliedAt: timestamp,
      participantTeamIds: [...participantSet],
      matchCount: [...eventStats.values()].reduce((sum, stats) => sum + stats.played, 0) / 2,
    };
    storedEvent.meta = { ...(storedEvent.meta || {}), updatedAt: timestamp };
    state = storedEvent.ceremony.teamStats;
    return storedEvent;
  });

  return {
    applied: true,
    participantTeamIds: [...participantSet],
    appliedTeams,
    state,
  };
}

module.exports = {
  applyTeamStatsForEvent,
  collectEventTeamStats,
  createEmptyMatchStats,
};
