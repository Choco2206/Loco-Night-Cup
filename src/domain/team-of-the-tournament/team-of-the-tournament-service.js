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

function isRealEaMatch(lncMatch) {
  return lncMatch?.home?.type === 'team' && lncMatch?.away?.type === 'team';
}

function eaMatchId(match) {
  return String(match?.matchId ?? match?.match_id ?? match?.id ?? '');
}

function clubMap(match) { return match?.clubs || match?.teams || {}; }

function clubGoals(club) {
  const value = club?.goals ?? club?.score ?? club?.goalsFor;
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

function selectEaMatch(matches, lncMatch, linkedTeams) {
  const confirmedAt = confirmedTimestampMs(lncMatch);
  const teamByEaClubId = new Map(linkedTeams.map(team => [String(team.eaClub.clubId), String(team.id)]));
  const baseCandidates = (matches || []).filter(match => {
    if (!eaMatchId(match) || !matchContainsClubs(match, teamByEaClubId)) return false;
    const matchAt = matchTimestampMs(match);
    if (linkedTeams.length === 1 && (!confirmedAt || !matchAt)) return false;
    return !confirmedAt || !matchAt || Math.abs(confirmedAt - matchAt) <= MAX_MATCH_TIME_DISTANCE_MS;
  });
  const exactCandidates = baseCandidates.filter(match => linkedTeams.length > 1
    ? scoreMatches(match, lncMatch)
    : linkedTeamScoreMatches(match, lncMatch, linkedTeams[0], linkedTeams[0].eaClub.clubId));
  const sortByTime = (a, b) => {
    if (!confirmedAt) return 0;
    return Math.abs(confirmedAt - (matchTimestampMs(a) || confirmedAt))
      - Math.abs(confirmedAt - (matchTimestampMs(b) || confirmedAt));
  };
  if (exactCandidates.length) return { match: exactCandidates.sort(sortByTime)[0], fallback: false };
  if (linkedTeams.length > 1) {
    const timedCandidates = baseCandidates.filter(match => withinMatchWindow(match, confirmedAt));
    if (timedCandidates.length === 1) return { match: timedCandidates[0], fallback: true };
  }
  return { match: null, fallback: false };
}

function playerRows(match, teamByEaClubId, lncMatchId) {
  const rows = [];
  const playersByClub = match?.players || {};
  for (const [rawClubId, players] of Object.entries(playersByClub)) {
    const club = clubMap(match)?.[rawClubId] || {};
    const clubId = String(club?.clubId ?? club?.club_id ?? rawClubId);
    const teamId = teamByEaClubId.get(clubId);
    if (!teamId || !players || typeof players !== 'object') continue;
    const goalsConceded = Object.entries(clubMap(match))
      .filter(([key, opponent]) => String(key) !== String(rawClubId)
        && String(opponent?.clubId ?? opponent?.club_id ?? key) !== clubId)
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

function buildSelection(performances, tournamentMatches = []) {
  const teamMatches = new Map();
  const legacyWins = new Map();
  for (const match of tournamentMatches || []) {
    const homeGoals = Number(match?.result?.homeGoals); const awayGoals = Number(match?.result?.awayGoals);
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
    const requiredMatches = Math.max(MINIMUM_MATCHES,
      Math.ceil((teamMatches.get(String(item.teamId))?.size || 0) * MINIMUM_TEAM_MATCH_RATIO));
    return playedMatches >= requiredMatches;
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
    const totalTottPoints = calculateTottPoints(player, player.position);
    return { ...player, totalTottPoints, tottPpg: Number((totalTottPoints / player.matches).toFixed(4)) };
  });

  const byPosition = Object.fromEntries(Object.keys(FORMATION).map(position => [position, eligible.filter(player => player.position === position)]));
  const comparePlayers = (a, b) => b.totalTottPoints - a.totalTottPoints || b.tottPpg - a.tottPpg
    || b.averageRating - a.averageRating || b.manOfTheMatch - a.manOfTheMatch || b.matches - a.matches;
  return Object.fromEntries(Object.entries(FORMATION).map(([position, count]) => [
    position, byPosition[position].sort(comparePlayers).slice(0, count),
  ]));
}

function persistMatch(eventKey, lncMatch, eaMatch, teamByEaClubId) {
  let stored = false; let storedRows = [];
  updateEventData(eventKey, event => {
    event.ceremony = event.ceremony || {};
    const state = event.ceremony.teamOfTheTournament || { performances: [], capturedMatches: [], selection: null };
    if (state.capturedMatches.some(entry => String(entry.eaMatchId) === eaMatchId(eaMatch))) return event;
    const rows = playerRows(eaMatch, teamByEaClubId, lncMatch.id);
    if (!rows.length) return event;
    state.performances.push(...rows);
    state.capturedMatches.push({ lncMatchId: String(lncMatch.id), eaMatchId: eaMatchId(eaMatch), capturedAt: new Date().toISOString() });
    state.selection = buildSelection(state.performances, confirmedEventMatches(event)); state.updatedAt = new Date().toISOString();
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

async function captureOnce(eventKey, lncMatch) {
  if (!isRealEaMatch(lncMatch)) return { captured: false, reason: 'bye_or_non_real_match' };
  const teams = [lncMatch?.home?.teamId, lncMatch?.away?.teamId].map(findTeamById).filter(Boolean);
  const linked = teams.filter(team => team.eaClub?.clubId);
  if (!linked.length || !lncMatch?.result) return { captured: false, reason: 'no_linked_teams' };
  const teamByEaClubId = new Map(linked.map(team => [String(team.eaClub.clubId), String(team.id)]));
  for (const team of linked) {
    const matches = await getFriendlyMatches(team.eaClub.clubId, team.eaClub.platform);
    const selected = selectEaMatch(matches, lncMatch, linked);
    if (selected.match) {
      const result = persistMatch(eventKey, lncMatch, selected.match, teamByEaClubId);
      if (result.stored) return { captured: true, candidate: selected.match, rows: result.rows, linked, fallback: selected.fallback };
    }
  }
  return { captured: false, reason: 'match_not_found', linked };
}

function scheduleRatingCapture(eventKey, lncMatch) {
  if (!lncMatch?.id || lncMatch.status !== 'confirmed' || !isRealEaMatch(lncMatch)) return false;
  const key = `${eventKey}:${lncMatch.id}`;
  if (captureTimers.has(key)) return false;
  let attempt = 0; let firstWarningSent = false;
  const run = async () => {
    let lastError = null;
    try {
      const result = await captureOnce(eventKey, lncMatch);
      if (result.captured) {
        const counts = new Map();
        for (const row of result.rows || []) counts.set(row.teamId, (counts.get(row.teamId) || 0) + 1);
        const details = [lncMatch?.home?.teamId, lncMatch?.away?.teamId]
          .map(teamId => `${teamName(teamId)}: **${counts.get(String(teamId)) || 0} Spielerwerte**`).join('\n');
        const fallbackWarning = result.fallback ? ['', '⚠️ **ERGEBNISABWEICHUNG – FALLBACK VERWENDET**',
          `Night Cup eingetragen: **${lncMatch.result.homeGoals}:${lncMatch.result.awayGoals}**`,
          `EA Match-Ergebnis: **${eaScore(result.candidate).join(':')}**`,
          'Beide EA-Clubs + Zeitfenster waren eindeutig; es gab genau **einen** gemeinsamen Match-Kandidaten.'] : [];
        await sendTracker(['✅ **TOTT MATCH ERFASST**', matchLabel(lncMatch), '', `EA Match-ID: **${eaMatchId(result.candidate)}**`,
          linkedStatus(lncMatch), details, '**Gespeichert:** ✅', ...fallbackWarning].join('\n'));
        captureTimers.delete(key); return;
      }
      if (['no_linked_teams', 'bye_or_non_real_match'].includes(result.reason)) { captureTimers.delete(key); return; }
    } catch (error) {
      lastError = error; console.warn(`[tott] EA-Daten konnten für ${key} nicht geladen werden: ${error.message}`);
    }
    attempt += 1;
    if (!firstWarningSent) {
      firstWarningSent = true;
      await sendTracker(['⚠️ **TOTT MATCH NOCH NICHT ERFASST**', matchLabel(lncMatch), '', linkedStatus(lncMatch),
        lastError ? `EA-Fehler: **${lastError.message}**` : 'EA erreichbar, aber das passende Match wurde noch nicht gefunden.',
        '**Weitere Versuche laufen automatisch.**'].join('\n'));
    }
    if (attempt >= RETRY_DELAYS_MS.length) {
      console.warn(`[tott] ${key}: nach ${attempt} EA-Abfragen noch keine passenden Matchdaten gefunden.`);
      await sendTracker(['🔴 **TOTT MATCH NICHT ERFASST**', matchLabel(lncMatch), '', linkedStatus(lncMatch),
        `Nach **${attempt} Versuchen** konnten keine passenden EA-Matchdaten gespeichert werden.`,
        lastError ? `Letzter EA-Fehler: **${lastError.message}**` : 'EA hat kein eindeutig passendes Match geliefert.'].join('\n'));
      captureTimers.delete(key); return;
    }
    const timer = setTimeout(run, RETRY_DELAYS_MS[attempt]);
    if (typeof timer.unref === 'function') timer.unref(); captureTimers.set(key, timer);
  };
  captureTimers.set(key, true); run(); return true;
}

function confirmedEventMatches(event) {
  const matches = [
    ...Object.values(event?.groups?.groups || {}).flatMap(group => group?.matchdays || []).flatMap(day => day?.matches || []),
    ...(event?.leaguePhase?.matchdays || []).flatMap(day => day?.matches || []),
    ...Object.values(event?.knockout?.rounds || {}).flatMap(round => round?.matches || []),
  ].filter(match => match?.id && match.status === 'confirmed' && match.result && isRealEaMatch(match));
  return [...new Map(matches.map(match => [String(match.id), match])).values()];
}

function resumeRatingCaptures(eventKey, event = readEventData(eventKey)) {
  const captured = new Set((event?.ceremony?.teamOfTheTournament?.capturedMatches || []).map(entry => String(entry.lncMatchId)));
  let scheduled = 0;
  for (const match of confirmedEventMatches(event)) {
    if (captured.has(String(match.id))) continue;
    if (scheduleRatingCapture(eventKey, match)) scheduled += 1;
  }
  return scheduled;
}

module.exports = {
  FORMATION, MAX_MATCH_TIME_DISTANCE_MS, MINIMUM_MATCHES, MINIMUM_TEAM_MATCH_RATIO, TOTT_SCORING,
  buildSelection, calculateTottPoints, confirmedEventMatches, isRealEaMatch, normalizePosition, resumeRatingCaptures,
  scheduleRatingCapture, selectEaMatch,
};
