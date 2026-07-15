'use strict';

const { EmbedBuilder } = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData } = require('../events/event-repository');
const { recalculateGroupStandings } = require('../groups/group-results');
const { findTeamById } = require('../teams/team-service');
const { renderLeagueSchedule, renderLeagueTable } = require('../../../utils/league-phase-renderer');

const GROUP_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const ROUND_ORDER = ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];
const ROUND_LABELS = {
  round_of_16: 'Achtelfinale',
  quarter_final: 'Viertelfinale',
  semi_final: 'Halbfinale',
  third_place: 'Spiel um Platz 3',
  final: 'Finale',
};

function nowIso() {
  return new Date().toISOString();
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function getCycleKey(event) {
  return event?.cycle?.cycleKey || event?.cycle?.eventDate || event?.format?.lockedAt || event?.groups?.drawnAt || null;
}

function isGroupPhaseVisible(event) {
  return event?.groups?.groups && Object.keys(event.groups.groups).length > 0 && event.knockout?.status === 'not_created';
}

function isLeaguePhaseVisible(event) {
  return event?.leaguePhase?.phaseType === 'league' && event.leaguePhase.status !== 'not_created' && event.knockout?.status === 'not_created';
}

function isKnockoutVisible(event) {
  return event?.knockout?.rounds && Object.keys(event.knockout.rounds).length > 0 && event.knockout.status !== 'not_created';
}

function getPhase(event) {
  if (isKnockoutVisible(event)) return 'knockout';
  if (isLeaguePhaseVisible(event)) return 'league';
  if (isGroupPhaseVisible(event)) return 'groups';
  return null;
}

function isLiveEvent(event) {
  return Boolean(getPhase(event));
}

function resolveParticipantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'Freilos';
  if (participant.type === 'placeholder') return participant.displayName || 'TBD';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || 'Team';
}

function isByeMatch(match) {
  return match?.home?.type === 'bye' || match?.away?.type === 'bye' || match?.status === 'bye';
}

function formatGroupStatus(match) {
  if (match.status === 'confirmed' && match.result) return `✅ ${match.result.homeGoals}:${match.result.awayGoals}`;
  if (isByeMatch(match)) return '🎟️ Freilos';
  if (match.status === 'pending_confirmation') return '⏳ wartet auf Gegner';
  if (match.status === 'admin_decision_required') return '🚨 Admin-Klärung';
  return '⏳ offen';
}

function formatKnockoutStatus(match) {
  if (match.status === 'confirmed' && match.result) return `✅ ${match.result.homeGoals}:${match.result.awayGoals}`;
  if (match.status === 'pending_confirmation') return '⏳ wartet auf Gegner';
  if (match.status === 'admin_decision_required') return '🚨 Admin-Klärung';
  if (match.status === 'locked') return '⏳ offen';
  return '⏳ offen';
}

function getGroupMatches(group) {
  return (group.matchdays || []).flatMap(matchday => matchday.matches || []);
}

function sortedStandings(group) {
  recalculateGroupStandings(group);
  return (group.standings || [])
    .slice()
    .sort((a, b) => (
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.goalsAgainst - b.goalsAgainst ||
      String(a.displayName || '').localeCompare(String(b.displayName || ''), 'de', { sensitivity: 'base' })
    ));
}

function buildGroupEmbed(event, group) {
  const table = sortedStandings(group).map((row, index) => (
    `${index + 1}. ${row.displayName || findTeamById(row.teamId)?.clubName || row.teamId} • P ${row.points} • Diff ${row.goalDifference >= 0 ? '+' : ''}${row.goalDifference}`
  ));

  const matches = getGroupMatches(group).map((match, index) => (
    `${index + 1}. ${resolveParticipantName(match.home)} vs ${resolveParticipantName(match.away)} • ${formatGroupStatus(match)}`
  ));

  return new EmbedBuilder()
    .setTitle(`📋 Gruppe ${group.groupKey}`)
    .setColor(0xff0000)
    .setDescription([
      '**Live-Tabelle**',
      table.join('\n') || 'Noch keine Tabelle.',
      '',
      '**Spielplan**',
      matches.join('\n') || 'Noch kein Spielplan.',
    ].join('\n'))
    .setFooter({ text: `${event.label || event.eventKey} • Gruppenphase` })
    .setTimestamp(new Date());
}

function roundTitle(roundKey) {
  if (roundKey === 'third_place') return '🥉 Spiel um Platz 3';
  if (roundKey === 'final') return '👑 Finale';
  return `🏆 ${ROUND_LABELS[roundKey] || roundKey}`;
}

function buildRoundEmbed(event, roundKey, round) {
  const matches = (round.matches || []).map((match, index) => (
    `${index + 1}. ${resolveParticipantName(match.home)} vs ${resolveParticipantName(match.away)} • ${formatKnockoutStatus(match)}`
  ));

  return new EmbedBuilder()
    .setTitle(roundTitle(roundKey))
    .setColor(roundKey === 'final' ? 0xf2c94c : 0xff0000)
    .setDescription(matches.join('\n') || 'Diese Runde ist noch nicht bereit.')
    .setFooter({ text: `${event.label || event.eventKey} • K.O.-Phase` })
    .setTimestamp(new Date());
}

function headerPayload(event, phase) {
  const size = event.format?.size ? `${event.format.size}er Cup` : 'Cup';
  if (phase === 'knockout') {
    return {
      content: `🏆 Loco Night Cup ${event.label || event.eventKey} • K.O.-Phase`,
      allowedMentions: { parse: [] },
    };
  }
  if (phase === 'league') return { content: `📊 Loco Night Cup ${event.label || event.eventKey} • 20er-Ligaphase\n🏆 Die besten 8 qualifizieren sich für das Viertelfinale.`, allowedMentions: { parse: [] } };
  return {
    content: [
      `📊 Loco Night Cup ${event.label || event.eventKey} • Live-Spielplan`,
      `🏆 Turnierformat: ${size}`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  };
}

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function upsertMessage(channel, messageId, payload) {
  const existing = await fetchMessage(channel, messageId);
  return existing ? existing.edit(payload) : channel.send(payload);
}

function getKnownMessageIds(state) {
  return [
    state?.headerMessageId,
    ...Object.values(state?.groupMessageIds || {}),
    ...Object.values(state?.knockoutMessageIds || {}),
  ].filter(Boolean);
}

async function deleteKnownMessages(channel, state) {
  const deleted = [];
  for (const messageId of getKnownMessageIds(state)) {
    const message = await fetchMessage(channel, messageId);
    if (!message) continue;
    await message.delete().catch(() => null);
    deleted.push(messageId);
  }
  return deleted;
}

async function getChannel(client, settings) {
  const channelId = settings.channels?.liveScheduleChannelId;
  if (!channelId) {
    console.warn('[live-schedule] settings.channels.liveScheduleChannelId fehlt.');
    return null;
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) {
    console.warn(`[live-schedule] Live-Spielplan-Kanal ${channelId} wurde nicht gefunden oder ist nicht beschreibbar.`);
    return null;
  }
  return channel;
}

function shouldResetState(state, eventKey, cycleKey) {
  if (!state) return false;
  if (state.currentEventKey && state.currentEventKey !== eventKey) return true;
  if (state.cycleKey && cycleKey && state.cycleKey !== cycleKey) return true;
  return false;
}

function activeGroups(event) {
  const groups = event.groups?.groups || {};
  return GROUP_KEYS.map(groupKey => groups[groupKey]).filter(Boolean);
}

function activeRounds(event) {
  const rounds = event.knockout?.rounds || {};
  return ROUND_ORDER.map(roundKey => [roundKey, rounds[roundKey]])
    .filter(([, round]) => round?.matches?.length && round.status !== 'not_needed');
}

async function refreshLiveSchedule(client, eventKey, event = null) {
  if (!client || !EVENT_KEYS.includes(eventKey)) return false;
  const settings = readSettings();
  const channel = await getChannel(client, settings);
  if (!channel) return false;

  const currentEvent = event || readEventData(eventKey);
  const phase = getPhase(currentEvent);
  if (!phase) return false;

  const cycleKey = getCycleKey(currentEvent);
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.liveSchedule || {};
  if (shouldResetState(state, eventKey, cycleKey)) {
    await deleteKnownMessages(channel, state);
    updateJson(FILES.messages, createMessagesDefault(), current => {
      current.liveSchedule = {
        ...(current.liveSchedule || {}),
        channelId: channel.id,
        currentEventKey: null,
        cycleKey: null,
        phase: null,
        headerMessageId: null,
        groupMessageIds: {},
        knockoutMessageIds: {},
        cleanupStatus: 'rebuilt',
        updatedAt: nowIso(),
      };
      return current;
    });
  }

  const latestMessages = readJson(FILES.messages, createMessagesDefault());
  const latestState = latestMessages.liveSchedule || {};
  const header = await upsertMessage(channel, latestState.headerMessageId, headerPayload(currentEvent, phase));
  const nextGroupMessageIds = {};
  const nextKnockoutMessageIds = {};

  if (phase === 'groups') {
    for (const group of activeGroups(currentEvent)) {
      const message = await upsertMessage(channel, latestState.groupMessageIds?.[group.groupKey], {
        embeds: [buildGroupEmbed(currentEvent, group)],
        allowedMentions: { parse: [] },
      });
      nextGroupMessageIds[group.groupKey] = message.id;
    }
  }

  if (phase === 'league') {
    recalculateGroupStandings(currentEvent.leaguePhase);
    const tableName = `public-ligaphase-table-${eventKey}.png`;
    const scheduleName = `public-ligaphase-schedule-${eventKey}.png`;
    const table = await upsertMessage(channel, latestState.groupMessageIds?.leagueTable, { content: null, embeds: [new EmbedBuilder().setImage(`attachment://${tableName}`)], attachments: [], files: [{ attachment: await renderLeagueTable(currentEvent.leaguePhase), name: tableName }], allowedMentions: { parse: [] } });
    const schedule = await upsertMessage(channel, latestState.groupMessageIds?.leagueSchedule, { content: null, embeds: [new EmbedBuilder().setImage(`attachment://${scheduleName}`)], attachments: [], files: [{ attachment: await renderLeagueSchedule(currentEvent.leaguePhase), name: scheduleName }], allowedMentions: { parse: [] } });
    nextGroupMessageIds.leagueTable = table.id;
    nextGroupMessageIds.leagueSchedule = schedule.id;
  }

  if (phase === 'knockout') {
    for (const [roundKey, round] of activeRounds(currentEvent)) {
      const message = await upsertMessage(channel, latestState.knockoutMessageIds?.[roundKey], {
        embeds: [buildRoundEmbed(currentEvent, roundKey, round)],
        allowedMentions: { parse: [] },
      });
      nextKnockoutMessageIds[roundKey] = message.id;
    }
  }

  for (const [groupKey, messageId] of Object.entries(latestState.groupMessageIds || {})) {
    if (!nextGroupMessageIds[groupKey]) {
      const message = await fetchMessage(channel, messageId);
      if (message) await message.delete().catch(() => null);
    }
  }
  for (const [roundKey, messageId] of Object.entries(latestState.knockoutMessageIds || {})) {
    if (!nextKnockoutMessageIds[roundKey]) {
      const message = await fetchMessage(channel, messageId);
      if (message) await message.delete().catch(() => null);
    }
  }

  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.liveSchedule = {
      ...(current.liveSchedule || {}),
      channelId: channel.id,
      currentEventKey: eventKey,
      cycleKey,
      phase,
      headerMessageId: header.id,
      groupMessageIds: nextGroupMessageIds,
      knockoutMessageIds: nextKnockoutMessageIds,
      cleanupStatus: null,
      updatedAt: nowIso(),
      createdAt: current.liveSchedule?.createdAt || nowIso(),
    };
    current.meta = { ...(current.meta || {}), updatedAt: nowIso() };
    return current;
  });

  return true;
}

async function refreshLiveScheduleForActiveEvents(client) {
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (!isLiveEvent(event)) continue;
    const refreshed = await refreshLiveSchedule(client, eventKey, event).catch(error => {
      console.warn(`[live-schedule] Refresh fuer ${eventKey} fehlgeschlagen: ${error.message}`);
      return false;
    });
    if (refreshed) return true;
  }
  return false;
}

async function cleanupLiveScheduleForEvent(client, eventKey) {
  const settings = readSettings();
  const channel = await getChannel(client, settings);
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.liveSchedule || {};
  const shouldClean = !eventKey || state.currentEventKey === eventKey;
  let deleted = [];

  if (channel && shouldClean) {
    deleted = await deleteKnownMessages(channel, state);
  }

  if (shouldClean) {
    updateJson(FILES.messages, createMessagesDefault(), current => {
      current.liveSchedule = {
        ...(current.liveSchedule || {}),
        channelId: channel?.id || current.liveSchedule?.channelId || settings.channels?.liveScheduleChannelId || null,
        currentEventKey: null,
        cycleKey: null,
        phase: null,
        headerMessageId: null,
        groupMessageIds: {},
        knockoutMessageIds: {},
        cleanupStatus: 'cleaned',
        updatedAt: nowIso(),
      };
      current.meta = { ...(current.meta || {}), updatedAt: nowIso() };
      return current;
    });
  }

  return { cleaned: shouldClean, deletedMessageIds: deleted };
}

module.exports = {
  cleanupLiveScheduleForEvent,
  refreshLiveSchedule,
  refreshLiveScheduleForActiveEvents,
};
