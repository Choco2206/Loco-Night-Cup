'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault } = require('../../storage/defaults');
const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile } = require('./checkin-reconcile');
const { scheduleManualDrawPreparation } = require('./bomber-x-loco-manual-draw');
const { BOMBER_X_LOCO_CHECKIN_CHANNEL_ID } = require('../events/bomber-x-loco-config');

const OLD_BOMBER_CHECKIN_MESSAGE_ID = '1542840384520978503';
const BOMBER_REPOST_MARKER = 'bomberFreshCheckinRepost20260904At';

async function recreateBomberCheckinOnce(client) {
  const messages = readJson(FILES.messages, createMessagesDefault());
  if (messages.meta?.[BOMBER_REPOST_MARKER]) return false;

  const state = messages.checkins?.saturday || {};
  const channel = await client.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  if (channel?.messages) {
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
  }

  const timestamp = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.checkins = current.checkins || {};
    current.checkins.saturday = current.checkins.saturday || {};
    current.checkins.saturday.specialChannelId = BOMBER_X_LOCO_CHECKIN_CHANNEL_ID;
    current.checkins.saturday.specialMainMessageId = null;
    current.checkins.saturday.updatedAt = timestamp;
    current.meta = {
      ...(current.meta || {}),
      updatedAt: timestamp,
      [BOMBER_REPOST_MARKER]: timestamp,
    };
    return current;
  });

  console.log('[checkin] Alter Bomber-X-Loco-Check-in entfernt; frischer Post wird erstellt');
  return true;
}

async function init(client) {
  await recreateBomberCheckinOnce(client);
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
