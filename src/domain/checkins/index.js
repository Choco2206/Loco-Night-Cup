'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault } = require('../../storage/defaults');
const { ensureAllCheckinMessages, refreshCheckinMessage } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile, reconcileCheckinEvent } = require('./checkin-reconcile');
const { scheduleManualDrawPreparation } = require('./bomber-x-loco-manual-draw');
const { BOMBER_X_LOCO_CHECKIN_CHANNEL_ID } = require('../events/bomber-x-loco-config');

const OLD_BOMBER_CHECKIN_MESSAGE_ID = '1542840384520978503';
const BOMBER_REPOST_MARKER = 'bomberFreshCheckinRepost20260904V2At';

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

  await deleteOldBomberPanels(client);

  // Erst den Samstag-Zyklus reparieren, damit der Event-State garantiert als
  // Bomber X Loco erkannt wird, bevor das spezielle Panel erzeugt wird.
  await reconcileCheckinEvent('saturday', client, new Date());

  // Den speziellen Post explizit erzeugen. Nicht darauf vertrauen, dass der
  // allgemeine ensureAll-Refresh ihn nebenbei anlegt.
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
  await recreateBomberCheckinOnce(client).catch(error => {
    console.error(`[checkin] Bomber-X-Loco-Neupost fehlgeschlagen: ${error.message}`);
  });
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
