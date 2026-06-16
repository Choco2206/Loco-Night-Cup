'use strict';

const { PermissionFlagsBits } = require('discord.js');

async function prepareGroupChannels({ client, event }) {
  if (!client) return { prepared: 0, skippedGroups: [] };

  let prepared = 0;
  const skippedGroups = [];

  for (const group of Object.values(event.groups?.groups || {})) {
    if (!group.channelId || !group.roleId) {
      skippedGroups.push(group.groupKey);
      continue;
    }

    const channel = await client.channels.fetch(group.channelId).catch(() => null);
    if (!channel?.permissionOverwrites) {
      skippedGroups.push(group.groupKey);
      continue;
    }

    await channel.permissionOverwrites.edit(group.roleId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    }).catch(() => null);

    prepared += 1;
  }

  return { prepared, skippedGroups };
}

module.exports = {
  prepareGroupChannels,
};
