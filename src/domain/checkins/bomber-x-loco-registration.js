'use strict';

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { FILES, ROOT_DIR, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { findNonDeletedTeamByUserId, findTeamById, isTeamMember } = require('../teams/team-service');
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
const PADDY_HSV_TWITCH_URL = 'https://www.twitch.tv/Paddyhsv';
const FORCE_REPOST_MARKER = 'forcedRepost20260904V3At';
const SATURDAY_SEPARATION_MARKER = 'separatedFromSaturday20260905At';
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

function isValidRegistrationTeam(team, actorUserId = null, now = new Date()) {
  if (!team || team.status !== 'active' || team.registrationStatus !== 'complete') return false;
  return !findActiveBanForTeamOrManagers(team, actorUserId, now);
}

function normalizeEntries(entries, now = new Date()) {
  const seen = new Set();
  const result = [];
  for (const entry of entries || []) {
    const teamId = String(entry?.teamId || '').trim();
    if (!teamId || seen.has(teamId)) continue;
    const team = findTeamById(teamId);
    if (!isValidRegistrationTeam(team, entry?.checkedInByUserId, now)) continue;
    seen.add(teamId);
    result.push({
      teamId,
      checkedInByUserId: String(entry?.checkedInByUserId || ''),
      checkedInAt: entry?.checkedInAt || null,
    });
  }
  return result;
}

function readCleanState() {
  const state = readState();
  const cleaned = normalizeEntries(state.entries);
  const changed = cleaned.length !== state.entries.length
    || cleaned.some((entry, index) => String(entry.teamId) !== String(state.entries[index]?.teamId));
  if (changed) {
    state.entries = cleaned;
    writeState(state);
  }
  return state;
}

function validTeamForUser(userId) {
  const team = findNonDeletedTeamByUserId(userId);
  if (!team || !isValidRegistrationTeam(team, userId, new Date())) {
    throw new Error('Du bist keinem vollständig registrierten aktiven Team als VM oder Co-VM zugeordnet.');
  }
  return team;
}

function registeredTeamForUser(state, userId) {
  const id = String(userId);
  for (const entry of state.entries || []) {
    const team = findTeamById(entry.teamId);
    if (!team) continue;
    if (String(entry.checkedInByUserId || '') === id || isTeamMember(team, id)) return team;
  }
  return null;
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
    entries: normalizeEntries((event.checkin?.entries || []).map(entry => ({
      teamId: String(entry.teamId),
      checkedInByUserId: String(entry.checkedInByUserId || ''),
      checkedInAt: entry.checkedInAt || null,
    }))),
  };
}

function syncStateFromLiveEvent(event) {
  const liveState = stateFromLiveEvent(event);
  const state = readState();
  state.entries = liveState.entries;
  state.handedOverAt = state.handedOverAt || new Date().toISOString();
  writeState(state);
  return state;
}

function buildPayload(state, { liveEvent = false } = {}) {
  const cleanEntries = normalizeEntries(state.entries);
  const count = cleanEntries.length;
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
      `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
      '✅ Anwesenheits-Check: bis 20:00 Uhr',
      '🚀 Turnierstart: 21:00 Uhr',
      '',
      `🏆 Aktuelles Format: ${format ? `${format}er Turnier` : 'noch kein gültiges Format'}`,
      `👥 Angemeldet: ${count}/48 Teams`,
      next ? `Nächster Schritt: ${next} Teams • noch ${next - count} erforderlich` : 'Maximales Format erreicht',
      '',
      '**👥 Teilnehmende Teams**',
      '',
      ...formatLines(cleanEntries),
      '',
      '⚠️ Nach **18:30 Uhr** ist keine Anmeldung oder Abmeldung mehr möglich.',
      '🎥 Die Gruppen werden anschließend **live bei Paddy HSV** gezogen und von der Turnierleitung manuell zugeteilt.',
      `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
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

  let storedState = readCleanState();
  if (liveEvent && storedState.handedOverAt) storedState = syncStateFromLiveEvent(saturday);
  const renderState = liveEvent ? stateFromLiveEvent(saturday) : storedState;
  let message = storedState.messageId ? await channel.messages.fetch(storedState.messageId).catch(() => null) : null;

  // Den bereits geposteten, aber fälschlich mit den Teams vom 05.09. befüllten
  // Bomber-Post übernehmen. So wird derselbe Post geleert und weiterverwendet,
  // statt eine zweite Nachricht daneben zu erstellen.
  if (!message) {
    const messages = readJson(FILES.messages, createMessagesDefault());
    const currentPanelId = messages.checkins?.saturday?.specialMainMessageId;
    if (currentPanelId) {
      message = await channel.messages.fetch(String(currentPanelId)).catch(() => null);
      if (message) {
        storedState.messageId = String(message.id);
        writeState(storedState);
        console.log(`[bomber-x-loco] Bestehenden Bomber-Post als getrennten Check-in übernommen: ${message.id}`);
      }
    }
  }

  const payload = buildPayload(renderState, { liveEvent });

  if (message) {
    await message.edit({ ...payload, attachments: [] });
    console.log(`[bomber-x-loco] Getrennter Check-in aktualisiert: ${message.id}, Teams: ${renderState.entries.length}`);
  }
  else {
    message = await channel.send(payload);
    storedState.messageId = message.id;
    writeState(storedState);
    console.log(`[bomber-x-loco] Getrennter Check-in neu gepostet: ${message.id}, Teams: ${renderState.entries.length}`);
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

async function forceRepostOnce() {
  const state = readCleanState();
  if (state[FORCE_REPOST_MARKER]) return false;

  const channel = await clientRef?.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  if (!channel?.send) throw new Error('Bomber-X-Loco-Check-in-Kanal konnte nicht gefunden werden.');

  if (state.messageId) {
    const oldMessage = await channel.messages.fetch(String(state.messageId)).catch(() => null);
    if (oldMessage) await oldMessage.delete().catch(() => null);
  }
  state.messageId = null;
  writeState(state);

  const created = await ensurePanel();
  const after = readState();
  if (!created || !after.messageId) {
    throw new Error('Bomber-X-Loco-Check-in konnte beim einmaligen Repost nicht erstellt werden.');
  }

  after[FORCE_REPOST_MARKER] = new Date().toISOString();
  writeState(after);
  console.log(`[bomber-x-loco] Check-in einmalig neu gepostet: ${after.messageId}`);
  return true;
}

async function handOverToSaturdayEvent() {
  const saturday = readEventData('saturday');
  if (!isBomberXLocoEvent(saturday) || String(saturday.cycle?.eventDate || '') !== BOMBER_X_LOCO_EVENT_DATE) return false;
  const state = readCleanState();

  if (state.handedOverAt) {
    syncStateFromLiveEvent(saturday);
    return false;
  }

  const settings = readJson(FILES.settings, createSettingsDefault());

  updateEventData('saturday', event => {
    event.checkin = event.checkin || {};
    event.checkin.entries = Array.isArray(event.checkin.entries) ? event.checkin.entries : [];
    const existing = new Set(event.checkin.entries.map(entry => String(entry.teamId)));
    for (const entry of state.entries) {
      const team = findTeamById(entry.teamId);
      if (!isValidRegistrationTeam(team, entry.checkedInByUserId, new Date())) continue;
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

  const liveEvent = readEventData('saturday');
  const synced = syncStateFromLiveEvent(liveEvent);
  console.log(`[bomber-x-loco] Offizieller Check-in an Saturday-Event übergeben: ${synced.entries.length} Teams`);
  await ensurePanel();
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

    const state = readCleanState();

    if (interaction.customId === 'bomber_x_loco_join') {
      const team = validTeamForUser(interaction.user.id);
      const index = state.entries.findIndex(entry => String(entry.teamId) === String(team.id));
      if (index !== -1) throw new Error('Dein Team ist bereits für den Bomber X Loco Cup angemeldet.');
      if (state.entries.length >= 48) throw new Error('Der Bomber X Loco Cup ist bereits mit 48 Teams voll.');
      state.entries.push({ teamId: String(team.id), checkedInByUserId: String(interaction.user.id), checkedInAt: new Date().toISOString() });
      writeState(state);
      await ensurePanel();
      await interaction.reply({ content: `✅ **${team.clubName}** wurde angemeldet.`, flags: EPHEMERAL });
      return true;
    }

    const team = registeredTeamForUser(state, interaction.user.id);
    if (!team) throw new Error('Dein Team ist aktuell nicht für den Bomber X Loco Cup angemeldet.');
    const index = state.entries.findIndex(entry => String(entry.teamId) === String(team.id));
    if (index === -1) throw new Error('Dein Team ist aktuell nicht für den Bomber X Loco Cup angemeldet.');
    state.entries.splice(index, 1);
    writeState(state);
    await ensurePanel();
    await interaction.reply({ content: `⬇️ **${team.clubName}** wurde abgemeldet.`, flags: EPHEMERAL });
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

    // Einmalige Korrektur der versehentlichen Vermischung: Die Einträge im
    // Saturday-Event gehören zum normalen Cup am 05.09. und bleiben dort.
    // Der eigenständige Bomber-Check-in für den 19.09. beginnt leer.
    const separatedState = readState();
    if (!separatedState[SATURDAY_SEPARATION_MARKER]) {
      separatedState.entries = [];
      separatedState.handedOverAt = null;
      separatedState[SATURDAY_SEPARATION_MARKER] = new Date().toISOString();
      writeState(separatedState);
      console.log('[bomber-x-loco] Bomber-Anmeldeliste vom Saturday-Check-in getrennt und leer gestartet');
    }

    await forceRepostOnce().catch(error => console.error(`[bomber-x-loco] Einmaliger Check-in-Repost fehlgeschlagen: ${error.message}`));
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
