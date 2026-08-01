'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { findTeamById } = require('../teams/team-service');
const { getGroupTeamIds, getTeamUserIds } = require('./group-roles');

function channelNameForGroup(groupKey) {
  return `gruppe-${String(groupKey).toLowerCase()}`;
}

function videoChannelNameForGroup(groupKey) {
  return `gruessenvideo-gruppe-${String(groupKey).toLowerCase()}`;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function getExistingRoleIds(guild, roleIds) {
  return uniqueStrings(roleIds).filter(roleId => guild.roles.cache.has(roleId));
}

function getGroupUserIds(group) {
  const ids = [];
  for (const teamId of getGroupTeamIds(group)) {
    ids.push(...getTeamUserIds(findTeamById(teamId)));
  }
  return uniqueStrings(ids);
}

function overwriteOptions(overwrite) {
  const options = {};
  for (const permission of overwrite.allow || []) {
    if (permission === PermissionFlagsBits.ViewChannel) options.ViewChannel = true;
    if (permission === PermissionFlagsBits.SendMessages) options.SendMessages = true;
    if (permission === PermissionFlagsBits.ReadMessageHistory) options.ReadMessageHistory = true;
    if (permission === PermissionFlagsBits.ManageChannels) options.ManageChannels = true;
    if (permission === PermissionFlagsBits.ManageMessages) options.ManageMessages = true;
    if (permission === PermissionFlagsBits.AttachFiles) options.AttachFiles = true;
    if (permission === PermissionFlagsBits.EmbedLinks) options.EmbedLinks = true;
  }
  for (const permission of overwrite.deny || []) {
    if (permission === PermissionFlagsBits.ViewChannel) options.ViewChannel = false;
  }
  return options;
}

function buildGroupChannelPermissionOverwrites({ guild, settings, roleId = null, userIds = [] }) {
  const adminRoleIds = getExistingRoleIds(guild, [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ]);

  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    ...adminRoleIds.map(id => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
    ...(roleId ? [{
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    }] : []),
    ...uniqueStrings(userIds).map(id => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];
}

async function applyGroupChannelPermissionOverwrites(channel, overwrites) {
  await channel.permissionOverwrites.set(overwrites);
}

async function ensureGroupChannel(guild, settings, group, userIds) {
  const configuredChannelId = settings.channels?.groupChannelIds?.[group.groupKey];
  const configuredChannel = configuredChannelId
    ? await guild.channels.fetch(configuredChannelId).catch(() => null)
    : null;

  const channelName = channelNameForGroup(group.groupKey);
  const existingChannel = guild.channels.cache.find(channel => (
    channel.name === channelName && channel.type === ChannelType.GuildText
  ));

  const permissionOverwrites = buildGroupChannelPermissionOverwrites({
    guild, settings, roleId: group.roleId, userIds,
  });

  const channel = configuredChannel?.isTextBased?.()
    ? configuredChannel
    : existingChannel;

  if (channel) {
    await applyGroupChannelPermissionOverwrites(channel, permissionOverwrites);
    return channel;
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: settings.categories?.groupCategoryId || undefined,
    permissionOverwrites,
    reason: 'Loco Night Cup Phase 5 Gruppenziehung',
  });
}

async function ensureGroupVideoChannel(guild, settings, group) {
  const configuredChannel = group.videoChannelId
    ? await guild.channels.fetch(group.videoChannelId).catch(() => null)
    : null;
  const channelName = videoChannelNameForGroup(group.groupKey);
  const existingChannel = guild.channels.cache.find(channel => (
    channel.name === channelName && channel.type === ChannelType.GuildText
  ));
  const permissionOverwrites = buildGroupChannelPermissionOverwrites({
    guild,
    settings,
    roleId: group.roleId,
    userIds: [],
  });
  const channel = configuredChannel?.isTextBased?.()
    ? configuredChannel
    : existingChannel;

  if (channel) {
    await applyGroupChannelPermissionOverwrites(channel, permissionOverwrites);
    return channel;
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: settings.categories?.groupCategoryId || undefined,
    permissionOverwrites,
    reason: 'Loco Night Cup Gruessenvideo-Kanal fuer Gruppe',
  });
}

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
  applyGroupChannelPermissionOverwrites,
  buildGroupChannelPermissionOverwrites,
  ensureGroupChannel,
  ensureGroupVideoChannel,
  getGroupUserIds,
  prepareGroupChannels,
};


