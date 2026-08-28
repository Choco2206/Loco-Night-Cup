'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { findTeamById } = require('../teams/team-service');
const {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  BOMBER_X_LOCO_FORMAT_SIZES,
} = require('../events/bomber-x-loco-config');
const { getEntryTeamIds } = require('./checkin-format');
const { getCheckinWindowState } = require('./checkin-schedule');

function formatDateTime(value, type = 'time') {
  if (!value) return 'nicht gesetzt';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'nicht gesetzt';
  return type === 'date'
    ? date.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'full' })
    : date.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
}

function teamName(teamId) {
  return findTeamById(teamId)?.clubName || `Unbekanntes Team (${teamId})`;
}

function currentFormat(event) {
  const count = getEntryTeamIds(event).length;
  return [...BOMBER_X_LOCO_FORMAT_SIZES].filter(size => size <= count).pop() || null;
}

function nextFormat(event) {
  const count = getEntryTeamIds(event).length;
  return BOMBER_X_LOCO_FORMAT_SIZES.find(size => size > count) || null;
}

function formatSeparator(size) {
  return `══════⬆️ ${size}er Turnier ⬆️══════`;
}

function formatTeams(event) {
  const ids = getEntryTeamIds(event);
  const lines = [];
  for (let index = 0; index < 48; index += 1) {
    const teamId = ids[index];
    lines.push(`${index + 1}. ${teamId ? teamName(teamId) : '—'}`);
    if (BOMBER_X_LOCO_FORMAT_SIZES.includes(index + 1)) {
      lines.push(formatSeparator(index + 1));
    }
  }
  return lines.join('\n');
}

function buildBomberXLocoPayload(event, settings) {
  const state = getCheckinWindowState('saturday', event, settings);
  const count = getEntryTeamIds(event).length;
  const format = currentFormat(event);
  const next = nextFormat(event);
  const description = [
    state.canJoin ? '🟢 **Check-in geöffnet**' : '🔴 **Check-in geschlossen**',
    `📅 Datum: ${formatDateTime(event.cycle?.eventDate ? `${event.cycle.eventDate}T12:00:00+02:00` : null, 'date')}`,
    '',
    `⏰ Offizieller Anmeldeschluss: ${formatDateTime(event.schedule?.deadlineAt)}`,
    `🕒 Late-Check-in bis: ${formatDateTime(event.schedule?.lateWindowUntil)}`,
    `🎲 Gruppenauslosung: ${formatDateTime(event.schedule?.drawAt)}`,
    `🚀 Turnierstart: ${formatDateTime(event.schedule?.tournamentStartAt)}`,
    '',
    `🏆 Aktuelles Format: ${format ? `${format}er Turnier` : 'noch kein gültiges Format'}`,
    `👥 Angemeldet: ${count}/48 Teams`,
    next ? `Nächster Schritt: ${next} Teams • noch ${next - count} erforderlich` : 'Maximales Format erreicht',
    '',
    '**👥 Teilnehmende Teams**',
    '',
    formatTeams(event),
    '',
    '⚠️ Nach dem offiziellen Anmeldeschluss führt eine Abmeldung wie beim normalen Night Cup zur vorgesehenen Sperre.',
  ].join('\n');

  return {
    embeds: [new EmbedBuilder().setColor(0xff0000).setTitle('💣🐺 Bomber X Loco Cup • Check-in').setDescription(description).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('checkin_join:saturday').setLabel('⬆️ Anmelden').setStyle(ButtonStyle.Success).setDisabled(!state.canJoin),
      new ButtonBuilder().setCustomId('checkin_leave:saturday').setLabel('⬇️ Abmelden').setStyle(ButtonStyle.Danger).setDisabled(!state.canLeave),
    )],
  };
}

function buildSaturdayBlockerPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('💣🐺 Bomber X Loco Cup am 19.09.2026')
      .setDescription([
        '**Für diesen Samstag findet kein regulärer Loco Night Cup statt.**',
        '',
        'Stattdessen spielen wir den **Bomber X Loco Cup**.',
        `Die Anmeldung läuft im <#${BOMBER_X_LOCO_CHECKIN_CHANNEL_ID}>.`,
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bomber_x_loco_redirect:saturday').setLabel('⬆️ Anmelden').setStyle(ButtonStyle.Success),
    )],
  };
}

module.exports = {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  buildBomberXLocoPayload,
  buildSaturdayBlockerPayload,
};
