'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { getPublicCheckinState } = require('./checkin-service');
const { buildCheckinMessagePayload } = require('./checkin-components');
const { getCheckinWindowState } = require('./checkin-schedule');
const { isBomberXLocoEvent } = require('../events/bomber-x-loco-config');
const {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  buildBomberXLocoPayload,
  buildSaturdayBlockerPayload,
} = require('./bomber-x-loco-checkin');

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function getMessageState(messages, eventKey) {
  messages.checkins = messages.checkins || {};
  messages.checkins[eventKey] = messages.checkins[eventKey] || {
    channelId: null,
    mainMessageId: null,
    specialChannelId: null,
    specialMainMessageId: null,
    teamsListMessageIds: [],
    waitlistMessageIds: [],
    warningMessageId: null,
    summaryMessageId: null,
    createdAt: null,
    updatedAt: null,
  };
  return messages.checkins[eventKey];
}

function createEditPayload(payload) {
  return { ...payload, attachments: [] };
}

async function deleteSummaryMessageIfOpen({ channel, state, eventKey, event, settings }) {
  if (!state.summaryMessageId) return false;
  const windowState = getCheckinWindowState(eventKey, event, settings);
  if (!windowState.canJoin || !['regular', 'manual_open'].includes(windowState.phase)) return false;
  const sameChannel = !state.channelId || String(state.channelId) === String(channel.id);
  const message = sameChannel ? await fetchMessage(channel, state.summaryMessageId) : null;
  if (message) await message.delete().catch(() => null);
  updateJson(FILES.messages, createMessagesDefault(), current => {
    getMessageState(current, eventKey).summaryMessageId = null;
    return current;
  });
  return true;
}

async function upsertMessage(channel, messageId, payload) {
  let message = await fetchMessage(channel, messageId);
  if (message) await message.edit(createEditPayload(payload));
  else message = await channel.send(payload);
  return message;
}

async function refreshBomberXLocoPanel({ eventKey, event, client, settings, state }) {
  const specialChannel = await client.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
  if (!specialChannel?.send) {
    console.warn(`[checkin-panel] ${eventKey}: Bomber X Loco channel not writable`);
    return false;
  }

  const specialMessage = await upsertMessage(specialChannel, state.specialMainMessageId, buildBomberXLocoPayload(event, settings));
  const normalChannelId = settings.channels?.checkinChannelIds?.[eventKey];
  if (normalChannelId) {
    const normalChannel = await client.channels.fetch(normalChannelId).catch(() => null);
    if (normalChannel?.send) {
      const blockerMessage = await upsertMessage(normalChannel, state.mainMessageId, buildSaturdayBlockerPayload());
      state.channelId = normalChannel.id;
      state.mainMessageId = blockerMessage.id;
    }
  }

  state.specialChannelId = specialChannel.id;
  state.specialMainMessageId = specialMessage.id;
  return true;
}

async function adoptBomberXLocoPanelMessage(message, client) {
  if (!message || String(message.channelId) !== String(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID)) return false;

  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = getMessageState(messages, 'saturday');
  const previousMessageId = state.specialMainMessageId;

  if (previousMessageId && String(previousMessageId) !== String(message.id)) {
    const channel = await client.channels.fetch(BOMBER_X_LOCO_CHECKIN_CHANNEL_ID).catch(() => null);
    const previousMessage = channel ? await fetchMessage(channel, previousMessageId) : null;
    if (previousMessage) await previousMessage.delete().catch(() => null);
  }

  const timestamp = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    const currentState = getMessageState(current, 'saturday');
    currentState.specialChannelId = String(message.channelId);
    currentState.specialMainMessageId = String(message.id);
    currentState.updatedAt = timestamp;
    if (!currentState.createdAt) currentState.createdAt = timestamp;
    return current;
  });

  const settings = readJson(FILES.settings, createSettingsDefault());
  const { event } = getPublicCheckinState('saturday');
  if (isBomberXLocoEvent(event)) {
    await message.edit(createEditPayload(buildBomberXLocoPayload(event, settings))).catch(() => null);
  }
  return true;
}

async function refreshCheckinMessage(eventKey, client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const { event } = getPublicCheckinState(eventKey);
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = getMessageState(messages, eventKey);

  if (isBomberXLocoEvent(event)) {
    const refreshed = await refreshBomberXLocoPanel({ eventKey, event, client, settings, state });
    if (!refreshed) return false;
    const timestamp = new Date().toISOString();
    updateJson(FILES.messages, createMessagesDefault(), current => {
      const currentState = getMessageState(current, eventKey);
      Object.assign(currentState, state, { updatedAt: timestamp });
      if (!currentState.createdAt) currentState.createdAt = timestamp;
      return current;
    });
    console.log(`[checkin-panel] ${eventKey}: Bomber X Loco special panel refreshed`);
    return true;
  }

  const channelId = settings.channels?.checkinChannelIds?.[eventKey];
  if (!channelId) {
    console.warn(`[checkin-panel] ${eventKey}: no check-in channel configured`);
    return false;
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;

  const payload = buildCheckinMessagePayload(eventKey, event, settings);
  await deleteSummaryMessageIfOpen({ channel, state, eventKey, event, settings });
  const hasStaleChannelRef = state.channelId && String(state.channelId) !== String(channel.id);
  const message = await upsertMessage(channel, hasStaleChannelRef ? null : state.mainMessageId, payload);

  const timestamp = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    const currentState = getMessageState(current, eventKey);
    currentState.channelId = channel.id;
    currentState.mainMessageId = message.id;
    currentState.updatedAt = timestamp;
    if (!currentState.createdAt) currentState.createdAt = timestamp;
    return current;
  });

  return true;
}

async function refreshCheckinMessages(eventKeys, client) {
  const uniqueKeys = [...new Set(eventKeys || [])].filter(eventKey => EVENT_KEYS.includes(eventKey));
  let refreshed = 0;
  for (const eventKey of uniqueKeys) if (await refreshCheckinMessage(eventKey, client)) refreshed += 1;
  console.log(`[checkin-panel] refreshed ${refreshed}/${uniqueKeys.length} check-in panels`);
  return refreshed;
}

async function ensureAllCheckinMessages(client) {
  await refreshCheckinMessages(EVENT_KEYS, client);
}

module.exports = {
  adoptBomberXLocoPanelMessage,
  ensureAllCheckinMessages,
  refreshCheckinMessage,
  refreshCheckinMessages,
};
