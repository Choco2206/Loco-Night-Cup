'use strict';

const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { getFriendlyMatches } = require('./ea-clubs-client');
const { sendTracker } = require('./tott-tracker');

const MINIMUM_MATCHES = 2;
const MINIMUM_TEAM_MATCH_RATIO = 0.5;
const FORMATION = { goalkeeper: 1, defender: 3, midfielder: 5, forward: 2 };
const TOTT_SCORING = {
  goalkeeper: {
    rating: 1.15, goal: 10, assist: 6, cleanSheet: 5,
    tackle: 0, tenPasses: 0.5, save: 0.75, manOfTheMatch: 3, win: 1,
  },
  defender: {
    rating: 1.15, goal: 8, assist: 5, cleanSheet: 4,
    tackle: 0.5, tenPasses: 1, save: 0, manOfTheMatch: 3, win: 1,
  },
  midfielder: {
    rating: 1.1, goal: 6, assist: 4, cleanSheet: 2,
    tackle: 0.4, tenPasses: 1, save: 0, manOfTheMatch: 3, win: 1,
  },
  forward: {
    rating: 1, goal: 5, assist: 3, cleanSheet: 1,
    tackle: 0.25, tenPasses: 0.5, save: 0, manOfTheMatch: 3, win: 1,
  },
};
const RETRY_DELAYS_MS = [0, 30000, 120000, 300000, 600000, 900000, 900000, 1200000];
const MAX_MATCH_TIME_DISTANCE_MS = 10 * 60 * 1000;
// Some EA timestamps describe the start rather than the end of the game.
// The wider lookback requires an exact score, never time alone.
const MATCH_START_LOOKBACK_MS = 30 * 60 * 1000;
const captureTimers = new Map();
const capturesInFlight = new Map();

function normalizePosition(value) {
  const key = String(value || '').toLowerCase();
  if (['goalkeeper', 'gk', 'torwart'].includes(key)) return 'goalkeeper';
  if (['defender', 'defence', 'defense', 'verteidiger'].includes(key)) return 'defender';
  if (['midfielder', 'midfield', 'mittelfeldspieler'].includes(key)) return 'midfielder';
  if (['forward', 'attacker', 'striker', 'stürmer'].includes(key)) return 'forward';
  return null;
}

function isRealEaMatch(lncMatch) {
  return lncMatch?.home?.type === 'team' && lncMatch?.away?.type === 'team';
}

function requiresEaCapture(lncMatch) {
  return isRealEaMatch(lncMatch) && lncMatch?.result?.matchPlayed !== false
    && lncMatch?.result?.source !== 'admin';
}

function eaMatchId(match) {
  return String(match?.matchId ?? match?.match_id ?? match?.id ?? '');
}

function clubMap(match) { return match?.clubs || match?.teams || {}; }

function clubIdOf(key, club) {
  return String(club?.details?.clubId ?? club?.clubId ?? club?.club_id ?? key);
}

function clubGoals(club) {
  const value = club?.goals ?? club?.score ?? club?.goalsFor;
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function eaScore(match) { return Object.values(clubMap(match)).map(clubGoals).filter(Number.isFinite); }

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
  const candidates = [
    ...(lncMatch?.reports || []).map(report => report?.submittedAt),
    lncMatch?.confirmation?.startedAt,
    lncMatch?.result?.confirmedAt,
    lncMatch?.confirmation?.confirmedAt,
  ].map(raw => new Date(raw || 0).getTime()).filter(value => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : null;
}

function eaClubEntry(match, eaClubId) {
  return Object.entries(clubMap(match)).find(([key, club]) =>
    String(key) === String(eaClubId) || clubIdOf(key, club) === String(eaClubId));
}

function matchContainsClubs(match, teamByEaClubId) {
  const ids = new Set(Object.entries(clubMap(match)).flatMap(([key, club]) => [String(key), clubIdOf(key, club)]));
  const linkedIds = [...teamByEaClubId.keys()];
  return linkedIds.length > 1 ? linkedIds.every(id => ids.has(id)) : linkedIds.some(id => ids.has(id));
}

function scoreMatches(match, lncMatch) {
  const goals = eaScore(match).sort((a, b) => a - b);
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

function withinMatchWindow(match, confirmedAt) {
  const matchAt = matchTimestampMs(match);
  return Boolean(confirmedAt && matchAt && Math.abs(confirmedAt - matchAt) <= MAX_MATCH_TIME_DISTANCE_MS);
}

function hasDnf(match) {
  return Object.values(clubMap(match)).some(club => Number(club?.winnerByDnf) === 1);
}

function historyDiagnostic(team, matches) {
  const recent = [...matches].sort((a, b) => (matchTimestampMs(b) || 0) - (matchTimestampMs(a) || 0));
  const latest = recent[0];
  const own = latest && eaClubEntry(latest, team.eaClub.clubId)?.[1];
  const actualName = own?.details?.name || own?.name;
  const expectedName = team.eaClub.name;
  const nameMismatch = actualName && expectedName
    && actualName.localeCompare(expectedName, 'de', { sensitivity: 'base' }) !== 0;
  const details = [`${team.clubName || team.id} [${team.eaClub.clubId}/${team.eaClub.platform || 'common-gen5'}]: ${matches.length} Spiele`];
  if (actualName) details.push(`EA-Club: ${String(actualName).slice(0, 80)}${nameMismatch ? ' ⚠️ weicht vom verknüpften Namen ab: ' + String(expectedName).slice(0, 80) : ''}`);
  if (latest) details.push(`neuestes Spiel: ${matchTimestampMs(latest) ? new Date(matchTimestampMs(latest)).toISOString() : 'Zeit fehlt'}`);
  return details.join('; ');
}

function candidateDiagnostics(matches, lncMatch, linked, excludedIds) {
  const at = confirmedTimestampMs(lncMatch);
  const ids = new Map(linked.map(team => [String(team.eaClub.clubId), String(team.id)]));
  const unique = [...new Map(matches.map(match => [eaMatchId(match), match])).values()];
  return unique.sort((a, b) => Math.abs((matchTimestampMs(a) || 0) - at) - Math.abs((matchTimestampMs(b) || 0) - at))
    .slice(0, 3).map(match => {
      const clubs = Object.entries(clubMap(match)).map(([key, club]) =>
        `${String(club?.details?.name || club?.name || '?').slice(0, 45)} [${clubIdOf(key, club)}] ${clubGoals(club) ?? '?'}`).join(' / ');
      const reasons = [];
      if (!matchContainsClubs(match, ids)) reasons.push('Club-IDs passen nicht');
      const time = matchTimestampMs(match);
      if (!time || !at || time < at - MATCH_START_LOOKBACK_MS || time > at + MAX_MATCH_TIME_DISTANCE_MS) reasons.push('außerhalb Zeitfenster');
      if (excludedIds.has(eaMatchId(match))) reasons.push('bereits zugeordnet');
      if (hasDnf(match)) reasons.push('Abbruch/DNF');
      return `EA ${eaMatchId(match)}: ${clubs}; ${time ? new Date(time).toISOString() : 'Zeit fehlt'}; ${reasons.join(', ') || 'Identität/Zeit passen'}`;
    }).join('\n');
}

function selectEaMatch(matches, lncMatch, linkedTeams, excludedIds = new Set(), options = {}) {
  const confirmedAt = confirmedTimestampMs(lncMatch);
  const teamByEaClubId = new Map(linkedTeams.map(team => [String(team.eaClub.clubId), String(team.id)]));
  if (!confirmedAt || !linkedTeams.length || teamByEaClubId.size !== linkedTeams.length) {
    return { match: null, fallback: false, reason: 'missing_time_or_invalid_club_links' };
  }
  const unique = [...new Map((matches || []).filter(eaMatchId)
    .map(match => [eaMatchId(match), match])).values()];
  const baseCandidates = unique.filter(match => {
    if (!eaMatchId(match) || excludedIds.has(eaMatchId(match)) || !matchContainsClubs(match, teamByEaClubId)) return false;
    if (Object.keys(clubMap(match)).length !== 2) return false;
    const matchAt = matchTimestampMs(match);
    return matchAt && matchAt >= confirmedAt - MATCH_START_LOOKBACK_MS
      && matchAt <= confirmedAt + MAX_MATCH_TIME_DISTANCE_MS;
  });
  // A knockout may consist of a complete draw followed by a short golden-goal
  // game which EA records as a DNF win. Never use that short game's ratings.
  if (options.knockout) {
    const draws = baseCandidates.filter(match => {
      const goals = eaScore(match);
      return goals.length === 2 && goals[0] === goals[1] && !hasDnf(match);
    });
    const decisions = baseCandidates.filter(match => hasDnf(match) && withinMatchWindow(match, confirmedAt)
      && linkedTeams.every(team => {
        const isHome = String(team.id) === String(lncMatch.home.teamId);
        const expectedWin = isHome ? Number(lncMatch.result.homeGoals) > Number(lncMatch.result.awayGoals)
          : Number(lncMatch.result.awayGoals) > Number(lncMatch.result.homeGoals);
        return (Number(eaClubEntry(match, team.eaClub.clubId)?.[1]?.winnerByDnf) === 1) === expectedWin;
      }));
    const pairs = draws.flatMap(draw => decisions.filter(decision =>
      matchTimestampMs(decision) > matchTimestampMs(draw)
      && matchTimestampMs(decision) - matchTimestampMs(draw) <= MATCH_START_LOOKBACK_MS
    ).map(decision => ({ draw, decision })));
    if (linkedTeams.length === 2 && pairs.length === 1) {
      return { match: pairs[0].draw, decisionMatchId: eaMatchId(pairs[0].decision), fallback: true };
    }
    if (baseCandidates.some(hasDnf)) {
      return { match: null, fallback: false, reason: 'decision_needs_review' };
    }
  }
  const exact = match => linkedTeams.every(team =>
    linkedTeamScoreMatches(match, lncMatch, team, team.eaClub.clubId));
  const timed = baseCandidates.filter(match => withinMatchWindow(match, confirmedAt));
  const exactTimed = timed.filter(exact);
  // Club identity and report time are primary. A different EA score does not
  // discard the sole recent match, including when only one club is linked.
  let candidates = exactTimed.length ? exactTimed : timed;
  if (!candidates.length) candidates = baseCandidates.filter(exact);
  if (candidates.length === 1) {
    return { match: candidates[0], fallback: !exact(candidates[0]) };
  }
  return { match: null, fallback: false, reason: candidates.length ? 'ambiguous_recent_matches' : 'no_recent_match' };
}

function playerRows(match, teamByEaClubId, lncMatchId) {
  const rows = [];
  const playersByClub = match?.players || {};
  for (const [rawClubId, players] of Object.entries(playersByClub)) {
    const club = clubMap(match)?.[rawClubId] || {};
    const clubId = clubIdOf(rawClubId, club);
    const teamId = teamByEaClubId.get(clubId);
    if (!teamId || !players || typeof players !== 'object') continue;
    const goalsConceded = Object.entries(clubMap(match))
      .filter(([key, opponent]) => String(key) !== String(rawClubId)
        && clubIdOf(key, opponent) !== clubId)
      .map(([, opponent]) => clubGoals(opponent)).find(Number.isFinite);
    const ownGoals = clubGoals(club);
    const won = Number.isFinite(ownGoals) && Number.isFinite(goalsConceded) && ownGoals > goalsConceded ? 1 : 0;
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
        tackleAttempts: Number(player.tackleattempts ?? player.tackleAttempts) || 0,
        shots: Number(player.shots) || 0,
        saves: Number(player.saves ?? player.gkSaves) || 0,
        goalsConceded: position === 'goalkeeper' && Number.isFinite(goalsConceded) ? goalsConceded : null,
        cleanSheets: Math.max(Number(player.cleansheetsany) || 0, Number(player.cleansheetsdef) || 0, Number(player.cleansheetsgk) || 0),
        passesMade: Number(player.passesmade ?? player.passesMade) || 0,
        passAttempts: Number(player.passattempts ?? player.passAttempts) || 0,
        won,
      });
    }
  }
  return rows;
}

function calculateTottPoints(player, position) {
  const scoring = TOTT_SCORING[position];
  if (!scoring) return 0;
  return Number((
    player.ratingTotal * scoring.rating
    + player.goals * scoring.goal
    + player.assists * scoring.assist
    + player.cleanSheets * scoring.cleanSheet
    + player.tacklesMade * scoring.tackle
    + (player.passesMade / 10) * scoring.tenPasses
    + player.saves * scoring.save
    + player.manOfTheMatch * scoring.manOfTheMatch
    + player.wins * scoring.win
  ).toFixed(4));
}

function buildRankings(performances, tournamentMatches = []) {
  const teamMatches = new Map();
  const opportunityMatches = new Map();
  const legacyWins = new Map();
  for (const match of tournamentMatches || []) {
    const homeGoals = Number(match?.result?.homeGoals); const awayGoals = Number(match?.result?.awayGoals);
    const participants = match?.result?.matchPlayed === false && Number.isFinite(homeGoals) && Number.isFinite(awayGoals)
      ? [homeGoals > awayGoals ? match?.home : match?.away]
      : [match?.home, match?.away];
    for (const participant of participants) {
      if (participant?.type !== 'team' || !participant.teamId || !match?.id) continue;
      const teamId = String(participant.teamId);
      if (!opportunityMatches.has(teamId)) opportunityMatches.set(teamId, new Set());
      opportunityMatches.get(teamId).add(String(match.id));
    }
    if (!match?.id || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    legacyWins.set(`${match.id}:${match?.home?.teamId}`, homeGoals > awayGoals ? 1 : 0);
    legacyWins.set(`${match.id}:${match?.away?.teamId}`, awayGoals > homeGoals ? 1 : 0);
  }
  const aggregates = new Map();
  for (const row of performances || []) {
    const teamId = String(row.teamId);
    const lncMatchId = String(row.lncMatchId ?? row.eaMatchId ?? '');
    if (!teamMatches.has(teamId)) teamMatches.set(teamId, new Set());
    if (lncMatchId) teamMatches.get(teamId).add(lncMatchId);
    const key = `${row.teamId}:${row.playerId}`;
    const aggregate = aggregates.get(key) || {
      teamId: row.teamId, playerId: row.playerId, playerName: row.playerName,
      ratings: [], matchIds: new Set(), positions: {}, goals: 0, assists: 0, manOfTheMatch: 0,
      tacklesMade: 0, tackleAttempts: 0, shots: 0, saves: 0, goalsConceded: 0,
      goalkeeperMatchesWithConcededData: 0, cleanSheets: 0, passesMade: 0, passAttempts: 0, wins: 0,
    };
    aggregate.playerName = row.playerName; aggregate.ratings.push(Number(row.rating)); aggregate.matchIds.add(lncMatchId);
    aggregate.positions[row.position] = (aggregate.positions[row.position] || 0) + 1;
    aggregate.goals += Number(row.goals) || 0; aggregate.assists += Number(row.assists) || 0;
    aggregate.manOfTheMatch += Number(row.manOfTheMatch) || 0;
    aggregate.tacklesMade += Number(row.tacklesMade) || 0; aggregate.tackleAttempts += Number(row.tackleAttempts) || 0;
    aggregate.shots += Number(row.shots) || 0; aggregate.saves += Number(row.saves) || 0;
    if (row.position === 'goalkeeper' && Number.isFinite(Number(row.goalsConceded))) {
      aggregate.goalsConceded += Number(row.goalsConceded); aggregate.goalkeeperMatchesWithConcededData += 1;
    }
    aggregate.cleanSheets += Number(row.cleanSheets) || 0;
    aggregate.passesMade += Number(row.passesMade) || 0; aggregate.passAttempts += Number(row.passAttempts) || 0;
    const storedWin = Number(row.won);
    aggregate.wins += Number.isFinite(storedWin) ? storedWin : (legacyWins.get(`${lncMatchId}:${row.teamId}`) || 0);
    aggregates.set(key, aggregate);
  }
  const eligible = [...aggregates.values()].filter(item => {
    const playedMatches = item.matchIds.size;
    const capturedTeamMatches = teamMatches.get(String(item.teamId))?.size || 0;
    const teamOpportunityMatches = Math.max(capturedTeamMatches,
      opportunityMatches.get(String(item.teamId))?.size || 0);
    const projectedMatches = capturedTeamMatches > 0
      ? playedMatches * (teamOpportunityMatches / capturedTeamMatches)
      : playedMatches;
    const requiredMatches = Math.max(MINIMUM_MATCHES,
      Math.ceil(teamOpportunityMatches * MINIMUM_TEAM_MATCH_RATIO));
    return projectedMatches >= requiredMatches;
  }).map(item => {
    const lastPosition = performances.filter(row => `${row.teamId}:${row.playerId}` === `${item.teamId}:${item.playerId}`).at(-1)?.position;
    const position = Object.entries(item.positions)
      .sort((a, b) => b[1] - a[1] || Number(b[0] === lastPosition) - Number(a[0] === lastPosition))[0]?.[0] || null;
    const ratingTotal = item.ratings.reduce((sum, rating) => sum + rating, 0);
    const matches = item.matchIds.size; const averageRating = ratingTotal / item.ratings.length;
    const goalkeeperMatches = item.positions.goalkeeper || 0;
    const hasCompleteConcededData = goalkeeperMatches > 0 && item.goalkeeperMatchesWithConcededData === goalkeeperMatches;
    const saveDenominator = item.saves + item.goalsConceded;
    return {
      ...item, matchIds: undefined, position, matches, ratingTotal,
      capturedTeamMatches: teamMatches.get(String(item.teamId))?.size || 0,
      teamOpportunityMatches: Math.max(teamMatches.get(String(item.teamId))?.size || 0,
        opportunityMatches.get(String(item.teamId))?.size || 0),
      averageRating: Number(averageRating.toFixed(2)),
      savePercentage: hasCompleteConcededData && saveDenominator > 0 ? item.saves / saveDenominator : 0,
      goalsConcededPerMatch: hasCompleteConcededData ? item.goalsConceded / goalkeeperMatches : null,
      savesPerMatch: goalkeeperMatches > 0 ? item.saves / goalkeeperMatches : 0,
      cleanSheetPercentage: item.cleanSheets / matches,
      tacklesPerMatch: item.tacklesMade / matches,
      tacklePercentage: item.tackleAttempts > 0 ? item.tacklesMade / item.tackleAttempts : 0,
      passPercentage: item.passAttempts > 0 ? item.passesMade / item.passAttempts : 0,
      goalsPerMatch: item.goals / matches, assistsPerMatch: item.assists / matches,
      shotConversion: item.shots > 0 ? item.goals / item.shots : 0,
    };
  }).map(player => {
    const actualTottPoints = calculateTottPoints(player, player.position);
    const opportunityFactor = player.capturedTeamMatches > 0
      ? player.teamOpportunityMatches / player.capturedTeamMatches
      : 1;
    return {
      ...player,
      projectedMatches: Number((player.matches * opportunityFactor).toFixed(4)),
      actualTottPoints,
      compensationPoints: 0,
      totalTottPoints: actualTottPoints,
      tottPpg: Number((actualTottPoints / player.matches).toFixed(4)),
    };
  });

  const byPosition = Object.fromEntries(Object.keys(FORMATION).map(position => [position, eligible.filter(player => player.position === position)]));
  const comparePlayers = (a, b) => b.totalTottPoints - a.totalTottPoints || b.tottPpg - a.tottPpg
    || b.averageRating - a.averageRating || b.manOfTheMatch - a.manOfTheMatch || b.matches - a.matches;
  return Object.fromEntries(Object.keys(FORMATION).map(position => [
    position, byPosition[position].sort(comparePlayers),
  ]));
}

function buildSelection(performances, tournamentMatches = []) {
  const rankings = buildRankings(performances, tournamentMatches);
  return Object.fromEntries(Object.entries(FORMATION).map(([position, count]) => [
    position, rankings[position].slice(0, count),
  ]));
}

function persistMatch(eventKey, lncMatch, eaMatch, teamByEaClubId, decisionMatchId = null) {
  let stored = false; let storedRows = [];
  updateEventData(eventKey, event => {
    event.ceremony = event.ceremony || {};
    const state = event.ceremony.teamOfTheTournament || { performances: [], capturedMatches: [], selection: null };
    if (state.capturedMatches.some(entry => String(entry.lncMatchId) !== String(lncMatch.id)
      && [entry.eaMatchId, entry.decisionMatchId].filter(Boolean).map(String)
        .some(id => [eaMatchId(eaMatch), decisionMatchId].includes(id)))) return event;
    const rows = playerRows(eaMatch, teamByEaClubId, lncMatch.id);
    if (!rows.length) return event;
    const existing = new Set(state.performances.filter(row => String(row.lncMatchId) === String(lncMatch.id))
      .map(row => `${row.teamId}:${row.playerId}`));
    const newRows = rows.filter(row => !existing.has(`${row.teamId}:${row.playerId}`));
    state.performances.push(...newRows);
    if (!state.capturedMatches.some(entry => String(entry.lncMatchId) === String(lncMatch.id))) state.capturedMatches.push({ lncMatchId: String(lncMatch.id), eaMatchId: eaMatchId(eaMatch), decisionMatchId, capturedAt: new Date().toISOString() });
    state.selection = buildSelection(state.performances, tottOpportunityMatches(event)); state.updatedAt = new Date().toISOString();
    event.ceremony.teamOfTheTournament = state; storedRows = rows; stored = true; return event;
  });
  return { stored, rows: storedRows };
}

function teamName(teamId) { return findTeamById(teamId)?.clubName || `Team ${teamId || '?'}`; }
function matchLabel(lncMatch) {
  const homeName = lncMatch?.home?.type === 'bye' ? 'Freilos' : teamName(lncMatch?.home?.teamId);
  const awayName = lncMatch?.away?.type === 'bye' ? 'Freilos' : teamName(lncMatch?.away?.teamId);
  return `${homeName} **${lncMatch?.result?.homeGoals ?? '?'}:${lncMatch?.result?.awayGoals ?? '?'}** ${awayName}`;
}
function linkedStatus(lncMatch) {
  return [lncMatch?.home, lncMatch?.away].map(participant => {
    if (participant?.type === 'bye') return '⏭️ Freilos – keine EA-Daten erwartet';
    const team = findTeamById(participant?.teamId);
    return `${team?.eaClub?.clubId ? '✅' : '❌'} ${team?.clubName || `Team ${participant?.teamId || '?'}`}`;
  }).join('\n');
}

async function captureOnce(eventKey, requestedMatch) {
  const key = `${eventKey}:${requestedMatch.id}`;
  if (capturesInFlight.has(key)) return capturesInFlight.get(key);
  const work = captureOnceInternal(eventKey, requestedMatch);
  capturesInFlight.set(key, work);
  try { return await work; } finally { capturesInFlight.delete(key); }
}

async function captureOnceInternal(eventKey, requestedMatch) {
  // Retry using current results, not a stale copy from before an admin correction.
  const lncMatch = allEventMatches(readEventData(eventKey))
    .find(match => String(match.id) === String(requestedMatch.id)) || requestedMatch;
  if (!isRealEaMatch(lncMatch)) return { captured: false, reason: 'bye_or_non_real_match' };
  if (!requiresEaCapture(lncMatch)) return { captured: false, reason: 'forfeit' };
  const teams = [lncMatch?.home?.teamId, lncMatch?.away?.teamId].map(findTeamById).filter(Boolean);
  const linked = teams.filter(team => team.eaClub?.clubId);
  if (!linked.length || !lncMatch?.result) return { captured: false, reason: 'no_linked_teams' };
  const teamByEaClubId = new Map(linked.map(team => [String(team.eaClub.clubId), String(team.id)]));
  const state = readEventData(eventKey)?.ceremony?.teamOfTheTournament || {};
  const excludedIds = new Set((state.capturedMatches || [])
    .filter(entry => String(entry.lncMatchId) !== String(lncMatch.id)).flatMap(entry => [entry.eaMatchId, entry.decisionMatchId].filter(Boolean).map(String)));
  const ownCapture = (state.capturedMatches || []).find(entry => String(entry.lncMatchId) === String(lncMatch.id));
  const matches = [];
  const errors = [];
  const queries = [];
  for (const team of linked) {
    try {
      const response = await getFriendlyMatches(team.eaClub.clubId, team.eaClub.platform, 50, { fresh: true });
      matches.push(...response);
      queries.push(historyDiagnostic(team, response));
    } catch (error) {
      errors.push(`${team.clubName || team.id}: ${error.message}`);
    }
  }
  const candidates = ownCapture
    ? matches.filter(match => eaMatchId(match) === String(ownCapture.eaMatchId))
    : matches;
  const knockout = Object.values(readEventData(eventKey)?.knockout?.rounds || {})
    .some(round => (round.matches || []).some(match => String(match.id) === String(lncMatch.id)));
  const selected = selectEaMatch(candidates, lncMatch, linked, excludedIds, { knockout });
  // A previously captured match keeps its identity when filling missing player data.
  if (ownCapture && !selected.match) {
    selected.match = candidates[0] || null;
  }
  if (selected.match) {
    const latest = allEventMatches(readEventData(eventKey))
      .find(match => String(match.id) === String(lncMatch.id));
    if (latest && (!requiresEaCapture(latest) || latest.status !== 'confirmed')) {
      return { captured: false, reason: 'forfeit' };
    }
    if (latest && JSON.stringify(latest.result) !== JSON.stringify(lncMatch.result)) {
      return { captured: false, reason: 'result_changed', detail: 'Ergebnis während der EA-Abfrage geändert; erneute Prüfung folgt.' };
    }
    // Merge complementary player payloads only for the same EA match ID.
    const merged = { ...selected.match, players: {} };
    for (const match of candidates.filter(entry => eaMatchId(entry) === eaMatchId(selected.match))) {
      for (const [clubId, players] of Object.entries(match.players || {})) {
        merged.players[clubId] = { ...(merged.players[clubId] || {}), ...players };
      }
    }
    // The selected fixture has exactly one unlinked opponent. Map it only for this
    // fixture, without changing the team's permanent EA club connection.
    const entries = Object.entries(clubMap(merged));
    if (linked.length === 1 && teams.length === 2 && entries.length === 2) {
      const ownEntry = eaClubEntry(merged, linked[0].eaClub.clubId);
      const opponentEntry = ownEntry && entries.find(([key]) => key !== ownEntry[0]);
      const opponentTeam = teams.find(team => String(team.id) !== String(linked[0].id));
      if (opponentEntry && opponentTeam) {
        teamByEaClubId.set(clubIdOf(...opponentEntry), String(opponentTeam.id));
      }
    }
    persistMatch(eventKey, lncMatch, merged, teamByEaClubId, selected.decisionMatchId || ownCapture?.decisionMatchId);
    const rows = (readEventData(eventKey)?.ceremony?.teamOfTheTournament?.performances || [])
      .filter(row => String(row.lncMatchId) === String(lncMatch.id));
    const missingTeams = teams.filter(team => !rows.some(row => String(row.teamId) === String(team.id)));
    if (!missingTeams.length && rows.length) {
      return { captured: true, candidate: merged, rows, linked, fallback: selected.fallback, decisionMatchId: selected.decisionMatchId || ownCapture?.decisionMatchId };
    }
    return { captured: false, reason: rows.length ? 'partial_player_data' : 'no_player_data',
      detail: `EA-Spiel ${eaMatchId(merged)} gefunden. Keine verwertbaren Spielerwerte für: ${missingTeams.map(team => team.clubName || team.id).join(', ')}. Vorhandene Werte bleiben gespeichert.`, linked };
  }
  return { captured: false, reason: errors.length ? 'ea_request_failed' : 'match_not_found',
    detail: [
      `EA-Historien: ${queries.join('; ') || 'keine erfolgreiche Antwort'}.`,
      `Unterschiedliche EA-Match-IDs insgesamt: ${new Set(matches.map(eaMatchId)).size} (nicht die Anzahl passender Begegnungen).`,
      `Mit passenden Club-IDs: ${new Set(matches.filter(match => matchContainsClubs(match, teamByEaClubId)).map(eaMatchId)).size}.`,
      `Meldezeit: ${confirmedTimestampMs(lncMatch) ? new Date(confirmedTimestampMs(lncMatch)).toISOString() : 'fehlt'}; Zeitfenster ±10 Minuten (bei passendem Ergebnis bis 30 Minuten davor).`,
      selected.reason === 'decision_needs_review' ? 'Abbruch/Entscheidungsspiel gefunden, aber kein eindeutiges vollständiges Hauptspiel. Manuelle Prüfung erforderlich.'
        : selected.reason === 'ambiguous_recent_matches' ? 'Mehrere passende Begegnungen im Zeitfenster; keine unsichere Zuordnung.'
        : 'Kein unverbrauchtes Spiel mit passenden Club-IDs im Zeitfenster gefunden.',
      candidateDiagnostics(matches, lncMatch, linked, excludedIds),
      ...errors,
    ].join('\n'), linked };

}

function scheduleRatingCapture(eventKey, lncMatch) {
  if (!lncMatch?.id || lncMatch.status !== 'confirmed' || !requiresEaCapture(lncMatch)) return false;
  const key = `${eventKey}:${lncMatch.id}`;
  if (captureTimers.has(key)) return false;
  let attempt = 0; let firstWarningSent = false;
  const run = async () => {
    let lastError = null; let lastDetail = null;
    try {
      const result = await captureOnce(eventKey, lncMatch);
      if (result.captured) {
        const counts = new Map();
        for (const row of result.rows || []) counts.set(row.teamId, (counts.get(row.teamId) || 0) + 1);
        const details = [lncMatch?.home?.teamId, lncMatch?.away?.teamId]
          .map(teamId => `${teamName(teamId)}: **${counts.get(String(teamId)) || 0} Spielerwerte**`).join('\n');
        const fallbackWarning = result.decisionMatchId ? ['', '**ENTSCHEIDUNGSSPIEL ERKANNT**',
          `EA ${result.decisionMatchId}: Abbruch nach dem Unentschieden. Nur Spielerwerte aus dem Hauptspiel werden gewertet.`] : result.fallback ? ['', '⚠️ **ERGEBNISABWEICHUNG – FALLBACK VERWENDET**',
          `Night Cup eingetragen: **${lncMatch.result.homeGoals}:${lncMatch.result.awayGoals}**`,
          `EA Match-Ergebnis: **${eaScore(result.candidate).join(':')}**`,
          'Hinterlegte EA-Club-ID(s) + Zeitfenster passen; genau **eine** aktuelle Begegnung gefunden. EA-Spielerwerte werden unverändert übernommen.'] : [];
        await sendTracker(['✅ **TOTT MATCH ERFASST**', matchLabel(lncMatch), '', `EA Match-ID: **${eaMatchId(result.candidate)}**`,
          linkedStatus(lncMatch), details, '**Gespeichert:** ✅', ...fallbackWarning].join('\n'));
        captureTimers.delete(key); return;
      }
      lastDetail = result.detail;
      if (['no_linked_teams', 'bye_or_non_real_match', 'forfeit'].includes(result.reason)) { captureTimers.delete(key); return; }
    } catch (error) {
      lastError = error; console.warn(`[tott] EA-Daten konnten für ${key} nicht geladen werden: ${error.message}`);
    }
    attempt += 1;
    if (!firstWarningSent) {
      firstWarningSent = true;
      await sendTracker(['⚠️ **TOTT MATCH NOCH NICHT ERFASST**', matchLabel(lncMatch), '', linkedStatus(lncMatch),
        lastError ? `EA-Fehler: **${lastError.message}**` : (lastDetail || 'EA erreichbar, aber das passende Match wurde noch nicht gefunden.'),
        '**Weitere Versuche laufen automatisch.**'].join('\n'));
    }
    if (attempt >= RETRY_DELAYS_MS.length) {
      console.warn(`[tott] ${key}: nach ${attempt} EA-Abfragen noch keine passenden Matchdaten gefunden.`);
      await sendTracker(['🔴 **TOTT MATCH NICHT ERFASST**', matchLabel(lncMatch), '', linkedStatus(lncMatch),
        `Nach **${attempt} Versuchen** konnten keine passenden EA-Matchdaten gespeichert werden.`,
        lastError ? `Letzter EA-Fehler: **${lastError.message}**` : (lastDetail || 'EA hat kein eindeutig passendes Match geliefert.')].join('\n'));
      captureTimers.delete(key); return;
    }
    const timer = setTimeout(run, RETRY_DELAYS_MS[attempt]);
    if (typeof timer.unref === 'function') timer.unref(); captureTimers.set(key, timer);
  };
  captureTimers.set(key, true); run(); return true;
}

function allEventMatches(event) {
  const matches = [
    ...Object.values(event?.groups?.groups || {}).flatMap(group => group?.matchdays || []).flatMap(day => day?.matches || []),
    ...(event?.leaguePhase?.matchdays || []).flatMap(day => day?.matches || []),
    ...Object.values(event?.knockout?.rounds || {}).flatMap(round => round?.matches || []),
  ].filter(match => match?.id);
  return [...new Map(matches.map(match => [String(match.id), match])).values()];
}

function confirmedEventMatches(event) {
  return allEventMatches(event)
    .filter(match => match.status === 'confirmed' && match.result && isRealEaMatch(match));
}

function tottOpportunityMatches(event) {
  return allEventMatches(event).filter(match => {
    if (isRealEaMatch(match)) return match.status === 'confirmed' && Boolean(match.result);
    const participants = [match?.home, match?.away];
    return participants.some(entry => entry?.type === 'team')
      && participants.some(entry => entry?.type === 'bye')
      && ['bye', 'confirmed'].includes(match.status);
  });
}

function hasCompleteCapture(event, match) {
  const state = event?.ceremony?.teamOfTheTournament || {};
  if (!(state.capturedMatches || []).some(entry => String(entry.lncMatchId) === String(match.id))) return false;
  return [match.home?.teamId, match.away?.teamId].every(teamId => teamId &&
    (state.performances || []).some(row =>
      String(row.lncMatchId) === String(match.id) && String(row.teamId) === String(teamId)));
}

function refreshSelection(eventKey) {
  let selection = null;
  updateEventData(eventKey, event => {
    event.ceremony = event.ceremony || {};
    const state = event.ceremony.teamOfTheTournament || { performances: [], capturedMatches: [], selection: null };
    state.selection = buildSelection(state.performances || [], tottOpportunityMatches(event));
    state.updatedAt = new Date().toISOString();
    event.ceremony.teamOfTheTournament = state;
    selection = state.selection;
    return event;
  });
  return selection;
}

async function capturePendingMatchesNow(eventKey, event = readEventData(eventKey)) {
  const pending = confirmedEventMatches(event)
    .filter(requiresEaCapture)
    .filter(match => !hasCompleteCapture(event, match));
  let captured = 0; let missing = 0; let skipped = 0;

  for (const match of pending) {
    const timerKey = `${eventKey}:${match.id}`;
    const scheduled = captureTimers.get(timerKey);
    if (scheduled && scheduled !== true) clearTimeout(scheduled);
    captureTimers.delete(timerKey);
    try {
      const result = await captureOnce(eventKey, match);
      if (result.captured) captured += 1;
      else if (result.reason === 'no_linked_teams') skipped += 1;
      else missing += 1;
    } catch (error) {
      missing += 1;
      console.warn(`[tott] Abschlussprüfung ${eventKey}:${match.id} fehlgeschlagen: ${error.message}`);
    }
  }

  refreshSelection(eventKey);
  const latest = readEventData(eventKey);
  const opportunities = tottOpportunityMatches(latest);
  const forfeits = opportunities.filter(match => isRealEaMatch(match) && match.result?.matchPlayed === false).length;
  const byes = opportunities.filter(match => !isRealEaMatch(match)).length;
  await sendTracker([
    '📊 **TOTT ABSCHLUSSPRÜFUNG**',
    `Fehlende EA-Spiele geprüft: **${pending.length}**`,
    `Davon nachträglich erfasst: **${captured}**`,
    `Weiterhin fehlend oder unvollständig: **${missing}**`,
    `Ohne EA-Club-Verknüpfung: **${skipped}**`,
    `Kampflos gewertete Spiele: **${forfeits}**`,
    `Freilose: **${byes}**`,
    missing || forfeits || byes
      ? '✅ Für nicht erfasste Begegnungen wurden keine künstlichen TOTT-Punkte vergeben.'
      : '✅ Alle vorgesehenen Leistungen konnten anhand der erfassten EA-Daten berechnet werden.',
  ].join('\n'));
  return { checked: pending.length, captured, missing, skipped, forfeits, byes };
}

function resumeRatingCaptures(eventKey, event = readEventData(eventKey)) {
  let scheduled = 0;
  for (const match of confirmedEventMatches(event)) {
    if (hasCompleteCapture(event, match)) continue;
    if (scheduleRatingCapture(eventKey, match)) scheduled += 1;
  }
  return scheduled;
}

module.exports = {
  FORMATION, MAX_MATCH_TIME_DISTANCE_MS, MINIMUM_MATCHES, MINIMUM_TEAM_MATCH_RATIO, TOTT_SCORING,
  buildRankings, buildSelection, calculateTottPoints, capturePendingMatchesNow, confirmedEventMatches, isRealEaMatch,
  normalizePosition, refreshSelection, requiresEaCapture, resumeRatingCaptures, scheduleRatingCapture,
  selectEaMatch, tottOpportunityMatches, hasCompleteCapture,
};


