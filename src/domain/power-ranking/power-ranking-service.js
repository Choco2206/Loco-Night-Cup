'use strict';

const { AttachmentBuilder } = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData } = require('../events/event-repository');
const { readTeamsData } = require('../teams/team-repository');
const { calculateWeekRanking, evaluateTournament, getWeekWindow } = require('./power-ranking-core');
const { readPowerRankingData, updatePowerRankingData } = require('./power-ranking-store');
const { renderChampionGraphic } = require('./power-ranking-renderer');

const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
let reconcileTimer = null;

function nowIso(now = new Date()) {
  return now.toISOString();
}

function teamsById() {
  return new Map(readTeamsData().teams.map(team => [String(team.id), team]));
}

function createWeekRecord(week, timestamp = nowIso()) {
  return {
    id: week.weekKey,
    weekKey: week.weekKey,
    year: week.year,
    calendarWeek: week.calendarWeek,
    startsAt: week.startsAt,
    endsAt: week.endsAt,
    startDate: week.startDate,
    endDate: week.endDate,
    status: 'ACTIVE',
    championTeamId: null,
    championTeamNameSnapshot: null,
    championPoints: null,
    championPostMessageId: null,
    championPostStatus: 'not_ready',
    finalizedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function recordTournamentEvaluation(evaluation, { replace = false } = {}) {
  let outcome;
  const timestamp = nowIso();
  updatePowerRankingData(data => {
    data.tournamentResults = data.tournamentResults || {};
    data.weeks = data.weeks || {};
    const existing = data.tournamentResults[evaluation.tournamentId];
    if (existing && !replace) {
      outcome = { created: false, reason: 'already_exists', tournament: existing };
      return data;
    }

    const results = Object.fromEntries(Object.entries(evaluation.results).map(([teamId, result]) => [teamId, {
      ...result,
      id: `${evaluation.tournamentId}:${teamId}`,
      createdAt: existing?.results?.[teamId]?.createdAt || timestamp,
      updatedAt: timestamp,
    }]));
    const tournament = {
      id: evaluation.tournamentId,
      tournamentId: evaluation.tournamentId,
      eventKey: evaluation.eventKey,
      tournamentDate: evaluation.tournamentDate,
      tournamentFinishedAt: evaluation.tournamentFinishedAt,
      weekKey: evaluation.week.weekKey,
      results,
      sourceSnapshot: evaluation.sourceSnapshot,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    data.tournamentResults[evaluation.tournamentId] = tournament;
    data.weeks[evaluation.week.weekKey] = data.weeks[evaluation.week.weekKey]
      || createWeekRecord(evaluation.week, timestamp);
    data.weeks[evaluation.week.weekKey].updatedAt = timestamp;
    data.meta = { ...(data.meta || {}), updatedAt: timestamp };
    outcome = { created: !existing, replaced: Boolean(existing), tournament };
    return data;
  });
  return outcome;
}

function evaluateAndStoreTournament(eventKey, event = readEventData(eventKey), { replace = false } = {}) {
  const evaluation = evaluateTournament({ eventKey, event, teamsById: teamsById() });
  const stored = recordTournamentEvaluation(evaluation, { replace });
  console.log(stored.created
    ? `[PowerRanking] Turnier ausgewertet: ${evaluation.tournamentId}`
    : stored.replaced
      ? `[PowerRanking] Turnier neu ausgewertet: ${evaluation.tournamentId}`
      : `[PowerRanking] Ergebnisse bereits vorhanden, übersprungen: ${evaluation.tournamentId}`);
  return { evaluation, stored };
}

function getRanking(weekKey) {
  return calculateWeekRanking(readPowerRankingData(), weekKey, teamsById());
}

function championContactUserIds(team) {
  return [team?.manager?.userId, ...(team?.coManagers || []).map(coManager => coManager?.userId)]
    .filter(Boolean)
    .map(String)
    .filter((userId, index, values) => values.indexOf(userId) === index);
}

function buildChampionPostContent({ champion, week, team = null, test = false }) {
  const contactIds = championContactUserIds(team);
  return [
    test ? '🧪 **TEST – Champion der Woche**' : null,
    `🏆 **${champion.teamName} ist Loco Power Ranking Champion der Woche!**`,
    contactIds.length ? `VM/Co-VM: ${contactIds.map(userId => `<@${userId}>`).join(' ')}` : null,
    '',
    `Mit **${champion.points} Punkten** sichert sich das Team Platz 1 in Kalenderwoche **${week.calendarWeek}**.`,
  ].filter(line => line !== null).join('\n');
}

function formatDate(value) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function rankingTeamName(name, width = 20) {
  const value = String(name || 'Unbekannt');
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

function rankingMovement(team) {
  if (team.change === null || team.change === undefined) return 'NEU';
  if (team.change > 0) return `+${team.change}`;
  if (team.change < 0) return String(team.change);
  return '=';
}

function rankingTableRow(team) {
  return `${String(team.rank).padStart(2)} ${rankingTeamName(team.teamName).padEnd(20)} ${String(team.points).padStart(4)} ${rankingMovement(team).padStart(4)} ${String(team.cups).padStart(4)} ${String(team.wins).padStart(3)} ${String(team.finalAppearances).padStart(3)} ${String(team.semifinalOrBetter).padStart(3)}`;
}

function rankingPages(ranking, week) {
  const endDate = week.endDate
    ? new Date(`${week.endDate}T12:00:00.000Z`)
    : new Date(new Date(week.endsAt).getTime() - 7 * 60 * 60 * 1000);
  const header = [
    '⚡ **LOCO POWER RANKING**',
    `Kalenderwoche **${week.calendarWeek}**`,
    `${formatDate(week.startsAt)} bis ${formatDate(endDate)}`,
    '',
    '**Punktevergabe:**',
    '🏆 Turniersieg: **10 Punkte**',
    '🥈 Platz 2: **8 Punkte**',
    '🥉 Platz 3: **6 Punkte**',
    '4. Platz / Halbfinale: **5 Punkte**',
    'Viertelfinale: **3 Punkte**',
    'Achtelfinale: **2 Punkte**',
    'Gruppen- oder Ligaphase: **1 Punkt**',
    '', '```',
    'PL TEAM                  PKT  BEW CUPS  TS FIN HF+',
  ].join('\n');
  const entries = ranking.teams.length ? ranking.teams.map(rankingTableRow) : ['Noch kein Cup wurde in dieser Kalenderwoche gewertet.'];
  const footer = [
    '', '```', '',
    `Cups dieser Woche: **${ranking.cups}**`,
    `Letzte Aktualisierung: ${ranking.lastUpdatedAt ? formatDateTime(ranking.lastUpdatedAt) : 'noch keine'}`,
    'Nächster Reset: Montag, 07:00 Uhr',
  ].join('\n');
  const pages = [];
  let current = header;
  for (const entry of entries) {
    const next = `${current}\n${entry}`;
    if (`${next}${footer}`.length > 1950 && current !== header) {
      pages.push(`${current}\n\`\`\``);
      current = `\`\`\`\nPL TEAM                  PKT  BEW CUPS  TS FIN HF+\n${entry}`;
    } else current = next;
  }
  pages.push(`${current}${footer}`);
  return pages;
}

async function resolveChannel(client, channelId) {
  if (!client || !channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.send ? channel : null;
}

async function refreshRankingMessage(client, weekKey) {
  const data = readPowerRankingData();
  const week = data.weeks?.[weekKey] || createWeekRecord(getWeekWindow(new Date()));
  const ranking = calculateWeekRanking(data, weekKey, teamsById());
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = process.env.POWER_RANKING_CHANNEL_ID || settings.channels?.powerRankingChannelId;
  const channel = await resolveChannel(client, channelId);
  if (!channel) throw new Error(`Power-Ranking-Kanal nicht erreichbar: ${channelId || 'nicht konfiguriert'}`);
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.powerRanking || createMessagesDefault().powerRanking;
  const oldIds = Array.isArray(state.messageIds) ? state.messageIds : [];
  const oldMessages = await Promise.all(oldIds.map(id => channel.messages.fetch(id).catch(() => null)));
  const pages = rankingPages(ranking, week);
  let nextIds = [];

  if (oldIds.length && oldMessages.some(message => !message)) {
    for (const message of oldMessages) if (message) await message.delete().catch(() => {});
  } else {
    nextIds = oldMessages.filter(Boolean).map(message => message.id);
  }
  const reusable = oldIds.length && oldMessages.every(Boolean) ? oldMessages : [];
  nextIds = [];
  for (let index = 0; index < pages.length; index += 1) {
    const payload = { content: pages[index], allowedMentions: { parse: [] } };
    const message = reusable[index]
      ? await reusable[index].edit(payload)
      : await channel.send(payload);
    nextIds.push(message.id);
  }
  for (let index = pages.length; index < reusable.length; index += 1) {
    await reusable[index].delete().catch(() => {});
  }
  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.powerRanking = { weekKey, channelId: channel.id, messageIds: nextIds, updatedAt: nowIso() };
    return current;
  });
  console.log(`[PowerRanking] Ranking-Nachricht editiert: ${weekKey}`);
  return { ranking, week, messageIds: nextIds };
}

function latestLogoSnapshot(data, weekKey, teamId) {
  return Object.values(data.tournamentResults || {})
    .filter(bucket => bucket.weekKey === weekKey && bucket.results?.[teamId])
    .sort((a, b) => String(b.tournamentFinishedAt).localeCompare(String(a.tournamentFinishedAt)))[0]
    ?.results?.[teamId]?.teamLogoSnapshot || null;
}

async function findExistingChampionPost(channel, fileName) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  return recent?.find(message => message.attachments?.some(attachment => attachment.name === fileName)) || null;
}

async function publishChampionPost(client, weekKey, { renderGraphic = renderChampionGraphic } = {}) {
  const data = readPowerRankingData();
  const week = data.weeks?.[weekKey];
  if (!week || week.status !== 'FINALIZED' || !week.championTeamId) return { posted: false, reason: 'not_ready' };
  if (week.championPostMessageId) return { posted: false, reason: 'already_posted', messageId: week.championPostMessageId };
  const ranking = calculateWeekRanking(data, weekKey, teamsById());
  const champion = ranking.teams[0];
  if (!champion) return { posted: false, reason: 'empty_week' };
  const settings = readJson(FILES.settings, createSettingsDefault());
  const championChannelId = process.env.POWER_RANKING_CHAMPION_CHANNEL_ID
    || settings.channels?.powerRankingChampionChannelId;
  const channel = await resolveChannel(client, championChannelId);
  if (!channel) throw new Error('Power-Ranking-Champion-Kanal ist nicht erreichbar.');
  const fileName = `power-ranking-champion-${weekKey}.png`;
  let message = await findExistingChampionPost(channel, fileName);
  if (!message) {
    const currentTeam = teamsById().get(String(champion.teamId));
    const graphic = await renderGraphic({
      week,
      champion,
      logoSnapshot: currentTeam && currentTeam.status !== 'deleted' && currentTeam.logo
        ? currentTeam.logo
        : latestLogoSnapshot(data, weekKey, champion.teamId),
    });
    console.log(`[PowerRanking] Champion-Grafik erstellt: ${weekKey}`);
    message = await channel.send({
      content: buildChampionPostContent({ champion, week, team: currentTeam }),
      files: [new AttachmentBuilder(graphic.buffer, { name: graphic.fileName })],
      allowedMentions: { parse: [], users: championContactUserIds(currentTeam) },
    });
  }
  updatePowerRankingData(current => {
    const storedWeek = current.weeks?.[weekKey];
    if (!storedWeek) return current;
    storedWeek.championPostMessageId = message.id;
    storedWeek.championPostStatus = 'posted';
    storedWeek.updatedAt = nowIso();
    return current;
  });
  console.log(`[PowerRanking] Champion-Post veröffentlicht: ${weekKey}`);
  return { posted: true, messageId: message.id };
}

function finalizeWeekData(weekKey, now = new Date()) {
  let result;
  updatePowerRankingData(data => {
    const week = data.weeks?.[weekKey];
    if (!week) {
      result = { finalized: false, reason: 'week_not_found' };
      return data;
    }
    if (week.status === 'FINALIZED') {
      result = { finalized: false, reason: 'already_finalized', week };
      return data;
    }
    const ranking = calculateWeekRanking(data, weekKey, teamsById());
    const champion = ranking.teams[0] || null;
    week.status = 'FINALIZED';
    week.championTeamId = champion?.teamId || null;
    week.championTeamNameSnapshot = champion?.teamName || null;
    week.championPoints = champion?.points ?? null;
    week.championPostStatus = champion ? 'pending' : 'not_required';
    week.finalizedAt = nowIso(now);
    week.updatedAt = week.finalizedAt;
    result = { finalized: true, week, champion };
    return data;
  });
  if (result.finalized) console.log(`[PowerRanking] Woche finalisiert: ${weekKey}`);
  return result;
}

async function finalizeWeek({ client, weekKey, now = new Date() }) {
  const result = finalizeWeekData(weekKey, now);
  if (result.week?.championTeamId && !result.week.championPostMessageId) {
    await publishChampionPost(client, weekKey);
  }
  return result;
}

async function processCompletedTournament({ client, eventKey, event = null }) {
  const completedEvent = event || readEventData(eventKey);
  const { evaluation, stored } = evaluateAndStoreTournament(eventKey, completedEvent);
  try {
    await refreshRankingMessage(client, evaluation.week.weekKey);
    console.log(`[PowerRanking] Wochenranking aktualisiert: ${evaluation.week.weekKey}`);
  } catch (error) {
    console.warn(`[PowerRanking] Discord-Ranking konnte nicht aktualisiert werden; Daten bleiben gespeichert: ${error.message}`);
  }
  try {
    const { refreshLegacyRanking } = require('../legacy-ranking');
    await refreshLegacyRanking(client);
  } catch (error) {
    console.warn(`[LegacyRanking] Aktualisierung wird später erneut versucht: ${error.message}`);
  }
  if (eventKey === 'sunday') {
    const finalized = finalizeWeekData(evaluation.week.weekKey);
    try {
      await publishChampionPost(client, evaluation.week.weekKey);
    } catch (error) {
      console.warn(`[PowerRanking] Champion-Post wird später erneut versucht: ${error.message}`);
    }
    return { evaluation, stored, finalized };
  }
  return { evaluation, stored };
}

async function rebuildPowerRankingForTournament(tournamentId, { client = null, event = null } = {}) {
  const data = readPowerRankingData();
  const existing = data.tournamentResults?.[tournamentId];
  if (!existing) throw new Error(`Power-Ranking-Turnier nicht gefunden: ${tournamentId}`);
  const sourceEvent = event || EVENT_KEYS.map(readEventData).find(candidate => candidate.cycle?.cycleKey === tournamentId) || existing.sourceSnapshot;
  const week = data.weeks?.[existing.weekKey];
  if (week?.status === 'FINALIZED') {
    console.warn(`[PowerRanking] Admin-Warnung: Finalisierte Woche ${week.weekKey} wird neu berechnet; es wird kein zweiter Champion-Post erstellt.`);
  }
  const evaluation = evaluateTournament({ eventKey: existing.eventKey, event: sourceEvent, teamsById: teamsById() });
  recordTournamentEvaluation(evaluation, { replace: true });
  if (client && week?.status !== 'FINALIZED') await refreshRankingMessage(client, evaluation.week.weekKey);
  return { tournamentId, weekKey: evaluation.week.weekKey, finalizedWeek: week?.status === 'FINALIZED' };
}

function isSundayEventStillRunningForWeek(week) {
  const sunday = readEventData('sunday');
  if (sunday.cycle?.eventDate !== week.endDate) return false;
  if (sunday.knockout?.status === 'completed') return false;
  return !['idle', 'checkin', 'checkin_open', 'cancelled', 'reset', 'completed'].includes(sunday.status);
}

async function reconcilePowerRanking(client, now = new Date()) {
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (event.knockout?.status !== 'completed' || event.meta?.testMode === true || !event.cycle?.cycleKey) continue;
    try {
      const { evaluation } = evaluateAndStoreTournament(eventKey, event);
      if (eventKey === 'sunday') finalizeWeekData(evaluation.week.weekKey, now);
    } catch (error) {
      console.warn(`[PowerRanking] Startup-Auswertung für ${eventKey} fehlgeschlagen: ${error.message}`);
    }
  }

  const currentWindow = getWeekWindow(now);
  const currentData = readPowerRankingData();
  if (!currentData.weeks?.[currentWindow.weekKey]) {
    updatePowerRankingData(data => {
      data.weeks[currentWindow.weekKey] = createWeekRecord(currentWindow);
      return data;
    });
  }
  await refreshRankingMessage(client, currentWindow.weekKey).catch(error => {
    console.warn(`[PowerRanking] Ranking-Nachricht wird später erneut versucht: ${error.message}`);
  });

  const berlin = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const values = Object.fromEntries(berlin.map(part => [part.type, part.value]));
  if (values.weekday === 'Mon' && Number(values.hour) >= 7) {
    const previousAnchor = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const previousWindow = getWeekWindow(previousAnchor);
    const data = readPowerRankingData();
    const week = data.weeks?.[previousWindow.weekKey];
    if (week?.status === 'ACTIVE' && !isSundayEventStillRunningForWeek({ ...week, endDate: previousWindow.endDate })) {
      await finalizeWeek({ client, weekKey: previousWindow.weekKey, now }).catch(error => {
        console.warn(`[PowerRanking] Wochenfallback wird später erneut versucht: ${error.message}`);
      });
    }
  }

  for (const week of Object.values(readPowerRankingData().weeks || {})) {
    if (week.status === 'FINALIZED' && week.championTeamId && !week.championPostMessageId) {
      await publishChampionPost(client, week.weekKey).catch(error => {
        console.warn(`[PowerRanking] Champion-Retry für ${week.weekKey} fehlgeschlagen: ${error.message}`);
      });
    }
  }
}

async function initPowerRanking(client) {
  await reconcilePowerRanking(client);
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(() => {
    reconcilePowerRanking(client).catch(error => console.error('[PowerRanking] Reconcile fehlgeschlagen:', error));
  }, RECONCILE_INTERVAL_MS);
  if (typeof reconcileTimer.unref === 'function') reconcileTimer.unref();
}

module.exports = {
  calculateWeekRanking,
  buildChampionPostContent,
  championContactUserIds,
  createWeekRecord,
  evaluateAndStoreTournament,
  finalizeWeek,
  finalizeWeekData,
  getRanking,
  initPowerRanking,
  processCompletedTournament,
  publishChampionPost,
  rankingPages,
  rebuildPowerRankingForTournament,
  reconcilePowerRanking,
  recordTournamentEvaluation,
  refreshRankingMessage,
};
