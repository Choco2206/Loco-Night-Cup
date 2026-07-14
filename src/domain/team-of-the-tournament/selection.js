'use strict';

const config = require('./config');

function playerKey(performance) { return `${performance.proClubId}:${performance.playerId || String(performance.playerName).toLocaleLowerCase('de')}`; }
function numericRating(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function aggregatePerformances(matches) {
  const players = new Map();
  for (const match of matches || []) for (const performance of match.players || []) {
    const rating = numericRating(performance.rating);
    if (!performance.isHuman || rating === null || !performance.normalizedPosition?.group) continue;
    const key = playerKey(performance);
    const entry = players.get(key) || { key, playerId: performance.playerId || key, playerName: performance.playerName, proClubId: String(performance.proClubId), discordTeamId: performance.discordTeamId, ratings: [], positions: {}, koMatches: 0, potm: 0, goals: 0, assists: 0, secondsPlayed: 0, saves: 0, bestRating: -Infinity, lastPosition: null };
    entry.ratings.push(rating);
    const group = performance.normalizedPosition.group;
    const position = entry.positions[group] || { appearances: 0, minutes: 0, ratings: [], koMatches: 0 };
    position.appearances += 1; position.minutes += Number(performance.minutes) || 0; position.ratings.push(rating); position.koMatches += match.phase === 'knockout' ? 1 : 0;
    entry.positions[group] = position; entry.koMatches += match.phase === 'knockout' ? 1 : 0; entry.potm += performance.playerOfTheMatch ? 1 : 0; entry.bestRating = Math.max(entry.bestRating, rating); entry.lastPosition = group;
    entry.goals += Number(performance.goals) || 0; entry.assists += Number(performance.assists) || 0; entry.secondsPlayed += Number(performance.secondsPlayed) || (Number(performance.minutes) || 0) * 60; entry.saves += Number(performance.saves) || 0; players.set(key, entry);
  }
  return [...players.values()].map(player => {
    player.average = player.ratings.reduce((sum, value) => sum + value, 0) / player.ratings.length;
    player.matches = player.ratings.length;
    player.primaryGroup = Object.entries(player.positions).sort((a, b) => b[1].appearances - a[1].appearances || b[1].minutes - a[1].minutes || (b[1].ratings.reduce((s,v)=>s+v,0)/b[1].ratings.length) - (a[1].ratings.reduce((s,v)=>s+v,0)/a[1].ratings.length) || b[1].koMatches - a[1].koMatches || Number(b[0] === player.lastPosition) - Number(a[0] === player.lastPosition) || config.groupOrder.indexOf(a[0]) - config.groupOrder.indexOf(b[0]))[0][0];
    return player;
  });
}
function comparePlayers(a, b) { return b.average - a.average || b.matches - a.matches || b.potm - a.potm || b.goals - a.goals || b.assists - a.assists || b.secondsPlayed - a.secondsPlayed || String(a.playerId).localeCompare(String(b.playerId)); }
function selectTeam(matches, minMatches = config.minMatches) {
  const players = aggregatePerformances(matches); const selectedKeys = new Set(); const slots = {}; const fallbacks = [];
  for (const [group, definition] of Object.entries(config.positionGroups)) {
    let pool = players.filter(player => player.primaryGroup === group && player.matches >= minMatches && !selectedKeys.has(player.key)).sort(comparePlayers);
    if (pool.length < definition.amount) { fallbacks.push(group); pool = players.filter(player => player.primaryGroup === group && player.matches >= 1 && !selectedKeys.has(player.key)).sort(comparePlayers); }
    definition.slots.forEach((slot, index) => { const player = pool[index] || null; slots[slot] = player; if (player) selectedKeys.add(player.key); });
  }
  return { slots, players, fallbacks };
}
function formatRating(value) { return Number(value).toFixed(1).replace('.', ','); }
module.exports = { aggregatePerformances, comparePlayers, formatRating, playerKey, selectTeam };
