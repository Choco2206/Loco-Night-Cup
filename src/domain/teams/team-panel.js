'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { buildTeamPanelPayload } = require('./team-components');

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function ensureTeamPanel(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels.teamRegistrationChannelId;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;

  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.teams.registrationPanel;
  const payload = buildTeamPanelPayload();

  let panel = await fetchMessage(channel, state.messageId);
  if (panel) {
    await panel.edit(payload);
  } else {
    panel = await channel.send(payload);
  }

  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.teams.registrationPanel.channelId = channel.id;
    current.teams.registrationPanel.messageId = panel.id;
    current.teams.registrationPanel.updatedAt = new Date().toISOString();
    if (!current.teams.registrationPanel.createdAt) {
      current.teams.registrationPanel.createdAt = new Date().toISOString();
    }
    return current;
  });

  return true;
}

module.exports = {
  ensureTeamPanel,
};
