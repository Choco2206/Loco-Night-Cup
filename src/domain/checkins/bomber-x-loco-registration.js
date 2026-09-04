'use strict';

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { FILES, ROOT_DIR, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { findNonDeletedTeamByUserId, findTeamById } = require('../teams/team-service');
const { findActiveBanForTeamOrManagers } = require('./checkin-ban-integration');
const { readEventData, updateEventData } = require('./checkin-repository');
const { recalculateCheckinFormat } = require('./checkin-format');
const {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_FORMAT_SIZES,
  BOMBER_X_LOCO_REGISTRATION_DEADLINE_TIME,
  isBomberXLocoEvent,
} = require('../events/bomber-x-loco-config');

const REGISTRATION_FILE = path.join(process.cwd(), 'data', 'bomber-x-loco-registration.json');
const BANNER_PATH = path.join(ROOT_DIR, 'assets', 'bomber-x-loco', 'check-in.png');
const BANNER_NAME = 'bomber-x-loco-check-in.png';
const EPHEMERAL = 64;
let clientRef = null;
let intervalRef = null;

function initialState() {
  return { eventDate: BOMBER_X_LOCO_EVENT_DATE, messageId: null, entries: [], handedOverAt: null, updatedAt: null };
}

function readState() {
  try {
    if (!fs.existsSync(REGISTRATION_FILE)) return initialState();
    const parsed = JSON.parse(fs.readFileSync(REGISTRATION_FILE, 'utf8') || '{}');
    return { ...initialState(), ...parsed, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return initialState();
  }
}

function writeState(state) {
  const dir = path.dirname(REGISTRATION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(REGISTRATION_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function registrationDeadline() {
  return new Date(`${BOMBER_X_LOCO_EVENT_DATE}T${BOMBER_X_LOCO_REGISTRATION_DEADLINE_TIME}:00+02:00`);
}

function isRegistrationClosed(now = new Date()) {
  return now.getTime() >= registrationDeadline().getTime();
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

function formatLines(entries) {
  const lines = [];
  for (let index = 0; index < 48; index += 1) {
    const entry = entries[index];
    lines.push(`${index + 1}. ${entry ? teamName(entry.teamId) : '—'}`);
    if (BOMBER_X_LOCO_FORMAT_SIZES.includes(index + 1)) lines.push(`══════⬆️ ${index + 1}er Turnier ⬆️══════`);
  }
  return lines;
}

function stateFromLiveEvent(event) {
  return {
    ...readState(),
    entries: (event.checkin?.entries || []).map(entry => ({
      teamId: String(entry.teamId),
      checkedInByUserId: String(entry.checkedInByUserId || ''),
      checkedInAt: entry.checkedInAt || null,
    })),
  };
}

function buildPayload(state, { liveEvent = false } = {}) {
  const count = state.entries.length;
  const format = currentFormat(count);
  const next = BOMBER_X_LOCO_FORMAT_SIZES.find(size => size > count) || null;
  const closed = isRegistrationClosed();
  const bannerExists = fs.existsSync(BANNER_PATH);
  const bannerEmbed = bannerExists
    ? new EmbedBuilder().setColor(0xff0000).setImage(`attachment://${BANNER_NAME}`)
    : null;
  const checkinEmbed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('💣🐺 Bomber X Loco Cup • Anmeldung')
    .setDescription([
      closed ? '🔴 **Anmeldung geschlossen**' : '🟢 **Anmeldung geöffnet**',
      '📅 Samstag, 19.09.2026',
      '',
      '⏰ Offizieller Anmeldeschluss: 18:30 Uhr',
      '🎲 Gruppenauslosung live bei Paddy HSV: 19:00 Uhr',
      '✅ Anwesenheits-Check: bis 20:00 Uhr',
      '🚀 Turnierstart: 21:00 Uhr',
      '',
      `🏆 Aktuelles Format: ${format ? `${format}er Turnier` : 'noch kein gültiges Format'}`,
      `👥 Angemeldet: ${count}/48 Teams`,
      next ? `Nächster Schritt: ${next} Teams • noch ${next - count} erforderlich` : 'Maximales Format erreicht',
      '',
      '**👥 Teilnehmende Teams**',
      '',
      ...formatLines(state.entries),
      '',
      '⚠️ Nach **18:30 Uhr** ist keine Anmeldung oder Abmeldung mehr möglich.',
    ].join('\n'));

  return {
    embeds: [bannerEmbed, checkinEmbed].filter(Boolean),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(liveEvent ? 'checkin_join:saturday' : 'bomber_x_loco_join')
        .setLabel('⬆️ Anmelden')
        .setStyle(ButtonStyle.Success)
        .setDisabled(closed || count >= 48),
      new ButtonBuilder()
        .setCustomId(liveEvent ? 'checkin_leave:saturday' : 'bomber_x_loco_leave')
        .setLabel('⬇️ Abmelden')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId('bxl_manual_group_assignment')
        .setLabel('🎲 Gruppenzuteilung')
        .setStyle(ButtonStyle.Primary)
    )],
    files: bannerExists ? [{ attachment: BANNER_PATH, name: BANNER_NAME }] : [],
  };
}

async function ensurePanel() {
  if (!clientRef) return false;
  const saturday = readEventData('saturday');
  const liveEvent = isBomberXLocoEvent(saturday) && String(saturday.cycle?.eventDate || '') === BOMBER_X_LOCO_EVENT_DATE;
  const channel = await clientRef.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  if (!channel?.send) return false;

  const storedState = readState();
  const renderState = liveEvent ? stateFromLiveEvent(saturday) : storedState;
  let message = storedState.messageId ? await channel.messages.fetch(storedState.messageId).catch(() => null) : null;
  const payload = buildPayload(renderState, { liveEvent });

  if (message) await message.edit({ ...payload, attachments: [] });
  else {
    message = await channel.send(payload);
    storedState.messageId = message.id;
    writeState(storedState);
  }

  if (liveEvent) {
    updateJson(FILES.messages, createMessagesDefault(), messages => {
      messages.checkins = messages.checkins || {};
      messages.checkins.saturday = messages.checkins.saturday || {};
      messages.checkins.saturday.specialChannelId = BOMBER_X_LOCO_CHECKIN_CHANNEL_ID;
      messages.checkins.saturday.specialMainMessageId = message.id;
      messages.checkins.saturday.updatedAt = new Date().toISOString();
      return messages;
    });
  }
  return true;
}

async function handOverToSaturdayEvent() {
  const saturday = readEventData('saturday');
  if (!isBomberXLocoEvent(saturday) || String(saturday.cycle?.eventDate || '') !== BOMBER_X_LOCO_EVENT_DATE) return false;
  const state = readState();
  if (state.handedOverAt) return false;
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
        importedFromBomberRegistration: true,
      });
      existing.add(String(entry.teamId));
    }
    recalculateCheckinFormat(event, settings);
    event.meta = { ...(event.meta || {}), updatedAt: new Date().toISOString() };
    return event;
  });

  state.handedOverAt = new Date().toISOString();
  writeState(state);
  await ensurePanel();
  console.log(`[bomber-x-loco] Offizieller Check-in an Saturday-Event übergeben: ${state.entries.length} Teams`);
  return true;
}

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!['bomber_x_loco_join', 'bomber_x_loco_leave'].includes(interaction.customId)) return false;

  try {
    if (isRegistrationClosed()) throw new Error('Die Anmeldung für den Bomber X Loco Cup ist seit 18:30 Uhr geschlossen.');
    const saturday = readEventData('saturday');
    if (isBomberXLocoEvent(saturday) && String(saturday.cycle?.eventDate || '') === BOMBER_X_LOCO_EVENT_DATE) {
      await handOverToSaturdayEvent();
      await ensurePanel();
      throw new Error('Der Bomber X Loco Cup läuft jetzt im Event-State. Bitte nutze denselben Anmelde-Post erneut.');
    }

    const team = validTeamForUser(interaction.user.id);
    const state = readState();
    const index = state.entries.findIndex(entry => String(entry.teamId) === String(team.id));
    if (interaction.customId === 'bomber_x_loco_join') {
      if (index !== -1) throw new Error('Dein Team ist bereits für den Bomber X Loco Cup angemeldet.');
      if (state.entries.length >= 48) throw new Error('Der Bomber X Loco Cup ist bereits mit 48 Teams voll.');
      state.entries.push({ teamId: String(team.id), checkedInByUserId: String(interaction.user.id), checkedInAt: new Date().toISOString() });
    } else {
      if (index === -1) throw new Error('Dein Team ist aktuell nicht für den Bomber X Loco Cup angemeldet.');
      state.entries.splice(index, 1);
    }
    writeState(state);
    await ensurePanel();
    await interaction.reply({
      content: interaction.customId === 'bomber_x_loco_join'
        ? `✅ **${team.clubName}** wurde angemeldet.`
        : `⬇️ **${team.clubName}** wurde abgemeldet.`,
      flags: EPHEMERAL,
    });
    return true;
  } catch (error) {
    await interaction.reply({ content: error.message || 'Aktion konnte nicht ausgeführt werden.', flags: EPHEMERAL }).catch(() => {});
    return true;
  }
}

async function reconcile() {
  const handedOver = await handOverToSaturdayEvent();
  if (!handedOver) await ensurePanel();
  return true;
}

module.exports = {
  async init(client) {
    clientRef = client;
    await reconcile();
    if (!intervalRef) {
      intervalRef = setInterval(() => {
        reconcile().catch(error => console.error('[bomber-x-loco-registration]', error));
      }, 60 * 1000);
      if (typeof intervalRef.unref === 'function') intervalRef.unref();
    }
  },
  handleInteraction,
  handOverToSaturdayEvent,
  ensurePanel,
};
