'use strict';

const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { getFriendlyMatches } = require('./ea-clubs-client');

const MINIMUM_MATCHES = 3;
const FORMATION = { goalkeeper: 1, defender: 3, midfielder: 5, forward: 2 };
const RETRY_DELAYS_MS = [0, 30000, 120000, 300000, 600000, 900000, 900000, 1200000];
const MAX_MATCH_TIME_DISTANCE_MS = 2 * 60 * 60 * 1000;
const captureTimers = new Map();

function normalizePosition(value) {
  const key = String(value || '').toLowerCase();
  if (['goalkeeper', 'gk', 'torwart'].includes(key)) return 'goalkeeper';
  if (['defender', 'defence', 'defense', 'verteidiger'].includes(key)) return 'defender';
  if (['midfielder', 'midfield', 'mittelfeldspieler'].includes(key)) return 'midfielder';
  if (['forward', 'attacker', 'striker', 'stürmer'].includes(key)) return 'forward';
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

function matchTimestampMs(match) {
  const raw = match?.timestamp ?? match?.matchTimestamp ?? match?.match_timestamp ?? match?.date;
  if (raw === null || raw === undefined || raw === '') return null;
  if (/^\d+$/.test(String(raw))) {
    const number = Number(raw);
    const milliseconds = number < 100000000000 ? number * 1000 : number;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  const milliseconds = new Date(raw).getTime();
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

function confirmedTimestampMs(lncMatch) {
  const raw = lncMatch?.result?.confirmedAt ?? lncMatch?.confirmation?.confirmedAt;
  const milliseconds = new Date(raw || 0).getTime();
  return Number.isNaN(milliseconds) || milliseconds <= 0 ? null : milliseconds;
}

function eaClubEntry(match, eaClubId) {
  return Object.entries(clubMap(match)).find(([key, club]) =>
    String(key) === String(eaClubId) || String(club?.clubId ?? club?.club_id ?? '') === String(eaClubId));
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

function linkedTeamScoreMatches(match, lncMatch, team, eaClubId) {
  const entry = eaClubEntry(match, eaClubId);
  if (!entry) return false;
  const ownGoals = clubGoals(entry[1]);
  const opponentGoals = Object.entries(clubMap(match))
    .filter(([key]) => key !== entry[0]).map(([, club]) => clubGoals(club)).find(Number.isFinite);
  const isHome = String(lncMatch?.home?.teamId) === String(team.id);
  const expectedOwn = Number(isHome ? lncMatch?.result?.homeGoals : lncMatch?.result?.awayGoals);
  const expectedOpponent = Number(isHome ? lncMatch?.result?.awayGoals : lncMatch?.result?.homeGoals);
  return ownGoals === expectedOwn && opponentGoals === expectedOpponent;
}

function selectEaMatch(matches, lncMatch, linkedTeams) {
  const confirmedAt = confirmedTimestampMs(lncMatch);
  const teamByEaClubId = new Map(linkedTeams.map(team => [String(team.eaClub.clubId), String(team.id)]));
  const candidates = (matches || []).filter(match => {
    if (!eaMatchId(match) || !matchContainsClubs(match, teamByEaClubId)) return false;
    if (linkedTeams.length > 1) {
      if (!scoreMatches(match, lncMatch)) return false;
    } else if (!linkedTeamScoreMatches(match, lncMatch, linkedTeams[0], linkedTeams[0].eaClub.clubId)) {
      return false;
    }
    const matchAt = matchTimestampMs(match);
    if (linkedTeams.length === 1 && (!confirmedAt || !matchAt)) return false;
    return !confirmedAt || !matchAt || Math.abs(confirmedAt - matchAt) <= MAX_MATCH_TIME_DISTANCE_MS;
  });
  return candidates.sort((a, b) => {
    if (!confirmedAt) return 0;
    return Math.abs(confirmedAt - (matchTimestampMs(a) || confirmedAt))
      - Math.abs(confirmedAt - (matchTimestampMs(b) || confirmedAt));
  })[0] || null;
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
        tacklesMade: Number(player.tacklesmade ?? player.tacklesMade) || 0,
        saves: Number(player.saves ?? player.gkSaves) || 0,
        cleanSheets: Math.max(
          Number(player.cleansheetsany) || 0,
          Number(player.cleansheetsdef) || 0,
          Number(player.cleansheetsgk) || 0
        ),
        passesMade: Number(player.passesmade ?? player.passesMade) || 0,
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
      tacklesMade: 0, saves: 0, cleanSheets: 0, passesMade: 0,
    };
    aggregate.playerName = row.playerName;
    aggregate.ratings.push(Number(row.rating));
    aggregate.positions[row.position] = (aggregate.positions[row.position] || 0) + 1;
    aggregate.goals += Number(row.goals) || 0;
    aggregate.assists += Number(row.assists) || 0;
    aggregate.manOfTheMatch += Number(row.manOfTheMatch) || 0;
    aggregate.tacklesMade += Number(row.tacklesMade) || 0;
    aggregate.saves += Number(row.saves) || 0;
    aggregate.cleanSheets += Number(row.cleanSheets) || 0;
    aggregate.passesMade += Number(row.passesMade) || 0;
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
  if (!linked.length || !lncMatch?.result) return false;
  const teamByEaClubId = new Map(linked.map(team => [String(team.eaClub.clubId), String(team.id)]));
  for (const team of linked) {
    const matches = await getFriendlyMatches(team.eaClub.clubId, team.eaClub.platform);
    const candidate = selectEaMatch(matches, lncMatch, linked);
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
      console.warn(`[tott] EA-Daten konnten für ${key} nicht geladen werden: ${error.message}`);
    }
    attempt += 1;
    if (attempt >= RETRY_DELAYS_MS.length) {
      console.warn(`[tott] ${key}: nach ${attempt} EA-Abfragen noch keine passenden Matchdaten gefunden.`);
      return captureTimers.delete(key);
    }
    const timer = setTimeout(run, RETRY_DELAYS_MS[attempt]);
    if (typeof timer.unref === 'function') timer.unref();
    captureTimers.set(key, timer);
  };
  captureTimers.set(key, true);
  run();
  return true;
}

function confirmedEventMatches(event) {
  const matches = [
    ...Object.values(event?.groups?.groups || {}).flatMap(group => group?.matchdays || []).flatMap(day => day?.matches || []),
    ...(event?.leaguePhase?.matchdays || []).flatMap(day => day?.matches || []),
    ...Object.values(event?.knockout?.rounds || {}).flatMap(round => round?.matches || []),
  ].filter(match => match?.id && match.status === 'confirmed' && match.result);
  return [...new Map(matches.map(match => [String(match.id), match])).values()];
}

function resumeRatingCaptures(eventKey, event = readEventData(eventKey)) {
  const captured = new Set((event?.ceremony?.teamOfTheTournament?.capturedMatches || [])
    .map(entry => String(entry.lncMatchId)));
  let scheduled = 0;
  for (const match of confirmedEventMatches(event)) {
    if (captured.has(String(match.id))) continue;
    if (scheduleRatingCapture(eventKey, match)) scheduled += 1;
  }
  return scheduled;
}

module.exports = {
  FORMATION, MAX_MATCH_TIME_DISTANCE_MS, MINIMUM_MATCHES,
  buildSelection, confirmedEventMatches, normalizePosition, resumeRatingCaptures,
  scheduleRatingCapture, selectEaMatch,
};
