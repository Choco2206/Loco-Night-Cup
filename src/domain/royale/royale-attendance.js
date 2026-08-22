'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById, isTeamMember } = require('../teams/team-service');
const { readRoyale, updateRoyale } = require('./royale-repository');

const ATTENDANCE_CLOSE_OFFSET_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
let attendanceTimer = null;

function roundOne(event) { return event.bracket?.rounds?.kings_round_1 || null; }
function teamIds(event) {
  return [...new Set((event.format?.participants || []).map(item => String(item.teamId)).filter(Boolean))];
}
function closeAt(event) {
  const start = event.schedule?.tournamentStartAt ? new Date(event.schedule.tournamentStartAt) : null;
  return !start || Number.isNaN(start.getTime()) ? null : new Date(start.getTime() - ATTENDANCE_CLOSE_OFFSET_MS);
}
function ensureState(event) {
  const round = roundOne(event); if (!round) return null;
  round.attendance = round.attendance || {
    status: 'open', messageId: null, presentTeamIds: [], closesAt: closeAt(event)?.toISOString() || null, finalizedAt: null,
  };
  const valid = new Set(teamIds(event));
  round.attendance.presentTeamIds = [...new Set((round.attendance.presentTeamIds || []).map(String))].filter(id => valid.has(id));
  if (!round.attendance.closesAt && closeAt(event)) round.attendance.closesAt = closeAt(event).toISOString();
  return round.attendance;
}
function teamName(teamId) { return findTeamById(teamId)?.clubName || `Team ${teamId}`; }

function buildRoyaleAttendancePayload(event) {
  const present = new Set(roundOne(event)?.attendance?.presentTeamIds || []);
  const ids = teamIds(event);
  const lines = ids.map(id => `${present.has(id) ? '✅' : '⬜'} **${teamName(id)}**`);
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle('TEAM CHECK-IN • PFAD DES KÖNIGS – RUNDE 1').setDescription([
    'Zeigt kurz, dass ihr bereit für die Loco Knockout Royale seid.', '', ...lines, '',
    `**${present.size}/${ids.length} Teams anwesend**`, 'Bitte drückt auf **Anwesend**, um euer Team einzuchecken.',
  ].join('\n')).setFooter({ text: 'VM AURA • LOCO DNA • READY FOR KICK-OFF' });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId('royale_attendance:kings_round_1').setLabel('Anwesend').setEmoji('✅').setStyle(ButtonStyle.Success));
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function staffRoleIds() {
  const settings = readJson(FILES.settings, createSettingsDefault());
  return [...new Set([...(settings.roles?.cupLeadRoleIds || []), ...(settings.permissions?.cupLeadRoleIds || [])].filter(Boolean).map(String))];
}
function teamUserIds(teamId) {
  const team = findTeamById(teamId);
  return [...new Set([team?.manager?.userId, ...(team?.coManagers || []).map(entry => entry?.userId)].filter(Boolean).map(String))];
}
async function channelFor(client, event) {
  const id = roundOne(event)?.channelId;
  return client && id ? client.channels.fetch(id).catch(() => null) : null;
}

async function ensureRoyaleAttendancePost(client) {
  let event = readRoyale();
  if (!roundOne(event) || roundOne(event).attendance?.status === 'finalized') return null;
  updateRoyale(current => { ensureState(current); return current; });
  event = readRoyale();
  const channel = await channelFor(client, event); if (!channel?.isTextBased?.()) return null;
  const state = roundOne(event).attendance;
  let message = state.messageId ? await channel.messages.fetch(state.messageId).catch(() => null) : null;
  message = message ? await message.edit(buildRoyaleAttendancePayload(event)) : await channel.send(buildRoyaleAttendancePayload(event));
  updateRoyale(current => { ensureState(current).messageId = message.id; return current; });
  scheduleRoyaleAttendance(client);
  return message;
}

async function finalizeRoyaleAttendance(client, now = new Date()) {
  let outcome = null;
  updateRoyale(event => {
    const state = ensureState(event); if (!state || state.status === 'finalized') return event;
    state.status = 'finalized'; state.finalizedAt = now.toISOString();
    const present = new Set(state.presentTeamIds);
    outcome = { event, messageId: state.messageId, missingTeamIds: teamIds(event).filter(id => !present.has(id)) };
    return event;
  });
  if (!outcome) return false;
  if (attendanceTimer) { clearTimeout(attendanceTimer); attendanceTimer = null; }
  const channel = await channelFor(client, outcome.event); if (!channel?.isTextBased?.()) return true;
  const old = outcome.messageId ? await channel.messages.fetch(outcome.messageId).catch(() => null) : null;
  if (old) await old.delete().catch(() => null);
  const roles = staffRoleIds(); const staff = roles.map(id => `<@&${id}>`).join(' ') || '**Turnierleitung**';
  if (!outcome.missingTeamIds.length) {
    await channel.send({ content: `✅ **Alle Teams sind bereit!**\n${staff} Alle Teams sind anwesend.`, allowedMentions: { roles } });
    return true;
  }
  const users = outcome.missingTeamIds.flatMap(teamUserIds);
  const lines = outcome.missingTeamIds.map(id => `❌ **${teamName(id)}**${teamUserIds(id).length ? ` – ${teamUserIds(id).map(userId => `<@${userId}>`).join(' ')}` : ''}`);
  await channel.send({ content: ['⚠️ **Anwesenheitsprüfung abgeschlossen**', `${staff} Folgende Teams sind voraussichtlich nicht anwesend:`, '', ...lines, '', 'Bitte prüfen, ob ein Nachrücker eingesetzt werden muss oder die betroffenen Spiele mit 1:0 gewertet werden.'].join('\n'), allowedMentions: { roles, users } });
  return true;
}

function scheduleRoyaleAttendance(client) {
  if (attendanceTimer) clearTimeout(attendanceTimer);
  const event = readRoyale(); const state = roundOne(event)?.attendance;
  if (!state || state.status === 'finalized') { attendanceTimer = null; return; }
  const target = state.closesAt ? new Date(state.closesAt) : closeAt(event);
  if (!target || Number.isNaN(target.getTime())) return;
  attendanceTimer = setTimeout(() => finalizeRoyaleAttendance(client).catch(error => console.error('[royale] Anwesenheitsabschluss fehlgeschlagen:', error)), Math.min(Math.max(0, target.getTime() - Date.now()), MAX_TIMEOUT_MS));
  if (attendanceTimer.unref) attendanceTimer.unref();
}

async function handleRoyaleAttendanceInteraction(interaction, client) {
  if (!interaction.isButton?.() || interaction.customId !== 'royale_attendance:kings_round_1') return false;
  const event = readRoyale(); const state = roundOne(event)?.attendance;
  if (!state || state.status !== 'open' || (state.closesAt && new Date(state.closesAt).getTime() <= Date.now())) {
    await interaction.reply({ content: 'Die Anwesenheitsprüfung ist bereits beendet.', flags: 64 });
    if (state?.status === 'open') await finalizeRoyaleAttendance(client);
    return true;
  }
  const id = teamIds(event).find(teamId => isTeamMember(findTeamById(teamId), interaction.user.id));
  if (!id) { await interaction.reply({ content: 'Nur der VM oder ein eingetragener Co-VM kann sein Team als anwesend markieren.', flags: 64 }); return true; }
  if (state.presentTeamIds.includes(id)) { await interaction.reply({ content: 'Euer Team ist bereits als anwesend markiert.', flags: 64 }); return true; }
  await interaction.deferUpdate();
  updateRoyale(current => { const attendance = ensureState(current); if (attendance.status === 'open' && !attendance.presentTeamIds.includes(id)) attendance.presentTeamIds.push(id); return current; });
  await ensureRoyaleAttendancePost(client);
  return true;
}

async function initRoyaleAttendance(client) {
  const event = readRoyale(); const state = roundOne(event)?.attendance;
  if (!roundOne(event) || state?.status === 'finalized') return;
  const target = state?.closesAt ? new Date(state.closesAt) : closeAt(event);
  if (target && target.getTime() <= Date.now()) await finalizeRoyaleAttendance(client);
  else await ensureRoyaleAttendancePost(client);
}

module.exports = { ATTENDANCE_CLOSE_OFFSET_MS, buildRoyaleAttendancePayload, ensureRoyaleAttendancePost, finalizeRoyaleAttendance, handleRoyaleAttendanceInteraction, initRoyaleAttendance, scheduleRoyaleAttendance, teamIds };
