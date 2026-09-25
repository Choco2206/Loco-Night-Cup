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
  BOMBER_X_LOCO_EVENT_KEY,
  BOMBER_X_LOCO_FORMAT_SIZES,
  BOMBER_X_LOCO_REGISTRATION_DEADLINE_TIME,
  isBomberXLocoEvent,
} = require('../events/bomber-x-loco-config');

const REGISTRATION_FILE = path.join(process.cwd(), 'data', 'bomber-x-loco-registration.json');
const BANNER_PATH = path.join(ROOT_DIR, 'assets', 'bomber-x-loco', 'check-in.png');
const BANNER_NAME = 'bomber-x-loco-check-in.png';
const PADDY_HSV_TWITCH_URL = 'https://www.twitch.tv/Paddyhsv';
const FORCE_REPOST_MARKER = 'forcedRepost20260904V3At';
const RESCHEDULE_RESET_MARKER = 'resetForReschedule20260925V2At';
const EPHEMERAL = 64;
const MAX_PARTICIPANTS = Math.max(...BOMBER_X_LOCO_FORMAT_SIZES);
let clientRef = null;
let intervalRef = null;

function initialState() {
  return { eventDate: BOMBER_X_LOCO_EVENT_DATE, messageId: null, entries: [], handedOverAt: null, updatedAt: null };
}

function readState() {
  try {
    if (!fs.existsSync(REGISTRATION_FILE)) return initialState();
    const parsed = JSON.parse(fs.readFileSync(REGISTRATION_FILE, 'utf8') || '{}');
    const state = { ...initialState(), ...parsed, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    if (state.eventDate !== BOMBER_X_LOCO_EVENT_DATE) {
      state.eventDate = BOMBER_X_LOCO_EVENT_DATE;
      state.handedOverAt = null;
    }
    return state;
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

function isTargetEvent(event) {
  return isBomberXLocoEvent(event)
    && String(event.cycle?.eventDate || '') === BOMBER_X_LOCO_EVENT_DATE;
}

function resetRegistrationForReschedule(state, now = new Date()) {
  if (state[RESCHEDULE_RESET_MARKER]) return false;
  state.eventDate = BOMBER_X_LOCO_EVENT_DATE;
  state.entries = [];
  state.activeTeamIds = [];
  state.waitlistTeamIds = [];
  state.byes = [];
  state.format = {};
  state.handedOverAt = null;
  state[RESCHEDULE_RESET_MARKER] = now.toISOString();
  return true;
}

function resetEventForReschedule(event, now = new Date()) {
  if (!isTargetEvent(event)) return false;
  event.status = 'checkin_open';
  event.checkin = {
    ...(event.checkin || {}),
    isOpen: true,
    closedAt: null,
    entries: [],
    activeTeamIds: [],
    waitlistTeamIds: [],
    lateLeaveBans: [],
  };
  event.byes = [];
  event.format = {
    ...(event.format || {}),
    minimumRealTeams: 6,
    allowedSizes: [...BOMBER_X_LOCO_FORMAT_SIZES],
    size: null,
    realTeamCount: 0,
    byeCount: 0,
    activeByeCount: 0,
    waitlistByeCount: 0,
    waitlistCount: 0,
    lockedAt: null,
    lockedByUserId: null,
    participants: [],
  };
  event.groups = { status: 'not_created', drawnAt: null, drawnBy: null, groups: {} };
  event.knockout = {
    status: 'not_created',
    createdAt: null,
    source: { qualifiedRule: null, avoidSameGroupRematches: true },
    rounds: {},
  };
  event.ceremony = {
    ...(event.ceremony || {}),
    status: 'not_ready',
    placements: { firstTeamId: null, secondTeamId: null, thirdTeamId: null },
    postedAt: null,
    postedMessageIds: [],
    testRuns: [],
  };
  event.meta = { ...(event.meta || {}), rescheduleResetAt: now.toISOString(), updatedAt: now.toISOString() };
  return true;
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

function getActiveByes(state) {
  return (Array.isArray(state.byes) ? state.byes : [])
    .filter(bye => bye?.type === 'bye' && bye?.status === 'active');
}

function getWaitlistEntries(state, entries) {
  if (Array.isArray(state.waitlistTeamIds)) {
    const waitlistIds = new Set(state.waitlistTeamIds.map(String));
    return entries.filter(entry => waitlistIds.has(String(entry.teamId)));
  }
  const activeLimit = Number(state.format?.size) || currentFormat(entries.length + getActiveByes(state).length) || MAX_PARTICIPANTS;
  return entries.slice(activeLimit);
}

function formatLines(state, entries) {
  const waitlistEntries = getWaitlistEntries(state, entries);
  const waitlistIds = new Set(waitlistEntries.map(entry => String(entry.teamId)));
  const activeEntries = entries.filter(entry => !waitlistIds.has(String(entry.teamId)));
  const byes = getActiveByes(state);
  const storedActiveByeCount = Number(state.format?.activeByeCount);
  const activeByeCount = Math.min(
    byes.length,
    Math.max(0, MAX_PARTICIPANTS - activeEntries.length),
    Number.isFinite(storedActiveByeCount) ? Math.max(0, storedActiveByeCount) : byes.length,
  );
  const labels = [
    ...activeEntries.map(entry => teamName(entry.teamId)),
    ...Array.from({ length: activeByeCount }, (_, index) => activeByeCount > 1 ? `Freilos ${index + 1}` : 'Freilos'),
    ...waitlistEntries.map(entry => `${teamName(entry.teamId)} (WL)`),
  ];
  const lines = [];
  for (let index = 0; index < MAX_PARTICIPANTS; index += 1) {
    lines.push(`${index + 1} | ${labels[index] || '—'}`);
    if (BOMBER_X_LOCO_FORMAT_SIZES.includes(index + 1)) lines.push(`══════⬆️ ${index + 1}er Turnier ⬆️══════`);
  }
  return lines;
}

function formatWaitlistLines(state, entries) {
  const teamLines = getWaitlistEntries(state, entries)
    .map((entry, index) => `${index + 1} | ${teamName(entry.teamId)} (WL)`);
  const waitlistByeCount = Math.max(0, getActiveByes(state).length - Number(state.format?.activeByeCount || 0));
  return [
    ...teamLines,
    ...Array.from({ length: waitlistByeCount }, (_, index) => `${teamLines.length + index + 1} | Freilos (WL)`),
  ];
}

function stateFromLiveEvent(event) {
  return {
    ...readState(),
    entries: normalizeEntries((event.checkin?.entries || []).map(entry => ({
      teamId: String(entry.teamId),
      checkedInByUserId: String(entry.checkedInByUserId || ''),
      checkedInAt: entry.checkedInAt || null,
    }))),
    activeTeamIds: Array.isArray(event.checkin?.activeTeamIds) ? event.checkin.activeTeamIds.map(String) : [],
    waitlistTeamIds: Array.isArray(event.checkin?.waitlistTeamIds) ? event.checkin.waitlistTeamIds.map(String) : [],
    byes: Array.isArray(event.byes) ? event.byes.map(bye => ({ ...bye })) : [],
    format: { ...(event.format || {}) },
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
  const byeCount = getActiveByes(state).length;
  const count = cleanEntries.length + byeCount;
  const format = currentFormat(count);
  const participantCapacity = format || MAX_PARTICIPANTS;
  const next = BOMBER_X_LOCO_FORMAT_SIZES.find(size => size > count) || null;
  const waitlistLines = formatWaitlistLines(state, cleanEntries);
  const participantCount = Math.min(count - waitlistLines.length, participantCapacity);
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
      '📅 Freitag, 25.09.2026',
      '',
      '⏰ Offizieller Anmeldeschluss: 18:30 Uhr',
      '🎲 Gruppenauslosung live bei Paddy HSV: 20:00 Uhr',
      `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
      '✅ Anwesenheits-Check: bis 20:55 Uhr',
      '🚀 Turnierstart: 21:00 Uhr',
      '',
      `🏆 Aktuelles Format: ${format ? `${format}er Turnier` : 'noch kein gültiges Format'}`,
      `👥 Teilnehmerfeld: ${participantCount}/${participantCapacity} Plätze${byeCount ? ` (${cleanEntries.length} Teams + ${byeCount} Freilos${byeCount === 1 ? '' : 'e'})` : ''}`,
      `⚠️ Warteliste: ${waitlistLines.length} Teilnehmerplätze`,
      next ? `Nächster Schritt: ${next} Teams • noch ${next - count} erforderlich` : `${MAX_PARTICIPANTS}er-Format erreicht • weitere Anmeldungen kommen auf die Warteliste`,
      '',
      '**👥 Teilnehmende Teams**',
      '',
      ...formatLines(state, cleanEntries),
      ...(waitlistLines.length ? [
        '',
        `**⚠️ Warteliste (${waitlistLines.length})**`,
        '_Diese Teams rücken bei einer Abmeldung automatisch in Anmeldereihenfolge nach._',
        ...waitlistLines,
      ] : []),
      '',
      '⚠️ Nach **18:30 Uhr** ist keine Anmeldung oder Abmeldung mehr möglich.',
      '🎥 Die Gruppen werden anschließend **live bei Paddy HSV** gezogen und von der Turnierleitung manuell zugeteilt.',
      `📺 Twitch: ${PADDY_HSV_TWITCH_URL}`,
    ].join('\n'));

  return {
    embeds: [bannerEmbed, checkinEmbed].filter(Boolean),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(liveEvent ? `checkin_join:${BOMBER_X_LOCO_EVENT_KEY}` : 'bomber_x_loco_join')
        .setLabel('⬆️ Anmelden')
        .setStyle(ButtonStyle.Success)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(liveEvent ? `checkin_leave:${BOMBER_X_LOCO_EVENT_KEY}` : 'bomber_x_loco_leave')
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
  const event = readEventData(BOMBER_X_LOCO_EVENT_KEY);
  const liveEvent = isBomberXLocoEvent(event) && String(event.cycle?.eventDate || '') === BOMBER_X_LOCO_EVENT_DATE;
  const channel = await clientRef.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  if (!channel?.send) return false;

  let storedState = readCleanState();
  if (liveEvent && storedState.handedOverAt) storedState = syncStateFromLiveEvent(event);
  const renderState = liveEvent ? stateFromLiveEvent(event) : storedState;
  let message = storedState.messageId ? await channel.messages.fetch(storedState.messageId).catch(() => null) : null;

  // Den bereits geposteten, aber fälschlich mit den Teams vom 05.09. befüllten
  // Bomber-Post übernehmen. So wird derselbe Post geleert und weiterverwendet,
  // statt eine zweite Nachricht daneben zu erstellen.
  if (!message) {
    const messages = readJson(FILES.messages, createMessagesDefault());
    const currentPanelId = messages.checkins?.[BOMBER_X_LOCO_EVENT_KEY]?.specialMainMessageId;
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
      messages.checkins[BOMBER_X_LOCO_EVENT_KEY] = messages.checkins[BOMBER_X_LOCO_EVENT_KEY] || {};
      messages.checkins[BOMBER_X_LOCO_EVENT_KEY].specialChannelId = BOMBER_X_LOCO_CHECKIN_CHANNEL_ID;
      messages.checkins[BOMBER_X_LOCO_EVENT_KEY].specialMainMessageId = message.id;
      messages.checkins[BOMBER_X_LOCO_EVENT_KEY].updatedAt = new Date().toISOString();
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

async function handOverToEvent() {
  const eventState = readEventData(BOMBER_X_LOCO_EVENT_KEY);
  if (!isBomberXLocoEvent(eventState) || String(eventState.cycle?.eventDate || '') !== BOMBER_X_LOCO_EVENT_DATE) return false;
  const state = readCleanState();

  if (state.handedOverAt) {
    syncStateFromLiveEvent(eventState);
    return false;
  }

  const settings = readJson(FILES.settings, createSettingsDefault());

  updateEventData(BOMBER_X_LOCO_EVENT_KEY, event => {
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

  const liveEvent = readEventData(BOMBER_X_LOCO_EVENT_KEY);
  const synced = syncStateFromLiveEvent(liveEvent);
  console.log(`[bomber-x-loco] Offizieller Check-in an ${BOMBER_X_LOCO_EVENT_KEY}-Event übergeben: ${synced.entries.length} Teams`);
  await ensurePanel();
  return true;
}

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!['bomber_x_loco_join', 'bomber_x_loco_leave'].includes(interaction.customId)) return false;

  try {
    if (isRegistrationClosed()) throw new Error('Die Anmeldung für den Bomber X Loco Cup ist seit 18:30 Uhr geschlossen.');
    const eventState = readEventData(BOMBER_X_LOCO_EVENT_KEY);
    if (isBomberXLocoEvent(eventState) && String(eventState.cycle?.eventDate || '') === BOMBER_X_LOCO_EVENT_DATE) {
      await handOverToEvent();
      await ensurePanel();
      throw new Error('Der Bomber X Loco Cup läuft jetzt im Event-State. Bitte nutze denselben Anmelde-Post erneut.');
    }

    const state = readCleanState();

    if (interaction.customId === 'bomber_x_loco_join') {
      const team = validTeamForUser(interaction.user.id);
      const index = state.entries.findIndex(entry => String(entry.teamId) === String(team.id));
      if (index !== -1) throw new Error('Dein Team ist bereits für den Bomber X Loco Cup angemeldet.');
      state.entries.push({ teamId: String(team.id), checkedInByUserId: String(interaction.user.id), checkedInAt: new Date().toISOString() });
      const waitlistPosition = state.entries.length - MAX_PARTICIPANTS;
      writeState(state);
      await ensurePanel();
      await interaction.reply({
        content: waitlistPosition > 0
          ? `✅ **${team.clubName}** wurde auf Wartelistenplatz **${waitlistPosition}** eingetragen und rückt bei einer Abmeldung automatisch nach.`
          : `✅ **${team.clubName}** wurde angemeldet.`,
        flags: EPHEMERAL,
      });
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
  const handedOver = await handOverToEvent();
  if (!handedOver) await ensurePanel();
  return true;
}

module.exports = {
  async init(client) {
    clientRef = client;

    // Der abgesagte Cup vom 19.09. darf keine Teilnehmer in den Ersatztermin
    // am 25.09. übernehmen. Der Marker verhindert, dass spätere Neustarts neu
    // eingegangene Anmeldungen erneut löschen.
    const registrationState = readState();
    if (resetRegistrationForReschedule(registrationState)) {
      updateEventData(BOMBER_X_LOCO_EVENT_KEY, event => {
        resetEventForReschedule(event);
        return event;
      });
      writeState(registrationState);
      console.log('[bomber-x-loco] Alte Anmeldung und Freitag-Eventstand geleert; Ersatztermin 25.09. startet leer');
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
  handOverToEvent,
  ensurePanel,
  buildPayload,
  resetEventForReschedule,
  resetRegistrationForReschedule,
  stateFromLiveEvent,
};
