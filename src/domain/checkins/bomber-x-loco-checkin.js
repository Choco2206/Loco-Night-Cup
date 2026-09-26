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
  HALLOWEEN_EVENT_KEY,
  HALLOWEEN_CHECKIN_CHANNEL_ID,
} = require('../events/bomber-x-loco-config');
const { getEntryTeamIds, getManualByeCount } = require('./checkin-format');
const { getCheckinWindowState } = require('./checkin-schedule');

const BANNER_PATH = path.join(ROOT_DIR, 'assets', 'bomber-x-loco', 'check-in.png');
const BANNER_NAME = 'bomber-x-loco-check-in.png';
const HALLOWEEN_BANNER_PATH = path.join(ROOT_DIR, 'assets', 'bomber-x-loco-halloween', 'check-in.png');
const HALLOWEEN_BANNER_NAME = 'bomber-x-loco-halloween-check-in.png';
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

function getBanner(event) {
  const halloween = event.eventKey === HALLOWEEN_EVENT_KEY;
  const bannerPath = halloween ? HALLOWEEN_BANNER_PATH : BANNER_PATH;
  const bannerName = halloween ? HALLOWEEN_BANNER_NAME : BANNER_NAME;
  if (!fs.existsSync(bannerPath)) return { embed: null, files: [] };
  return {
    embed: new EmbedBuilder().setColor(halloween ? 0xff6a00 : 0xff0000).setImage(`attachment://${bannerName}`),
    files: [{ attachment: bannerPath, name: bannerName }],
  };
}

function buildBomberXLocoPayload(event, settings) {
  const eventKey = event.eventKey || BOMBER_X_LOCO_EVENT_KEY;
  const halloween = eventKey === HALLOWEEN_EVENT_KEY;
  const title = halloween ? 'Bomber X Loco Halloween Cup' : 'Bomber X Loco Cup';
  const state = getCheckinWindowState(eventKey, event, settings);
  const realTeamCount = getEntryTeamIds(event).length;
  const byeCount = getManualByeCount(event);
  const count = realTeamCount + byeCount;
  const format = currentFormat(event);
  const participantCapacity = format || MAX_PARTICIPANTS;
  const waitlistCount = getWaitlistIds(event).length;
  const participantCount = Math.min(count - waitlistCount, participantCapacity);
  const next = nextFormat(event);
  const banner = getBanner(event);
  const description = [
    state.canJoin ? '🟢 **Anmeldung geöffnet**' : '🔴 **Anmeldung geschlossen**',
    `📅 Datum: ${formatDateTime(event.cycle?.eventDate ? `${event.cycle.eventDate}T12:00:00Z` : null, 'date')}`,
    '',
    `⏰ Offizieller Anmeldeschluss: ${formatDateTime(event.schedule?.deadlineAt)}`,
    `🎲 Gruppenauslosung live bei **Paddy HSV**: ${formatDateTime(event.schedule?.drawAt)}`,
    `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
    `✅ Anwesenheits-Check: bis ${halloween ? '20:15' : '20:55'} Uhr`,
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
    `⚠️ Nach **${formatDateTime(event.schedule?.deadlineAt)} Uhr** ist keine Anmeldung oder Abmeldung mehr möglich.`,
    '🎥 Die Gruppen werden anschließend **live bei Paddy HSV** gezogen und von der Turnierleitung manuell zugeteilt.',
    `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
  ].join('\n');
  const checkinEmbed = new EmbedBuilder().setColor(halloween ? 0xff6a00 : 0xff0000).setTitle(`${halloween ? '💣🐺🎃' : '💣🐺'} ${title} • Anmeldung`).setDescription(description).setTimestamp();
  const waitlistDescription = formatWaitlist(event);
  const waitlistEmbed = waitlistDescription
    ? new EmbedBuilder().setColor(0xffa500).setTitle('Nachrücker').setDescription(waitlistDescription)
    : null;

  return {
    embeds: [banner.embed, checkinEmbed, waitlistEmbed].filter(Boolean),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`checkin_join:${eventKey}`).setLabel('⬆️ Anmelden').setStyle(ButtonStyle.Success).setDisabled(!state.canJoin),
      new ButtonBuilder().setCustomId(`checkin_leave:${eventKey}`).setLabel('⬇️ Abmelden').setStyle(ButtonStyle.Danger).setDisabled(!state.canLeave),
      new ButtonBuilder().setCustomId('bxl_manual_group_assignment').setLabel('🎲 Gruppenzuteilung').setStyle(ButtonStyle.Primary),
    )],
    files: banner.files,
  };
}

function buildBomberXLocoBlockerPayload({ halloween = false, today = false, channelId = BOMBER_X_LOCO_CHECKIN_CHANNEL_ID } = {}) {
  const title = halloween ? 'Bomber X Loco Halloween Cup' : 'Bomber X Loco Cup';
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle(`${halloween ? '💣🐺🎃' : '💣🐺'} ${title} am ${halloween ? '30.10.2026' : '25.09.2026'}`)
      .setDescription([
        today ? '**Heute findet kein regulärer Loco Night Cup statt.**' : '**Für diesen Freitag findet kein regulärer Loco Night Cup statt.**',
        '',
        `${today ? 'Heute spielen wir' : 'Stattdessen spielen wir'} den **${title}**.`,
        channelId ? `Die Anmeldung läuft im <#${channelId}>.` : 'Die Anmeldung folgt im Eventkanal.',
        '**Anmeldeschluss: 18:30 Uhr.**',
        `**Gruppenauslosung: ${halloween ? '19:00' : '20:00'} Uhr live bei Paddy HSV.**`,
        `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bomber_x_loco_redirect:${halloween ? HALLOWEEN_EVENT_KEY : BOMBER_X_LOCO_EVENT_KEY}`).setLabel('⬆️ Anmelden').setStyle(ButtonStyle.Success).setDisabled(!channelId),
    )],
  };
}

module.exports = {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  HALLOWEEN_CHECKIN_CHANNEL_ID,
  buildBomberXLocoPayload,
  buildBomberXLocoBlockerPayload,
  getWaitlistIds,
};
