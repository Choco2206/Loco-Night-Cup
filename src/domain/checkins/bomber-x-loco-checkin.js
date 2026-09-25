'use strict';

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { ROOT_DIR } = require('../../storage');
const { findTeamById } = require('../teams/team-service');
const {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  BOMBER_X_LOCO_EVENT_KEY,
  BOMBER_X_LOCO_FORMAT_SIZES,
} = require('../events/bomber-x-loco-config');
const { getEntryTeamIds, getManualByeCount } = require('./checkin-format');
const { getCheckinWindowState } = require('./checkin-schedule');

const BANNER_PATH = path.join(ROOT_DIR, 'assets', 'bomber-x-loco', 'check-in.png');
const BANNER_NAME = 'bomber-x-loco-check-in.png';
const PADDY_HSV_TWITCH_URL = 'https://www.twitch.tv/Paddyhsv';
const MAX_PARTICIPANTS = Math.max(...BOMBER_X_LOCO_FORMAT_SIZES);

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
  const count = getEntryTeamIds(event).length + getManualByeCount(event);
  return [...BOMBER_X_LOCO_FORMAT_SIZES].filter(size => size <= count).pop() || null;
}

function nextFormat(event) {
  const count = getEntryTeamIds(event).length + getManualByeCount(event);
  return BOMBER_X_LOCO_FORMAT_SIZES.find(size => size > count) || null;
}

function formatSeparator(size) {
  return `══════⬆️ ${size}er Turnier ⬆️══════`;
}

function formatTeams(event) {
  const ids = getEntryTeamIds(event);
  const waitlistIds = getWaitlistIds(event);
  const waitlistSet = new Set(waitlistIds);
  const activeIds = ids.filter(teamId => !waitlistSet.has(teamId)).slice(0, MAX_PARTICIPANTS);
  const activeByeCount = Math.min(
    getManualByeCount(event),
    Math.max(0, MAX_PARTICIPANTS - activeIds.length),
  );
  const labels = [
    ...activeIds.map(teamName),
    ...Array.from({ length: activeByeCount }, (_, index) => activeByeCount > 1 ? `Freilos ${index + 1}` : 'Freilos'),
    ...waitlistIds.map(teamId => `${teamName(teamId)} (WL)`),
  ];
  const lines = [];
  for (let index = 0; index < MAX_PARTICIPANTS; index += 1) {
    lines.push(`${index + 1}. ${labels[index] || '—'}`);
    if (BOMBER_X_LOCO_FORMAT_SIZES.includes(index + 1)) lines.push(formatSeparator(index + 1));
  }
  return lines.join('\n');
}

function getWaitlistIds(event) {
  const ids = getEntryTeamIds(event);
  const entryIds = new Set(ids);
  const storedWaitlist = (event.checkin?.waitlistTeamIds || [])
    .map(String)
    .filter(teamId => entryIds.has(teamId));
  const activeLimit = Number(event.format?.size) || MAX_PARTICIPANTS;
  return storedWaitlist.length ? storedWaitlist : ids.slice(activeLimit);
}

function formatWaitlist(event) {
  const ids = getWaitlistIds(event);
  if (!ids.length) return null;
  return [
    `**⚠️ Warteliste (${ids.length})**`,
    '_Diese Teams rücken bei einer Abmeldung automatisch in Anmeldereihenfolge nach._',
    '',
    ...ids.map((teamId, index) => `${index + 1}. ${teamName(teamId)} (WL)`),
  ].join('\n');
}

function getBanner() {
  if (!fs.existsSync(BANNER_PATH)) return { embed: null, files: [] };
  return {
    embed: new EmbedBuilder().setColor(0xff0000).setImage(`attachment://${BANNER_NAME}`),
    files: [{ attachment: BANNER_PATH, name: BANNER_NAME }],
  };
}

function buildBomberXLocoPayload(event, settings) {
  const state = getCheckinWindowState(BOMBER_X_LOCO_EVENT_KEY, event, settings);
  const realTeamCount = getEntryTeamIds(event).length;
  const byeCount = getManualByeCount(event);
  const count = realTeamCount + byeCount;
  const format = currentFormat(event);
  const participantCapacity = format || MAX_PARTICIPANTS;
  const waitlistCount = getWaitlistIds(event).length;
  const participantCount = Math.min(count - waitlistCount, participantCapacity);
  const next = nextFormat(event);
  const banner = getBanner();
  const description = [
    state.canJoin ? '🟢 **Anmeldung geöffnet**' : '🔴 **Anmeldung geschlossen**',
    `📅 Datum: ${formatDateTime(event.cycle?.eventDate ? `${event.cycle.eventDate}T12:00:00+02:00` : null, 'date')}`,
    '',
    `⏰ Offizieller Anmeldeschluss: ${formatDateTime(event.schedule?.deadlineAt)}`,
    `🎲 Gruppenauslosung live bei **Paddy HSV**: ${formatDateTime(event.schedule?.drawAt)}`,
    `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
    '✅ Anwesenheits-Check: bis 20:55 Uhr',
    `🚀 Turnierstart: ${formatDateTime(event.schedule?.tournamentStartAt)}`,
    '',
    `🏆 Aktuelles Format: ${format ? `${format}er Turnier` : 'noch kein gültiges Format'}`,
    `👥 Teilnehmerfeld: ${participantCount}/${participantCapacity} Plätze${byeCount ? ` (${realTeamCount} Teams + ${byeCount} Freilos${byeCount === 1 ? '' : 'e'})` : ''}`,
    `⚠️ Warteliste: ${waitlistCount} Teilnehmerplätze`,
    next ? `Nächster Schritt: ${next} Teams • noch ${next - count} erforderlich` : `${MAX_PARTICIPANTS}er-Format erreicht • weitere Anmeldungen kommen auf die Warteliste`,
    '',
    '**👥 Teilnehmende Teams**',
    '',
    formatTeams(event),
    '',
    '⚠️ Nach **18:30 Uhr** ist keine Anmeldung oder Abmeldung mehr möglich.',
    '🎥 Die Gruppen werden anschließend **live bei Paddy HSV** gezogen und von der Turnierleitung manuell zugeteilt.',
    `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
  ].join('\n');
  const checkinEmbed = new EmbedBuilder().setColor(0xff0000).setTitle('💣🐺 Bomber X Loco Cup • Anmeldung').setDescription(description).setTimestamp();
  const waitlistDescription = formatWaitlist(event);
  const waitlistEmbed = waitlistDescription
    ? new EmbedBuilder().setColor(0xffa500).setTitle('Nachrücker').setDescription(waitlistDescription)
    : null;

  return {
    embeds: [banner.embed, checkinEmbed, waitlistEmbed].filter(Boolean),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`checkin_join:${BOMBER_X_LOCO_EVENT_KEY}`).setLabel('⬆️ Anmelden').setStyle(ButtonStyle.Success).setDisabled(!state.canJoin),
      new ButtonBuilder().setCustomId(`checkin_leave:${BOMBER_X_LOCO_EVENT_KEY}`).setLabel('⬇️ Abmelden').setStyle(ButtonStyle.Danger).setDisabled(!state.canLeave),
      new ButtonBuilder().setCustomId('bxl_manual_group_assignment').setLabel('🎲 Gruppenzuteilung').setStyle(ButtonStyle.Primary),
    )],
    files: banner.files,
  };
}

function buildBomberXLocoBlockerPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('💣🐺 Bomber X Loco Cup am 25.09.2026')
      .setDescription([
        '**Für diesen Freitag findet kein regulärer Loco Night Cup statt.**',
        '',
        'Stattdessen spielen wir den **Bomber X Loco Cup**.',
        `Die Anmeldung läuft im <#${BOMBER_X_LOCO_CHECKIN_CHANNEL_ID}>.`,
        '**Anmeldeschluss: 18:30 Uhr.**',
        '**Gruppenauslosung: 20:00 Uhr live bei Paddy HSV.**',
        `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bomber_x_loco_redirect:${BOMBER_X_LOCO_EVENT_KEY}`).setLabel('⬆️ Anmelden').setStyle(ButtonStyle.Success),
    )],
  };
}

module.exports = {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  buildBomberXLocoPayload,
  buildBomberXLocoBlockerPayload,
  getWaitlistIds,
};
