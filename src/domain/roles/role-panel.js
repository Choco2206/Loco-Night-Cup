'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { buildRoleSelectPayload } = require('./role-components');

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function getRolePanelState(messages) {
  messages.roles = messages.roles || {};
  messages.roles.roleSelectPanel = messages.roles.roleSelectPanel || {
    channelId: null,
    messageId: null,
    createdAt: null,
    updatedAt: null,
  };
  return messages.roles.roleSelectPanel;
}

async function ensureRolelessChannelVisibility(guild, settings) {
  const publicChannelIds = new Set(
    [
      settings.channels?.welcomeChannelId,
      settings.channels?.roleSelectChannelId,
    ]
      .filter(Boolean)
      .map(String)
  );

  const channels = await guild.channels.fetch();
  const everyoneRoleId = guild.roles.everyone.id;

  for (const channel of channels.values()) {
    if (!channel?.permissionOverwrites?.edit) continue;

    await channel.permissionOverwrites.edit(everyoneRoleId, {
      [PermissionFlagsBits.ViewChannel]: publicChannelIds.has(channel.id),
    });
  }
}

async function ensureRoleSelectPanel(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels?.roleSelectChannelId;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;

  await ensureRolelessChannelVisibility(channel.guild, settings);

  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = getRolePanelState(messages);
  const payload = buildRoleSelectPayload();

  let message = await fetchMessage(channel, state.messageId);
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }

  const timestamp = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    const currentState = getRolePanelState(current);
    currentState.channelId = channel.id;
    currentState.messageId = message.id;
    currentState.updatedAt = timestamp;
    if (!currentState.createdAt) currentState.createdAt = timestamp;

    current.roles.roleSelect = current.roles.roleSelect || {};
    current.roles.roleSelect.channelId = channel.id;
    current.roles.roleSelect.messageId = message.id;
    current.roles.roleSelect.updatedAt = timestamp;
    if (!current.roles.roleSelect.createdAt) current.roles.roleSelect.createdAt = timestamp;

    return current;
  });

  return true;
}

module.exports = {
  ensureRoleSelectPanel,
  ensureRolelessChannelVisibility,
};
