'use strict';

const { EmbedBuilder } = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { enqueueCoalesced } = require('../../app/async-coalescer');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData } = require('../events/event-repository');
const { recalculateGroupStandings } = require('../groups/group-results');
const { findTeamById } = require('../teams/team-service');
const { renderLeagueSchedule, renderLeagueTable } = require('../../../utils/league-phase-renderer');

const GROUP_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const ROUND_ORDER = ['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];
const PUBLIC_LIVE_SCHEDULE_CHANNEL_ID = '1516429776070508555';
const ROUND_LABELS = {
  round_of_32: 'Sechzehntelfinale',
  round_of_16: 'Achtelfinale',
  quarter_final: 'Viertelfinale',
  semi_final: 'Halbfinale',
  third_place: 'Spiel um Platz 3',
  final: 'Finale',
};

function nowIso() { return new Date().toISOString(); }
function readSettings() { return readJson(FILES.settings, createSettingsDefault()); }
function getCycleKey(event) { return event?.cycle?.cycleKey || event?.cycle?.eventDate || event?.format?.lockedAt || event?.groups?.drawnAt || null; }
function isGroupPhaseVisible(event) { return event?.groups?.groups && Object.keys(event.groups.groups).length > 0 && event.knockout?.status === 'not_created'; }
function isLeaguePhaseVisible(event) { return event?.leaguePhase?.phaseType === 'league' && event.leaguePhase.status !== 'not_created' && event.knockout?.status === 'not_created'; }
function isKnockoutVisible(event) { return event?.knockout?.rounds && Object.keys(event.knockout.rounds).length > 0 && event.knockout.status !== 'not_created'; }
function getPhase(event) { if (isKnockoutVisible(event)) return 'knockout'; if (isLeaguePhaseVisible(event)) return 'league'; if (isGroupPhaseVisible(event)) return 'groups'; return null; }
function isLiveEvent(event) { return Boolean(getPhase(event)); }
function resolveParticipantName(participant) { if (!participant) return 'TBD'; if (participant.type === 'bye') return 'Freilos'; if (participant.type === 'placeholder') return participant.displayName || 'TBD'; return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || 'Team'; }
function isByeMatch(match) { return match?.home?.type === 'bye' || match?.away?.type === 'bye' || match?.status === 'bye'; }
function formatGroupStatus(match) { if (match.status === 'confirmed' && match.result) return `✅ ${match.result.homeGoals}:${match.result.awayGoals}`; if (isByeMatch(match)) return '🎟️ Freilos'; if (match.status === 'pending_confirmation') return '⏳ wartet auf Gegner'; if (match.status === 'admin_decision_required') return '🚨 Admin-Klärung'; return '⏳ offen'; }
function formatKnockoutStatus(match) { if (match.status === 'confirmed' && match.result) return `✅ ${match.result.homeGoals}:${match.result.awayGoals}`; if (match.status === 'pending_confirmation') return '⏳ wartet auf Gegner'; if (match.status === 'admin_decision_required') return '🚨 Admin-Klärung'; return '⏳ offen'; }
function getGroupMatches(group) { return (group.matchdays || []).flatMap(matchday => matchday.matches || []); }
function sortedStandings(group) {
  recalculateGroupStandings(group);
  return (group.standings || []).slice().sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.goalsAgainst - b.goalsAgainst || String(a.displayName || '').localeCompare(String(b.displayName || ''), 'de', { sensitivity: 'base' }));
}
function buildGroupEmbed(event, group) {
  const table = sortedStandings(group).map((row, index) => `${index + 1}. ${row.displayName || findTeamById(row.teamId)?.clubName || row.teamId} • P ${row.points} • Diff ${row.goalDifference >= 0 ? '+' : ''}${row.goalDifference}`);
  const matches = getGroupMatches(group).map((match, index) => `${index + 1}. ${resolveParticipantName(match.home)} vs ${resolveParticipantName(match.away)} • ${formatGroupStatus(match)}`);
  return new EmbedBuilder().setTitle(`📋 Gruppe ${group.groupKey}`).setColor(0xff0000).setDescription(['**Live-Tabelle**', '', table.join('\n') || 'Noch keine Tabelle.', '', '**Spielplan**', '', matches.join('\n') || 'Noch kein Spielplan.'].join('\n')).setFooter({ text: `${event.label || event.eventKey} • Gruppenphase` }).setTimestamp(new Date());
}
function roundTitle(roundKey) { if (roundKey === 'third_place') return '🥉 Spiel um Platz 3'; if (roundKey === 'final') return '👑 Finale'; return `🏆 ${ROUND_LABELS[roundKey] || roundKey}`; }
function buildRoundEmbed(event, roundKey, round) {
  const matches = (round.matches || []).map((match, index) => `${index + 1}. ${resolveParticipantName(match.home)} vs ${resolveParticipantName(match.away)} • ${formatKnockoutStatus(match)}`);
  return new EmbedBuilder().setTitle(roundTitle(roundKey)).setColor(roundKey === 'final' ? 0xf2c94c : 0xff0000).setDescription(matches.join('\n') || 'Diese Runde ist noch nicht bereit.').setFooter({ text: `${event.label || event.eventKey} • K.O.-Phase` }).setTimestamp(new Date());
}
function headerPayload(event, phase) {
  const size = event.format?.size ? `${event.format.size}er Cup` : 'Cup';
  const label = event.meta?.eventMode === 'bomber_x_loco' ? 'Bomber X Loco Cup' : `Loco Night Cup ${event.label || event.eventKey}`;
  if (phase === 'knockout') return { content: `🏆 ${label} • K.O.-Phase`, allowedMentions: { parse: [] } };
  if (phase === 'league') return { content: `📊 Loco Night Cup ${event.label || event.eventKey} • ${event.format?.size}er-Ligaphase\n🏆 Die besten 8 qualifizieren sich für das Viertelfinale.`, allowedMentions: { parse: [] } };
  return { content: [`📊 ${label} • Live-Spielplan`, `🏆 Turnierformat: ${size}`].join('\n'), allowedMentions: { parse: [] } };
}
async function fetchMessage(channel, messageId) { if (!messageId) return null; return channel.messages.fetch(messageId).catch(() => null); }
async function upsertMessage(channel, messageId, payload) {
  let existing = await fetchMessage(channel, messageId);
  const attachmentName = payload.files?.[0]?.name || null;
  if (!existing && attachmentName) {
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    existing = recent?.find(message => message.author?.id === channel.client.user.id && message.attachments?.some(attachment => attachment.name === attachmentName)) || null;
  }
  return existing ? existing.edit(payload) : channel.send(payload);
}
function getKnownMessageIds(state) { return [state?.headerMessageId, ...Object.values(state?.groupMessageIds || {}), ...Object.values(state?.knockoutMessageIds || {})].filter(Boolean); }
async function deleteKnownMessages(channel, state) { const deleted = []; for (const messageId of getKnownMessageIds(state)) { const message = await fetchMessage(channel, messageId); if (!message) continue; await message.delete().catch(() => null); deleted.push(messageId); } return deleted; }
async function getChannel(client, settings) {
  const channelId = settings.channels?.liveScheduleChannelId || PUBLIC_LIVE_SCHEDULE_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) { console.warn(`[live-schedule] Live-Spielplan-Kanal ${channelId} wurde nicht gefunden oder ist nicht beschreibbar.`); return null; }
  return channel;
}
function shouldResetState(state, eventKey, cycleKey) { if (!state) return false; if (state.currentEventKey && state.currentEventKey !== eventKey) return true; if (state.cycleKey && cycleKey && state.cycleKey !== cycleKey) return true; return false; }
function activeGroups(event) { const groups = event.groups?.groups || {}; return GROUP_KEYS.map(groupKey => groups[groupKey]).filter(Boolean); }
function activeRounds(event) { const rounds = event.knockout?.rounds || {}; return ROUND_ORDER.map(roundKey => [roundKey, rounds[roundKey]]).filter(([, round]) => round?.matches?.length && round.status !== 'not_needed'); }

async function performLiveScheduleRefresh(client, eventKey, event = null) {
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
      current.liveSchedule = { ...(current.liveSchedule || {}), channelId: channel.id, currentEventKey: null, cycleKey: null, phase: null, headerMessageId: null, groupMessageIds: {}, knockoutMessageIds: {}, cleanupStatus: 'rebuilt', updatedAt: nowIso() };
      return current;
    });
  }
  const latestMessages = readJson(FILES.messages, createMessagesDefault());
  const latestState = latestMessages.liveSchedule || {};
  const header = await upsertMessage(channel, latestState.headerMessageId, headerPayload(currentEvent, phase));
  const groupMessageIds = { ...(latestState.groupMessageIds || {}) };
  const knockoutMessageIds = { ...(latestState.knockoutMessageIds || {}) };

  if (phase === 'groups') {
    for (const group of activeGroups(currentEvent)) {
      const message = await upsertMessage(channel, groupMessageIds[group.groupKey], { embeds: [buildGroupEmbed(currentEvent, group)], allowedMentions: { parse: [] } });
      groupMessageIds[group.groupKey] = message.id;
    }
  } else if (phase === 'league') {
    const table = await renderLeagueTable(currentEvent.leaguePhase);
    const schedule = await renderLeagueSchedule(currentEvent.leaguePhase);
    const tableMessage = await upsertMessage(channel, groupMessageIds.league_table, table);
    const scheduleMessage = await upsertMessage(channel, groupMessageIds.league_schedule, schedule);
    groupMessageIds.league_table = tableMessage.id;
    groupMessageIds.league_schedule = scheduleMessage.id;
  } else if (phase === 'knockout') {
    for (const [roundKey, round] of activeRounds(currentEvent)) {
      const message = await upsertMessage(channel, knockoutMessageIds[roundKey], { embeds: [buildRoundEmbed(currentEvent, roundKey, round)], allowedMentions: { parse: [] } });
      knockoutMessageIds[roundKey] = message.id;
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
      groupMessageIds,
      knockoutMessageIds,
      cleanupStatus: 'active',
      updatedAt: nowIso(),
    };
    return current;
  });
  return true;
}

function refreshLiveSchedule(client, eventKey, event = null) {
  return enqueueCoalesced(`live-schedule:${eventKey}`, () => performLiveScheduleRefresh(client, eventKey, event));
}

async function refreshLiveScheduleForActiveEvents(client) {
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (!isLiveEvent(event)) continue;
    await refreshLiveSchedule(client, eventKey, event).catch(error => console.warn(`[live-schedule] ${eventKey}: ${error.message}`));
  }
}

module.exports = {
  refreshLiveSchedule,
  refreshLiveScheduleForActiveEvents,
};
