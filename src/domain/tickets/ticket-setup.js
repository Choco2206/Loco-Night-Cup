'use strict';

const fs = require('fs');
const path = require('path');
const {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault, createTicketsDefault } = require('../../storage/defaults');
const { buildPanelComponents, buildPanelEmbed } = require('./ticket-components');
const { readTicketStore, updateTicketStore } = require('./ticket-store');

const TICKET_MOD_ROLE_NAME = 'Ticket Mod';
const SUPPORT_CHANNEL_NAME = '🎫・ticket-support';
const LOG_CHANNEL_NAME = '📋・ticket-logs';
const BANNER_NAME = 'loco-night-cup-ticket-system.jpeg';

function ticketSettings(settings) {
  return settings.tickets || {};
}

async function configuredGuild(client, settings) {
  const guildId = settings.guild?.guildId;
  if (!guildId) throw new Error('Ticket-System: Server-ID ist nicht konfiguriert.');
  const guild = client.guilds.cache.get(String(guildId))
    || await client.guilds.fetch(String(guildId)).catch(() => null);
  if (!guild) throw new Error('Ticket-System: Konfigurierter Server wurde nicht gefunden.');
  return guild;
}

async function fetchRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(String(roleId)) || guild.roles.fetch(String(roleId)).catch(() => null);
}

async function ensureTicketModRole(guild, settings) {
  await guild.roles.fetch().catch(() => null);
  let role = await fetchRole(guild, settings.roles?.ticketModRoleId);
  if (!role) role = guild.roles.cache.find(item => item.name === TICKET_MOD_ROLE_NAME) || null;
  if (!role) {
    role = await guild.roles.create({
      name: TICKET_MOD_ROLE_NAME,
      color: 0x7b2cff,
      mentionable: false,
      permissions: [],
      reason: 'Loco Night Cup Ticket-System einrichten',
    });
  }
  if (settings.roles?.ticketModRoleId !== role.id) {
    updateJson(FILES.settings, createSettingsDefault(), current => {
      current.roles = current.roles || {};
      current.roles.ticketModRoleId = role.id;
      return current;
    });
    settings.roles = settings.roles || {};
    settings.roles.ticketModRoleId = role.id;
  }
  return role;
}

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(String(channelId)) || guild.channels.fetch(String(channelId)).catch(() => null);
}

function channelByName(guild, name, parentId) {
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText && channel.name === name && channel.parentId === String(parentId)
  ) || null;
}

function supportOverwrites(guild, settings, ticketModRole) {
  const botId = guild.members.me?.id || guild.client.user.id;
  const memberAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessagesInThreads,
  ];
  const memberDeny = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.MentionEveryone,
  ];
  const modAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.ManageThreads,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  const botAllow = [
    ...modAllow,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.MentionEveryone,
  ];
  const eligibleIds = [...new Set([
    settings.roles?.managerRoleId,
    settings.roles?.playerRoleId,
  ].filter(Boolean).map(String))];
  return [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.MentionEveryone,
      ],
    },
    ...eligibleIds.map(id => ({ id, allow: memberAllow, deny: memberDeny })),
    { id: ticketModRole.id, allow: modAllow, deny: [PermissionFlagsBits.MentionEveryone] },
    { id: botId, allow: botAllow },
  ];
}

function logOverwrites(guild, ticketModRole) {
  const botId = guild.members.me?.id || guild.client.user.id;
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: ticketModRole.id, allow, deny: [PermissionFlagsBits.MentionEveryone] },
    { id: botId, allow },
  ];
}

async function ensureTextChannel({ guild, settings, key, name, categoryId, overwrites }) {
  let channel = await fetchChannel(guild, settings.channels?.[key]);
  if (channel?.type !== ChannelType.GuildText) channel = null;
  if (!channel) channel = channelByName(guild, name, categoryId);
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites,
      reason: 'Loco Night Cup Ticket-System einrichten',
    });
  } else {
    if (channel.parentId !== String(categoryId)) {
      await channel.setParent(categoryId, { lockPermissions: false, reason: 'Ticket-System Kategorie synchronisieren' });
    }
    await channel.permissionOverwrites.set(overwrites, 'Ticket-System Rechte synchronisieren');
  }
  if (settings.channels?.[key] !== channel.id) {
    updateJson(FILES.settings, createSettingsDefault(), current => {
      current.channels = current.channels || {};
      current.channels[key] = channel.id;
      return current;
    });
    settings.channels = settings.channels || {};
    settings.channels[key] = channel.id;
  }
  return channel;
}

function panelPayload(settings) {
  const relativePath = ticketSettings(settings).bannerPath;
  const bannerPath = relativePath ? path.resolve(process.cwd(), relativePath) : null;
  const payload = {
    embeds: [buildPanelEmbed()],
    components: buildPanelComponents(),
    allowedMentions: { parse: [] },
  };
  if (bannerPath && fs.existsSync(bannerPath)) {
    const bannerEmbed = new EmbedBuilder()
      .setColor(0x7b2cff)
      .setImage(`attachment://${BANNER_NAME}`);
    payload.embeds = [bannerEmbed, buildPanelEmbed()];
    payload.attachments = [];
    payload.files = [new AttachmentBuilder(bannerPath, { name: BANNER_NAME })];
  }
  return payload;
}

async function ensurePanel(channel, settings) {
  const store = readTicketStore();
  const state = store.panel || {};
  let message = state.messageId ? await channel.messages.fetch(state.messageId).catch(() => null) : null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent?.find(candidate =>
      candidate.author?.id === channel.client.user.id
      && candidate.components?.some(row => row.components?.some(component => component.customId === 'ticket_category_select'))
    ) || null;
  }
  const payload = panelPayload(settings);
  if (message) message = await message.edit(payload);
  else message = await channel.send(payload);
  const timestamp = new Date().toISOString();
  updateTicketStore(current => {
    current.panel = {
      channelId: channel.id,
      messageId: message.id,
      createdAt: current.panel?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    return current;
  });
  return message;
}

async function ensureTicketSystem(client) {
  let settings = readJson(FILES.settings, createSettingsDefault());
  if (settings.tickets?.enabled === false) return false;
  const guild = await configuredGuild(client, settings);
  await guild.channels.fetch().catch(() => null);
  const categoryId = settings.tickets?.categoryId || settings.categories?.nightHubCategoryId;
  const category = await fetchChannel(guild, categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(`Ticket-System: Kategorie ${categoryId || 'nicht konfiguriert'} wurde nicht gefunden.`);
  }
  const managerRole = await fetchRole(guild, settings.roles?.managerRoleId);
  const playerRole = await fetchRole(guild, settings.roles?.playerRoleId);
  if (!managerRole || !playerRole) throw new Error('Ticket-System: Manager- oder Spielerrolle wurde nicht gefunden.');

  const ticketModRole = await ensureTicketModRole(guild, settings);
  settings = readJson(FILES.settings, createSettingsDefault());
  const supportChannel = await ensureTextChannel({
    guild,
    settings,
    key: 'ticketSupportChannelId',
    name: SUPPORT_CHANNEL_NAME,
    categoryId: category.id,
    overwrites: supportOverwrites(guild, settings, ticketModRole),
  });
  settings = readJson(FILES.settings, createSettingsDefault());
  const logChannel = await ensureTextChannel({
    guild,
    settings,
    key: 'ticketLogChannelId',
    name: LOG_CHANNEL_NAME,
    categoryId: category.id,
    overwrites: logOverwrites(guild, ticketModRole),
  });
  settings = readJson(FILES.settings, createSettingsDefault());
  await ensurePanel(supportChannel, settings);
  return { guild, ticketModRole, supportChannel, logChannel };
}

module.exports = {
  LOG_CHANNEL_NAME,
  SUPPORT_CHANNEL_NAME,
  TICKET_MOD_ROLE_NAME,
  ensureTicketSystem,
  logOverwrites,
  panelPayload,
  supportOverwrites,
};
