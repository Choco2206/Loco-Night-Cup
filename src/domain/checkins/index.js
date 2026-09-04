'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault } = require('../../storage/defaults');
const { ensureAllCheckinMessages, refreshCheckinMessage } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile, reconcileCheckinEvent } = require('./checkin-reconcile');
const { scheduleManualDrawPreparation } = require('./bomber-x-loco-manual-draw');
const { updateEventData } = require('./checkin-repository');
const {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_FORMAT_SIZES,
  buildBomberXLocoSchedule,
} = require('../events/bomber-x-loco-config');

const OLD_BOMBER_CHECKIN_MESSAGE_ID = '1542840384520978503';
const BOMBER_REPOST_MARKER = 'bomberFreshCheckinRepost20260904V2At';

function nowIso() {
  return new Date().toISOString();
}

function pinBomberEventCycle(now = new Date()) {
  const schedule = buildBomberXLocoSchedule(BOMBER_X_LOCO_EVENT_DATE);
  if (now.getTime() >= schedule.resetAt.getTime()) return false;

  let changed = false;
  updateEventData('saturday', event => {
    event.cycle = event.cycle || {};
    event.schedule = event.schedule || {};
    event.meta = event.meta || {};
    event.format = event.format || {};
    event.checkin = event.checkin || {};

    const cycleValues = {
      cycleKey: schedule.cycleKey,
      eventDate: schedule.eventDate,
      timezone: schedule.timeZone,
    };
    for (const [field, value] of Object.entries(cycleValues)) {
      if (event.cycle[field] !== value) {
        event.cycle[field] = value;
        changed = true;
      }
    }

    const scheduleValues = {
      deadlineAt: schedule.deadlineAt.toISOString(),
      lateWindowUntil: schedule.lateWindowUntil.toISOString(),
      drawAt: schedule.drawAt.toISOString(),
      attendanceDeadlineAt: schedule.attendanceDeadlineAt.toISOString(),
      tournamentStartAt: schedule.tournamentStartAt.toISOString(),
      resetAt: schedule.resetAt.toISOString(),
    };
    for (const [field, value] of Object.entries(scheduleValues)) {
      if (event.schedule[field] !== value) {
        event.schedule[field] = value;
        changed = true;
      }
    }

    if (event.meta.eventMode !== 'bomber_x_loco') {
      event.meta.eventMode = 'bomber_x_loco';
      changed = true;
    }
    if (JSON.stringify(event.format.allowedSizes || []) !== JSON.stringify(BOMBER_X_LOCO_FORMAT_SIZES)) {
      event.format.allowedSizes = [...BOMBER_X_LOCO_FORMAT_SIZES];
      changed = true;
    }
    if (Number(event.format.minimumRealTeams) !== 6) {
      event.format.minimumRealTeams = 6;
      changed = true;
    }

    // Der Sonder-Check-in ist bereits vor dem Eventtag nutzbar. Bestehende Einträge
    // werden ausdrücklich beibehalten; wir pinnen nur Datum/Modus/Zeiten.
    if (!['checkin', 'checkin_open', 'deadline_reached', 'checkin_closed', 'draw_ready', 'groups', 'groups_running'].includes(event.status)) {
      event.status = 'checkin_open';
      changed = true;
    }
    if (now.getTime() < schedule.deadlineAt.getTime() && event.checkin.isOpen !== true) {
      event.checkin.isOpen = true;
      changed = true;
    }

    if (changed) event.meta.updatedAt = nowIso();
    return event;
  });

  if (changed) console.log('[checkin] Saturday event pinned to Bomber X Loco 2026-09-19');
  return changed;
}

function getBomberPanelState() {
  const messages = readJson(FILES.messages, createMessagesDefault());
  return messages.checkins?.saturday || {};
}

async function deleteOldBomberPanels(client) {
  const state = getBomberPanelState();
  const channel = await client.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  if (!channel?.messages) return;

  const ids = [...new Set([
    OLD_BOMBER_CHECKIN_MESSAGE_ID,
    state.specialMainMessageId,
  ].filter(Boolean).map(String))];

  for (const messageId of ids) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) await message.delete().catch(error => {
      console.warn(`[checkin] Alter Bomber-Check-in ${messageId} konnte nicht gelöscht werden: ${error.message}`);
    });
  }

  const timestamp = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.checkins = current.checkins || {};
    current.checkins.saturday = current.checkins.saturday || {};
    current.checkins.saturday.specialChannelId = BOMBER_X_LOCO_CHECKIN_CHANNEL_ID;
    current.checkins.saturday.specialMainMessageId = null;
    current.checkins.saturday.updatedAt = timestamp;
    current.meta = { ...(current.meta || {}), updatedAt: timestamp };
    return current;
  });
}

function markBomberRepostComplete(messageId) {
  const timestamp = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.meta = {
      ...(current.meta || {}),
      updatedAt: timestamp,
      [BOMBER_REPOST_MARKER]: timestamp,
    };
    current.checkins = current.checkins || {};
    current.checkins.saturday = current.checkins.saturday || {};
    current.checkins.saturday.specialChannelId = BOMBER_X_LOCO_CHECKIN_CHANNEL_ID;
    current.checkins.saturday.specialMainMessageId = String(messageId);
    current.checkins.saturday.updatedAt = timestamp;
    return current;
  });
}

async function recreateBomberCheckinOnce(client) {
  const messages = readJson(FILES.messages, createMessagesDefault());
  if (messages.meta?.[BOMBER_REPOST_MARKER]) return false;

  // Der Sonder-Cup muss vor jedem allgemeinen Saturday-Reconcile auf den 19.09.
  // gepinnt sein. Sonst würde der rollierende Wochenzyklus am 04.09. den 05.09.
  // wählen und den Eventmodus wieder auf night_cup setzen.
  pinBomberEventCycle(new Date());
  await deleteOldBomberPanels(client);

  await reconcileCheckinEvent('saturday', client, new Date());
  pinBomberEventCycle(new Date());

  const refreshed = await refreshCheckinMessage('saturday', client);
  const stateAfter = getBomberPanelState();
  const newMessageId = stateAfter.specialMainMessageId;

  if (!refreshed || !newMessageId) {
    throw new Error('Frischer Bomber-X-Loco-Check-in konnte nicht erstellt werden.');
  }

  const channel = await client.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  const createdMessage = channel?.messages
    ? await channel.messages.fetch(String(newMessageId)).catch(() => null)
    : null;
  if (!createdMessage) {
    throw new Error(`Neuer Bomber-X-Loco-Check-in ${newMessageId} wurde nach dem Erstellen nicht gefunden.`);
  }

  markBomberRepostComplete(newMessageId);
  console.log(`[checkin] Frischer Bomber-X-Loco-Check-in erstellt: ${newMessageId}`);
  return true;
}

async function init(client) {
  pinBomberEventCycle(new Date());
  await recreateBomberCheckinOnce(client).catch(error => {
    console.error(`[checkin] Bomber-X-Loco-Neupost fehlgeschlagen: ${error.message}`);
  });
  pinBomberEventCycle(new Date());
  await ensureAllCheckinMessages(client);
  scheduleManualDrawPreparation(client);
  startCheckinReconcile(client);
}

async function handleInteraction(interaction, client) {
  return handleNormalInteraction(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
  startCheckinReconcile,
};
