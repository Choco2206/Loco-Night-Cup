'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { buildAdminPanelPayload } = require('./admin-components');

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function getAdminPanelState(messages) {
  messages.admin = messages.admin || {};
  messages.admin.panel = messages.admin.panel || {
    channelId: null,
    messageId: null,
    createdAt: null,
    updatedAt: null,
  };
  return messages.admin.panel;
}

async function ensureAdminPanel(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels?.adminPanelChannelId;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;

  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = getAdminPanelState(messages);
  const payload = buildAdminPanelPayload();

  let message = await fetchMessage(channel, state.messageId);
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }

  const timestamp = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    const currentState = getAdminPanelState(current);
    currentState.channelId = channel.id;
    currentState.messageId = message.id;
    currentState.updatedAt = timestamp;
    if (!currentState.createdAt) currentState.createdAt = timestamp;
    return current;
  });

  return true;
}

module.exports = {
  ensureAdminPanel,
};
