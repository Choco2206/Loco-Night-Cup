'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createLegacyRankingDefault, createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readTeamsData } = require('../teams/team-repository');

const LEGACY_RANKING_CHANNEL_ID = '1534844186803830835';
const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
let reconcileTimer = null;

function integer(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : 0; }
function snapshotTeam(team) {
  const matches = team.history?.matches || {}; const titles = team.history?.titles || {};
  const wins = integer(matches.wins); const draws = integer(matches.draws); const losses = integer(matches.losses);
  const played = integer(matches.played) || wins + draws + losses; const goalsFor = integer(matches.goalsFor); const goalsAgainst = integer(matches.goalsAgainst);
  return { teamId: String(team.id), teamName: String(team.clubName || `Team ${team.id}`), status: team.status || 'active', cups: integer(team.history?.cupsPlayed), played, wins, draws, losses, goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst, points: wins * 3 + draws, tournamentWins: integer(titles.gold), finalAppearances: integer(titles.gold) + integer(titles.silver), updatedAt: new Date().toISOString() };
}
function syncLegacyRankingData() {
  let result;
  updateJson(FILES.legacyRanking, createLegacyRankingDefault(), data => {
    data.teams = data.teams || {};
    for (const team of readTeamsData().teams || []) {
      if (!team?.id) continue; const snapshot = snapshotTeam(team);
      if (snapshot.cups || snapshot.played) data.teams[snapshot.teamId] = snapshot;
    }
    data.meta = { ...(data.meta || {}), updatedAt: new Date().toISOString() }; result = data; return data;
  });
  return result;
}
function compareLegacyTeams(left, right) {
  return right.points - left.points || right.goalDifference - left.goalDifference || right.goalsFor - left.goalsFor || right.wins - left.wins || right.tournamentWins - left.tournamentWins || left.teamName.localeCompare(right.teamName, 'de', { sensitivity: 'base' }) || left.teamId.localeCompare(right.teamId);
}
function getLegacyRanking(data = syncLegacyRankingData()) { return Object.values(data.teams || {}).filter(team => team.cups || team.played).sort(compareLegacyTeams).map((team, index) => ({ ...team, rank: index + 1 })); }
function clipName(name, width = 20) { const value = String(name || 'Unbekannt'); return value.length > width ? `${value.slice(0, width - 1)}…` : value; }
function row(team) {
  const goals = `${team.goalsFor}:${team.goalsAgainst}`; const diff = team.goalDifference > 0 ? `+${team.goalDifference}` : String(team.goalDifference);
  return `${String(team.rank).padStart(2)} ${clipName(team.teamName).padEnd(20)} ${String(team.cups).padStart(4)} ${String(team.played).padStart(4)} ${String(team.wins).padStart(3)} ${String(team.draws).padStart(3)} ${String(team.losses).padStart(3)} ${goals.padStart(9)} ${diff.padStart(6)} ${String(team.points).padStart(5)}`;
}
function rankingPages(ranking, updatedAt = new Date().toISOString()) {
  const intro = ['🏛️ **LOCO LEGACY RANKING**', '', '**Hier wird die Geschichte des Loco Night Cups geschrieben – jeder Cup, jedes Tor und jeder Sieg hinterlässt seinen Platz in der Ewigkeit.**', '**Wertung:** Sieg 3 Punkte · Unentschieden 1 Punkt · Niederlage 0 Punkte', '**Sortierung:** Punkte · Tordifferenz · Tore · Siege · Turniersiege', '', '```', 'PL TEAM                 CUPS   SP   S   U   N      TORE  DIFF   PKT'].join('\n');
  const footer = `\n\nStand: ${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(new Date(updatedAt))}`;
  const rows = ranking.length ? ranking.map(row) : ['Noch keine abgeschlossenen Cups erfasst.']; const pages = []; let current = intro;
  for (const line of rows) { if (`${current}\n${line}\n\`${'``'}${footer}`.length > 1950) { pages.push(`${current}\n\`${'``'}`); current = ['```', 'PL TEAM                 CUPS   SP   S   U   N      TORE  DIFF   PKT', line].join('\n'); } else current += `\n${line}`; }
  pages.push(`${current}\n\`${'``'}${footer}`); return pages;
}
async function refreshLegacyRanking(client) {
  const data = syncLegacyRankingData(); const ranking = getLegacyRanking(data); const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = process.env.LEGACY_RANKING_CHANNEL_ID || settings.channels?.legacyRankingChannelId || LEGACY_RANKING_CHANNEL_ID;
  const channel = await client?.channels?.fetch(channelId).catch(() => null); if (!channel?.send) throw new Error(`Legacy-Ranking-Kanal nicht erreichbar: ${channelId}`);
  const messages = readJson(FILES.messages, createMessagesDefault()); const oldIds = messages.legacyRanking?.messageIds || []; const oldMessages = await Promise.all(oldIds.map(id => channel.messages.fetch(id).catch(() => null)));
  const reusable = oldMessages.every(Boolean) ? oldMessages : []; if (!reusable.length) for (const message of oldMessages.filter(Boolean)) await message.delete().catch(() => null);
  const pages = rankingPages(ranking, data.meta?.updatedAt); const nextIds = [];
  for (let index = 0; index < pages.length; index += 1) { const payload = { content: pages[index], allowedMentions: { parse: [] } }; const message = reusable[index] ? await reusable[index].edit(payload) : await channel.send(payload); nextIds.push(message.id); }
  for (let index = pages.length; index < reusable.length; index += 1) await reusable[index].delete().catch(() => null);
  updateJson(FILES.messages, createMessagesDefault(), current => { current.legacyRanking = { channelId: channel.id, messageIds: nextIds, updatedAt: new Date().toISOString() }; return current; });
  console.log(`[LegacyRanking] Tabelle aktualisiert: ${ranking.length} Teams`); return { ranking, messageIds: nextIds };
}
async function initLegacyRanking(client) {
  await refreshLegacyRanking(client).catch(error => console.warn(`[LegacyRanking] Startup-Aktualisierung wird erneut versucht: ${error.message}`));
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(() => refreshLegacyRanking(client).catch(error => console.warn(`[LegacyRanking] Reconcile fehlgeschlagen: ${error.message}`)), RECONCILE_INTERVAL_MS);
  if (typeof reconcileTimer.unref === 'function') reconcileTimer.unref();
  return true;
}

module.exports = { LEGACY_RANKING_CHANNEL_ID, compareLegacyTeams, getLegacyRanking, initLegacyRanking, rankingPages, refreshLegacyRanking, snapshotTeam, syncLegacyRankingData };
