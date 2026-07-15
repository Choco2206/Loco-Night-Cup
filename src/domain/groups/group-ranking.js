'use strict';

const loggedDrawDecisions = new Set();

function participantKey(row) {
  return row.participantKey || (row.teamId ? `team:${row.teamId}` : null);
}

function basicCompare(a, b) {
  return (
    Number(b.points || 0) - Number(a.points || 0) ||
    Number(b.goalDifference || 0) - Number(a.goalDifference || 0) ||
    Number(b.goalsFor || 0) - Number(a.goalsFor || 0) ||
    Number(a.goalsAgainst || 0) - Number(b.goalsAgainst || 0)
  );
}

function getMatches(group) {
  return (group.matchdays || []).flatMap(matchday => matchday.matches || []);
}

function matchParticipantKey(participant) {
  if (!participant) return null;
  if (participant.participantKey) return participant.participantKey;
  if (participant.type === 'team') return `team:${participant.teamId}`;
  return null;
}

function addMiniResult(row, goalsFor, goalsAgainst) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  row.goalDifference = row.goalsFor - row.goalsAgainst;
  if (goalsFor > goalsAgainst) row.points += 3;
  else if (goalsFor === goalsAgainst) row.points += 1;
}

function buildMiniTable(group, tiedRows) {
  const tiedKeys = new Set(tiedRows.map(participantKey).filter(Boolean));
  const miniRows = new Map([...tiedKeys].map(key => [key, {
    participantKey: key,
    played: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
  }]));

  for (const match of getMatches(group)) {
    if (match.status !== 'confirmed' || !match.result) continue;
    const homeKey = matchParticipantKey(match.home);
    const awayKey = matchParticipantKey(match.away);
    if (!tiedKeys.has(homeKey) || !tiedKeys.has(awayKey)) continue;

    addMiniResult(miniRows.get(homeKey), Number(match.result.homeGoals), Number(match.result.awayGoals));
    addMiniResult(miniRows.get(awayKey), Number(match.result.awayGoals), Number(match.result.homeGoals));
  }

  return miniRows;
}

function directCompare(group, a, b, allRows) {
  if (!group) return 0;
  const tiedRows = allRows.filter(row => basicCompare(row, a) === 0);
  if (tiedRows.length < 2) return 0;

  const miniRows = buildMiniTable(group, tiedRows);
  const aMini = miniRows.get(participantKey(a));
  const bMini = miniRows.get(participantKey(b));
  if (!aMini || !bMini || !aMini.played || !bMini.played) return 0;
  return basicCompare(aMini, bMini);
}

function botDrawScore(row, groupKey = '') {
  const input = `${groupKey}:${row.teamId || row.participantKey || row.displayName || ''}`;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function botDrawCompare(a, b, groupKey = '') {
  const aScore = botDrawScore(a, groupKey);
  const bScore = botDrawScore(b, groupKey);
  const result = aScore - bScore;
  const winner = result <= 0 ? a : b;
  const loser = result <= 0 ? b : a;
  const logKey = [groupKey, a.teamId || a.displayName, b.teamId || b.displayName].sort().join(':');
  if (!loggedDrawDecisions.has(logKey)) {
    loggedDrawDecisions.add(logKey);
    console.warn(`Losentscheid: ${winner.displayName || winner.teamId} vor ${loser.displayName || loser.teamId} wegen komplett identischer Werte.`);
  }
  return result || String(a.teamId || '').localeCompare(String(b.teamId || ''), 'de', { sensitivity: 'base' });
}

function compareGroupRows(group, allRows, a, b) {
  return (
    basicCompare(a, b) ||
    directCompare(group, a, b, allRows) ||
    botDrawCompare(a, b, group?.groupKey || '')
  );
}

function rankGroupRows(group) {
  const rows = (group?.standings || []).filter(row => row.teamId || row.participantKey).slice();
  return rows.sort((a, b) => compareGroupRows(group, rows, a, b));
}

function compareThirdPlaceRows(a, b) {
  return (
    basicCompare(a, b) ||
    botDrawCompare(a, b, 'third-place')
  );
}

module.exports = {
  compareThirdPlaceRows,
  rankGroupRows,
};
