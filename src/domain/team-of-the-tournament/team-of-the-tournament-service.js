'use strict';

const { updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { getFriendlyMatches } = require('./ea-clubs-client');

const MINIMUM_MATCHES = 3;
const FORMATION = { goalkeeper: 1, defender: 3, midfielder: 5, forward: 2 };
const RETRY_DELAYS_MS = [0, 30000, 120000, 300000];
const captureTimers = new Map();

function normalizePosition(value) {
  const key = String(value || '').toLowerCase();
  if (['goalkeeper', 'gk', 'torwart'].includes(key)) return 'goalkeeper';
  if (['defender', 'defence', 'defense', 'verteidiger'].includes(key)) return 'defender';
  if (['midfielder', 'midfield', 'mittelfeldspieler'].includes(key)) return 'midfielder';
  if (['forward', 'attacker', 'striker', 'stuermer'].includes(key)) return 'forward';
  return null;
}

function eaMatchId(match) {
  return String(match?.matchId ?? match?.match_id ?? match?.id ?? '');
}

function clubMap(match) {
  return match?.clubs || match?.teams || {};
}

function clubGoals(club) {
  const value = club?.goals ?? club?.score ?? club?.goalsFor;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function matchContainsClubs(match, teamByEaClubId) {
  const ids = new Set(Object.entries(clubMap(match)).flatMap(([key, club]) => [String(key), String(club?.clubId ?? club?.club_id ?? '')]));
  const linkedIds = [...teamByEaClubId.keys()];
  return linkedIds.length > 1 ? linkedIds.every(id => ids.has(id)) : linkedIds.some(id => ids.has(id));
}

function scoreMatches(match, lncMatch) {
  const goals = Object.values(clubMap(match)).map(clubGoals).filter(Number.isFinite).sort((a, b) => a - b);
  const expected = [Number(lncMatch?.result?.homeGoals), Number(lncMatch?.result?.awayGoals)].sort((a, b) => a - b);
  return goals.length >= 2 && goals[0] === expected[0] && goals[goals.length - 1] === expected[1];
}

function playerRows(match, teamByEaClubId, lncMatchId) {
  const rows = [];
  const playersByClub = match?.players || {};
  for (const [rawClubId, players] of Object.entries(playersByClub)) {
    const club = clubMap(match)?.[rawClubId] || {};
    const clubId = String(club?.clubId ?? club?.club_id ?? rawClubId);
    const teamId = teamByEaClubId.get(clubId);
    if (!teamId || !players || typeof players !== 'object') continue;
    for (const [playerId, player] of Object.entries(players)) {
      const rating = Number(player?.rating);
      const position = normalizePosition(player?.pos ?? player?.position);
      const playerName = player?.playername ?? player?.playerName ?? player?.name;
      if (!Number.isFinite(rating) || !position || !playerName) continue;
      rows.push({
        lncMatchId: String(lncMatchId), eaMatchId: eaMatchId(match), teamId: String(teamId),
        playerId: String(playerId), playerName: String(playerName), position, rating,
        goals: Number(player.goals) || 0, assists: Number(player.assists) || 0,
        manOfTheMatch: Number(player.man_of_the_match ?? player.mom) || 0,
      });
    }
  }
  return rows;
}

function buildSelection(performances) {
  const aggregates = new Map();
  for (const row of performances || []) {
    const key = `${row.teamId}:${row.playerId}`;
    const aggregate = aggregates.get(key) || {
      teamId: row.teamId, playerId: row.playerId, playerName: row.playerName,
      ratings: [], positions: {}, goals: 0, assists: 0, manOfTheMatch: 0,
    };
    aggregate.playerName = row.playerName;
    aggregate.ratings.push(Number(row.rating));
    aggregate.positions[row.position] = (aggregate.positions[row.position] || 0) + 1;
    aggregate.goals += Number(row.goals) || 0;
    aggregate.assists += Number(row.assists) || 0;
    aggregate.manOfTheMatch += Number(row.manOfTheMatch) || 0;
    aggregates.set(key, aggregate);
  }
  const eligible = [...aggregates.values()].filter(item => item.ratings.length >= MINIMUM_MATCHES).map(item => {
    const lastPosition = performances.filter(row => `${row.teamId}:${row.playerId}` === `${item.teamId}:${item.playerId}`).at(-1)?.position;
    const position = Object.entries(item.positions)
      .sort((a, b) => b[1] - a[1] || Number(b[0] === lastPosition) - Number(a[0] === lastPosition))[0]?.[0] || null;
    const averageRating = item.ratings.reduce((sum, rating) => sum + rating, 0) / item.ratings.length;
    return { ...item, position, matches: item.ratings.length, averageRating: Number(averageRating.toFixed(2)) };
  });
  const compare = (a, b) => b.averageRating - a.averageRating
    || b.matches - a.matches || b.manOfTheMatch - a.manOfTheMatch
    || (b.goals + b.assists) - (a.goals + a.assists);
  return Object.fromEntries(Object.entries(FORMATION).map(([position, count]) => [
    position, eligible.filter(player => player.position === position).sort(compare).slice(0, count),
  ]));
}

function persistMatch(eventKey, lncMatch, eaMatch, teamByEaClubId) {
  let stored = false;
  updateEventData(eventKey, event => {
    event.ceremony = event.ceremony || {};
    const state = event.ceremony.teamOfTheTournament || { performances: [], capturedMatches: [], selection: null };
    if (state.capturedMatches.some(entry => String(entry.eaMatchId) === eaMatchId(eaMatch))) return event;
    const rows = playerRows(eaMatch, teamByEaClubId, lncMatch.id);
    if (!rows.length) return event;
    state.performances.push(...rows);
    state.capturedMatches.push({ lncMatchId: String(lncMatch.id), eaMatchId: eaMatchId(eaMatch), capturedAt: new Date().toISOString() });
    state.selection = buildSelection(state.performances);
    state.updatedAt = new Date().toISOString();
    event.ceremony.teamOfTheTournament = state;
    stored = true;
    return event;
  });
  return stored;
}

async function captureOnce(eventKey, lncMatch) {
  const teams = [lncMatch?.home?.teamId, lncMatch?.away?.teamId].map(findTeamById).filter(Boolean);
  const linked = teams.filter(team => team.eaClub?.clubId);
  // Beide Clubs muessen verknuepft sein, damit ein gleiches Ergebnis nicht versehentlich
  // einem anderen Friendly des Teams zugeordnet wird.
  if (linked.length < 2 || !lncMatch?.result) return false;
  const teamByEaClubId = new Map(linked.map(team => [String(team.eaClub.clubId), String(team.id)]));
  for (const team of linked) {
    const matches = await getFriendlyMatches(team.eaClub.clubId, team.eaClub.platform);
    const candidate = matches.find(match => eaMatchId(match) && matchContainsClubs(match, teamByEaClubId) && scoreMatches(match, lncMatch));
    if (candidate && persistMatch(eventKey, lncMatch, candidate, teamByEaClubId)) return true;
  }
  return false;
}

function scheduleRatingCapture(eventKey, lncMatch) {
  if (!lncMatch?.id || lncMatch.status !== 'confirmed') return false;
  const key = `${eventKey}:${lncMatch.id}`;
  if (captureTimers.has(key)) return false;
  let attempt = 0;
  const run = async () => {
    try {
      if (await captureOnce(eventKey, lncMatch)) return captureTimers.delete(key);
    } catch (error) {
      console.warn(`[tott] EA-Daten konnten fuer ${key} nicht geladen werden: ${error.message}`);
    }
    attempt += 1;
    if (attempt >= RETRY_DELAYS_MS.length) return captureTimers.delete(key);
    const timer = setTimeout(run, RETRY_DELAYS_MS[attempt]);
    if (typeof timer.unref === 'function') timer.unref();
    captureTimers.set(key, timer);
  };
  captureTimers.set(key, true);
  run();
  return true;
}

module.exports = { FORMATION, MINIMUM_MATCHES, buildSelection, normalizePosition, scheduleRatingCapture };

