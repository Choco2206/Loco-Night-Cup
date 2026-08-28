'use strict';

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { findNonDeletedTeamByUserId, findTeamById } = require('../teams/team-service');
const { findActiveBanForTeamOrManagers } = require('./checkin-ban-integration');
const { readEventData, updateEventData } = require('./checkin-repository');
const { recalculateCheckinFormat } = require('./checkin-format');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_FORMAT_SIZES,
  isBomberXLocoEvent,
} = require('../events/bomber-x-loco-config');

const PRECHECKIN_FILE = path.join(process.cwd(), 'data', 'bomber-x-loco-precheckin.json');
const EPHEMERAL = 64;
let clientRef = null;
let intervalRef = null;

function initialState() {
  return { eventDate: BOMBER_X_LOCO_EVENT_DATE, messageId: null, entries: [], migratedAt: null, updatedAt: null };
}

function readState() {
  try {
    if (!fs.existsSync(PRECHECKIN_FILE)) return initialState();
    const parsed = JSON.parse(fs.readFileSync(PRECHECKIN_FILE, 'utf8') || '{}');
    return { ...initialState(), ...parsed, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return initialState();
  }
}

function writeState(state) {
  const dir = path.dirname(PRECHECKIN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(PRECHECKIN_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function validTeamForUser(userId) {
  const team = findNonDeletedTeamByUserId(userId);
  if (!team || team.status !== 'active' || team.registrationStatus !== 'complete') {
    throw new Error('Du bist keinem vollständig registrierten aktiven Team als VM oder Co-VM zugeordnet.');
  }
  if (findActiveBanForTeamOrManagers(team, userId, new Date())) {
    throw new Error('Dein Team oder ein zugehöriger Manager ist aktuell gesperrt.');
  }
  return team;
}

function teamName(teamId) {
  return findTeamById(teamId)?.clubName || `Unbekanntes Team (${teamId})`;
}

function currentFormat(count) {
  return [...BOMBER_X_LOCO_FORMAT_SIZES].filter(size => size <= count).pop() || null;
}

function buildPayload(state) {
  const count = state.entries.length;
  const format = currentFormat(count);
  const next = BOMBER_X_LOCO_FORMAT_SIZES.find(size => size > count) || null;
  const lines = Array.from({ length: 48 }, (_, index) => {
    const entry = state.entries[index];
    return `${index + 1}. ${entry ? teamName(entry.teamId) : '—'}`;
  });

  return {
    embeds: [new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('💣🐺 Bomber X Loco Cup • Check-in')
      .setDescription([
        '🟢 **Voranmeldung geöffnet**',
        '📅 Samstag, 19.09.2026',
        '',
        '⏰ Anmeldeschluss: 20:30 Uhr',
        '🕒 Late-Check-in bis: 20:45 Uhr',
        '🎲 Gruppenauslosung: 20:50 Uhr',
        '🚀 Turnierstart: 21:00 Uhr',
        '',
        `🏆 Aktuelles Format: ${format ? `${format} Teams` : 'noch kein gültiges Format'}`,
        `👥 Angemeldet: ${count}/48 Teams`,
        next ? `Nächster Schritt: ${next} Teams • noch ${next - count} erforderlich` : 'Maximales Format erreicht',
        '',
        '**Teilnehmende Teams**',
        ...lines,
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bomber_x_loco_prejoin').setLabel('⬆️ Anmelden').setStyle(ButtonStyle.Success).setDisabled(count >= 48),
      new ButtonBuilder().setCustomId('bomber_x_loco_preleave').setLabel('⬇️ Abmelden').setStyle(ButtonStyle.Danger),
    )],
  };
}

async function ensurePanel() {
  if (!clientRef) return false;
  const saturday = readEventData('saturday');
  if (isBomberXLocoEvent(saturday)) return false;
  const channel = await clientRef.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  if (!channel?.send) return false;
  const state = readState();
  let message = state.messageId ? await channel.messages.fetch(state.messageId).catch(() => null) : null;
  if (message) await message.edit({ ...buildPayload(state), attachments: [] });
  else { message = await channel.send(buildPayload(state)); state.messageId = message.id; writeState(state); }
  return true;
}

async function migrateIntoSaturdayEvent() {
  const saturday = readEventData('saturday');
  if (!isBomberXLocoEvent(saturday)) return false;
  const state = readState();
  if (state.migratedAt) return false;
  const settings = readJson(FILES.settings, createSettingsDefault());

  updateEventData('saturday', event => {
    event.checkin = event.checkin || {};
    event.checkin.entries = Array.isArray(event.checkin.entries) ? event.checkin.entries : [];
    const existing = new Set(event.checkin.entries.map(entry => String(entry.teamId)));
    for (const entry of state.entries) {
      const team = findTeamById(entry.teamId);
      if (!team || team.status !== 'active' || team.registrationStatus !== 'complete') continue;
      if (findActiveBanForTeamOrManagers(team, entry.checkedInByUserId, new Date())) continue;
      if (existing.has(String(entry.teamId))) continue;
      event.checkin.entries.push({
        teamId: String(entry.teamId),
        checkedInByUserId: String(entry.checkedInByUserId),
        checkedInAt: entry.checkedInAt,
        importedFromBomberXLocoPrecheckin: true,
      });
      existing.add(String(entry.teamId));
    }
    recalculateCheckinFormat(event, settings);
    event.meta = { ...(event.meta || {}), updatedAt: new Date().toISOString() };
    return event;
  });

  state.migratedAt = new Date().toISOString();
  writeState(state);
  if (clientRef && state.messageId) {
    const channel = await clientRef.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
    const message = channel ? await channel.messages.fetch(state.messageId).catch(() => null) : null;
    if (message) await message.delete().catch(() => null);
  }
  return true;
}

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!['bomber_x_loco_prejoin', 'bomber_x_loco_preleave'].includes(interaction.customId)) return false;

  const saturday = readEventData('saturday');
  if (isBomberXLocoEvent(saturday)) {
    await interaction.reply({ content: 'Der reguläre Bomber-X-Loco-Event-Check-in ist bereits aktiv. Bitte nutze den aktuellen Check-in-Post.', flags: EPHEMERAL });
    return true;
  }

  try {
    const team = validTeamForUser(interaction.user.id);
    const state = readState();
    const index = state.entries.findIndex(entry => String(entry.teamId) === String(team.id));
    if (interaction.customId === 'bomber_x_loco_prejoin') {
      if (index !== -1) throw new Error('Dein Team ist bereits für den Bomber X Loco Cup angemeldet.');
      if (state.entries.length >= 48) throw new Error('Der Bomber X Loco Cup ist bereits mit 48 Teams voll.');
      state.entries.push({ teamId: String(team.id), checkedInByUserId: String(interaction.user.id), checkedInAt: new Date().toISOString() });
    } else {
      if (index === -1) throw new Error('Dein Team ist aktuell nicht für den Bomber X Loco Cup angemeldet.');
      state.entries.splice(index, 1);
    }
    writeState(state);
    await ensurePanel();
    await interaction.reply({ content: interaction.customId === 'bomber_x_loco_prejoin' ? `✅ **${team.clubName}** wurde angemeldet.` : `⬇️ **${team.clubName}** wurde abgemeldet.`, flags: EPHEMERAL });
    return true;
  } catch (error) {
    await interaction.reply({ content: error.message || 'Aktion konnte nicht ausgeführt werden.', flags: EPHEMERAL }).catch(() => {});
    return true;
  }
}

async function reconcile() {
  const migrated = await migrateIntoSaturdayEvent();
  if (!migrated) await ensurePanel();
}

module.exports = {
  async init(client) {
    clientRef = client;
    await reconcile();
    if (!intervalRef) {
      intervalRef = setInterval(() => reconcile().catch(error => console.error('[bomber-x-loco-precheckin]', error)), 60 * 1000);
      if (typeof intervalRef.unref === 'function') intervalRef.unref();
    }
  },
  handleInteraction,
  migrateIntoSaturdayEvent,
};
