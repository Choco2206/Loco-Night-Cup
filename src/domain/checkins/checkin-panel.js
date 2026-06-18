'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { getPublicCheckinState } = require('./checkin-service');
const { buildCheckinMessagePayload } = require('./checkin-components');
const { getCheckinWindowState } = require('./checkin-schedule');

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function getMessageState(messages, eventKey) {
  messages.checkins = messages.checkins || {};
  messages.checkins[eventKey] = messages.checkins[eventKey] || {
    channelId: null,
    mainMessageId: null,
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
  return {
    ...payload,
    attachments: [],
  };
}

async function deleteSummaryMessageIfOpen({ channel, state, eventKey, event, settings }) {
  if (!state.summaryMessageId) return false;
  const windowState = getCheckinWindowState(eventKey, event, settings);
  if (!windowState.canJoin || !['regular', 'manual_open'].includes(windowState.phase)) return false;

  const sameChannel = !state.channelId || String(state.channelId) === String(channel.id);
  const message = sameChannel ? await fetchMessage(channel, state.summaryMessageId) : null;
  if (message) {
    await message.delete().catch(error => {
      console.warn(`[checkin-panel] ${eventKey}: could not delete stale summary ${state.summaryMessageId}: ${error.message}`);
      return null;
    });
  }

  updateJson(FILES.messages, createMessagesDefault(), current => {
    const currentState = getMessageState(current, eventKey);
    currentState.summaryMessageId = null;
    currentState.updatedAt = new Date().toISOString();
    return current;
  });
  console.log(`[checkin-panel] ${eventKey}: removed stale summary message for open cycle`);
  return true;
}

async function refreshCheckinMessage(eventKey, client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels?.checkinChannelIds?.[eventKey];
  if (!channelId) {
    console.warn(`[checkin-panel] ${eventKey}: no check-in channel configured`);
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) {
    console.warn(`[checkin-panel] ${eventKey}: check-in channel ${channelId} not found or not writable`);
    return false;
  }

  const { event } = getPublicCheckinState(eventKey);
  const payload = buildCheckinMessagePayload(eventKey, event, settings);
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = getMessageState(messages, eventKey);
  const hasStaleChannelRef = state.channelId && String(state.channelId) !== String(channel.id);

  await deleteSummaryMessageIfOpen({ channel, state, eventKey, event, settings });

  let message = hasStaleChannelRef ? null : await fetchMessage(channel, state.mainMessageId);
  if (message) {
    await message.edit(createEditPayload(payload));
    console.log(`[checkin-panel] ${eventKey}: refreshed message ${message.id} in channel ${channel.id}`);
  } else {
    message = await channel.send(payload);
    console.log(`[checkin-panel] ${eventKey}: posted message ${message.id} in channel ${channel.id}`);
  }

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
  for (const eventKey of uniqueKeys) {
    if (await refreshCheckinMessage(eventKey, client)) refreshed += 1;
  }
  console.log(`[checkin-panel] refreshed ${refreshed}/${uniqueKeys.length} check-in panels`);
  return refreshed;
}

async function ensureAllCheckinMessages(client) {
  await refreshCheckinMessages(EVENT_KEYS, client);
}

module.exports = {
  ensureAllCheckinMessages,
  refreshCheckinMessage,
  refreshCheckinMessages,
};
