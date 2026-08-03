'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById, isTeamMember } = require('../teams/team-service');

const ATTENDANCE_CLOSE_OFFSET_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const timers = new Map();

function scopeKey(groupKey) {
  return String(groupKey).toLowerCase() === 'league' ? 'league' : String(groupKey);
}

function getScope(event, groupKey) {
  return scopeKey(groupKey) === 'league' ? event.leaguePhase : event.groups?.groups?.[groupKey];
}

function getScopeTeamIds(scope) {
  return [...new Set((scope?.slots || [])
    .filter(slot => slot.type === 'team' && slot.teamId)
    .map(slot => String(slot.teamId)))];
}

function attendanceCloseAt(event) {
  const start = event.schedule?.tournamentStartAt ? new Date(event.schedule.tournamentStartAt) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() - ATTENDANCE_CLOSE_OFFSET_MS);
}

function ensureState(scope, event) {
  const closeAt = attendanceCloseAt(event);
  scope.attendance = scope.attendance || {
    status: 'open',
    messageId: null,
    presentTeamIds: [],
    closesAt: closeAt?.toISOString() || null,
    finalizedAt: null,
  };
  scope.attendance.presentTeamIds = Array.isArray(scope.attendance.presentTeamIds)
    ? [...new Set(scope.attendance.presentTeamIds.map(String))]
    : [];
  const activeTeamIds = new Set(getScopeTeamIds(scope));
  scope.attendance.presentTeamIds = scope.attendance.presentTeamIds.filter(teamId => activeTeamIds.has(teamId));
  if (!scope.attendance.closesAt && closeAt) scope.attendance.closesAt = closeAt.toISOString();
  return scope.attendance;
}

function teamName(teamId) {
  return findTeamById(teamId)?.clubName || `Team ${teamId}`;
}

function buildAttendancePayload(eventKey, groupKey, scope) {
  const present = new Set(scope.attendance?.presentTeamIds || []);
  const teamIds = getScopeTeamIds(scope);
  const lines = teamIds.map(teamId => `${present.has(teamId) ? '\u2705' : '\u2B1C'} **${teamName(teamId)}**`);
  const title = scopeKey(groupKey) === 'league' ? 'TEAM CHECK-IN \u2022 LIGAPHASE' : `TEAM CHECK-IN \u2022 GRUPPE ${groupKey}`;
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(title)
    .setDescription([
      'Zeigt kurz, dass ihr bereit fuer den Loco Night Cup seid.',
      '',
      ...lines,
      '',
      `**${present.size}/${teamIds.length} Teams anwesend**`,
      'Bitte drueckt auf **Anwesend**, um euer Team einzuchecken.',
    ].join('\n'))
    .setFooter({ text: 'VM AURA \u2022 LOCO DNA \u2022 READY FOR KICK-OFF' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_attendance:${eventKey}:${groupKey}`)
      .setLabel('Anwesend')
      .setEmoji('\u2705')
      .setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function fetchChannel(client, scope) {
  const channelId = scope?.phaseType === 'league' ? scope.overviewChannelId : scope?.channelId;
  return client && channelId ? client.channels.fetch(channelId).catch(() => null) : null;
}

async function ensureAttendancePost(client, eventKey, groupKey) {
  let event = readEventData(eventKey);
  let scope = getScope(event, groupKey);
  if (!scope || scope.attendance?.status === 'finalized') return null;
  if (scope.phaseType === 'league' && Number(scope.currentMatchday || 0) > 0) return null;
  updateEventData(eventKey, stored => {
    ensureState(getScope(stored, groupKey), stored);
    return stored;
  });
  event = readEventData(eventKey);
  scope = getScope(event, groupKey);
  const channel = await fetchChannel(client, scope);
  if (!channel) return null;
  let message = scope.attendance.messageId
    ? await channel.messages.fetch(scope.attendance.messageId).catch(() => null)
    : null;
  const payload = buildAttendancePayload(eventKey, groupKey, scope);
  message = message ? await message.edit(payload) : await channel.send(payload);
  updateEventData(eventKey, stored => {
    ensureState(getScope(stored, groupKey), stored).messageId = message.id;
    return stored;
  });
  scheduleAttendance(client, eventKey, groupKey);
  return message;
}

function staffRoleIds() {
  const settings = readJson(FILES.settings, createSettingsDefault());
  return [...new Set([
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ].filter(Boolean).map(String))];
}

function teamUserIds(teamId) {
  const team = findTeamById(teamId);
  return [...new Set([
    team?.manager?.userId,
    ...(team?.coManagers || []).map(entry => entry?.userId),
  ].filter(Boolean).map(String))];
}

async function finalizeAttendance(client, eventKey, groupKey, now = new Date()) {
  let outcome = null;
  updateEventData(eventKey, event => {
    const scope = getScope(event, groupKey);
    if (!scope) return event;
    const attendance = ensureState(scope, event);
    if (attendance.status === 'finalized') return event;
    const teamIds = getScopeTeamIds(scope);
    const present = new Set(attendance.presentTeamIds);
    attendance.status = 'finalized';
    attendance.finalizedAt = now.toISOString();
    outcome = { scope, messageId: attendance.messageId, missingTeamIds: teamIds.filter(id => !present.has(id)) };
    return event;
  });
  if (!outcome) return false;
  const channel = await fetchChannel(client, outcome.scope);
  if (!channel) return true;
  const old = outcome.messageId ? await channel.messages.fetch(outcome.messageId).catch(() => null) : null;
  if (old) await old.delete().catch(() => null);
  const roles = staffRoleIds();
  const staffMentions = roles.map(id => `<@&${id}>`).join(' ') || '**Turnierleitung**';
  if (!outcome.missingTeamIds.length) {
    await channel.send({
      content: `\u2705 **Alle Teams sind bereit!**\n${staffMentions} Alle Teams sind anwesend.`,
      allowedMentions: { roles },
    });
    return true;
  }
  const missingLines = outcome.missingTeamIds.map(teamId => {
    const users = teamUserIds(teamId);
    return `\u274C **${teamName(teamId)}**${users.length ? ` \u2013 ${users.map(id => `<@${id}>`).join(' ')}` : ''}`;
  });
  const users = outcome.missingTeamIds.flatMap(teamUserIds);
  await channel.send({
    content: [
      '\u26A0\uFE0F **Anwesenheitspruefung abgeschlossen**',
      `${staffMentions} Folgende Teams sind voraussichtlich nicht anwesend:`,
      '',
      ...missingLines,
      '',
      'Bitte pruefen, ob ein Nachruecker eingesetzt werden muss oder die betroffenen Spiele mit 1:0 gewertet werden.',
    ].join('\n'),
    allowedMentions: { roles, users },
  });
  return true;
}

function timerKey(eventKey, groupKey) {
  return `${eventKey}:${scopeKey(groupKey)}`;
}

function scheduleAttendance(client, eventKey, groupKey) {
  const key = timerKey(eventKey, groupKey);
  const old = timers.get(key);
  if (old) clearTimeout(old);
  const event = readEventData(eventKey);
  const scope = getScope(event, groupKey);
  if (!scope || scope.attendance?.status === 'finalized') return;
  const target = scope.attendance?.closesAt ? new Date(scope.attendance.closesAt) : attendanceCloseAt(event);
  if (!target || Number.isNaN(target.getTime())) return;
  const timer = setTimeout(
    () => finalizeAttendance(client, eventKey, groupKey).catch(error => console.error('Anwesenheitsabschluss fehlgeschlagen:', error)),
    Math.min(Math.max(0, target.getTime() - Date.now()), MAX_TIMEOUT_MS)
  );
  if (timer.unref) timer.unref();
  timers.set(key, timer);
}

async function handleAttendanceInteraction(interaction, client) {
  if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith('team_attendance:')) return false;
  const [, eventKey, groupKey] = interaction.customId.split(':');
  const event = readEventData(eventKey);
  const scope = getScope(event, groupKey);
  const attendance = scope?.attendance;
  if (!scope || attendance?.status !== 'open') {
    await interaction.reply({ content: 'Die Anwesenheitspruefung ist bereits beendet.', flags: 64 });
    return true;
  }
  const closesAt = attendance.closesAt ? new Date(attendance.closesAt) : null;
  if (closesAt && !Number.isNaN(closesAt.getTime()) && closesAt.getTime() <= Date.now()) {
    await interaction.reply({ content: 'Die Anwesenheitspruefung ist bereits beendet.', flags: 64 });
    await finalizeAttendance(client, eventKey, groupKey);
    return true;
  }
  const teamId = getScopeTeamIds(scope).find(id => isTeamMember(findTeamById(id), interaction.user.id));
  if (!teamId) {
    await interaction.reply({ content: 'Nur der VM oder ein eingetragener Co-VM kann sein Team als anwesend markieren.', flags: 64 });
    return true;
  }
  if (attendance.presentTeamIds.includes(teamId)) {
    await interaction.reply({ content: 'Euer Team ist bereits als anwesend markiert.', flags: 64 });
    return true;
  }
  await interaction.deferUpdate();
  updateEventData(eventKey, stored => {
    const state = ensureState(getScope(stored, groupKey), stored);
    if (state.status === 'open' && !state.presentTeamIds.includes(teamId)) state.presentTeamIds.push(teamId);
    return stored;
  });
  await ensureAttendancePost(client, eventKey, groupKey);
  return true;
}

async function initAttendance(client) {
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (event.leaguePhase?.phaseType === 'league'
      && event.leaguePhase.status !== 'completed'
      && Number(event.leaguePhase.currentMatchday || 0) === 0) {
      const target = attendanceCloseAt(event);
      const task = target && target.getTime() <= Date.now()
        ? finalizeAttendance(client, eventKey, 'league')
        : ensureAttendancePost(client, eventKey, 'league');
      await task.catch(error => console.error('Ligaphasen-Anwesenheit konnte nicht wiederhergestellt werden:', error));
    }
    for (const groupKey of event.groups?.status === 'completed' ? [] : Object.keys(event.groups?.groups || {})) {
      const target = attendanceCloseAt(event);
      const task = target && target.getTime() <= Date.now()
        ? finalizeAttendance(client, eventKey, groupKey)
        : ensureAttendancePost(client, eventKey, groupKey);
      await task.catch(error => console.error(`Anwesenheit Gruppe ${groupKey} konnte nicht wiederhergestellt werden:`, error));
    }
  }
}

module.exports = {
  ATTENDANCE_CLOSE_OFFSET_MS,
  buildAttendancePayload,
  ensureAttendancePost,
  finalizeAttendance,
  getScopeTeamIds,
  handleAttendanceInteraction,
  initAttendance,
  scheduleAttendance,
};

