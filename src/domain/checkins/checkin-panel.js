'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { getPublicCheckinState } = require('./checkin-service');
const { buildCheckinMessagePayload } = require('./checkin-components');

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

async function refreshCheckinMessage(eventKey, client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels?.checkinChannelIds?.[eventKey];
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;

  const { event } = getPublicCheckinState(eventKey);
  const payload = buildCheckinMessagePayload(eventKey, event, settings);
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = getMessageState(messages, eventKey);

  let message = await fetchMessage(channel, state.mainMessageId);
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
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
  for (const eventKey of uniqueKeys) {
    await refreshCheckinMessage(eventKey, client);
  }
}

async function ensureAllCheckinMessages(client) {
  await refreshCheckinMessages(EVENT_KEYS, client);
}

module.exports = {
  ensureAllCheckinMessages,
  refreshCheckinMessage,
  refreshCheckinMessages,
};
