'use strict';

const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { getConfiguredGuild, getTeamUserIds } = require('../groups/group-roles');
const { findTeamById } = require('../teams/team-service');
const { ROUND_LABELS } = require('./knockout-bracket');

const KNOCKOUT_CHANNEL_NAME = 'ko-phase';

function nowIso() {
  return new Date().toISOString();
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function getAdminRoleIds(guild, settings) {
  return [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ].filter(Boolean).map(String).filter(roleId => guild.roles.cache.has(roleId));
}

function getQualifiedUserIds(qualifiedTeams) {
  const ids = [];
  for (const qualified of qualifiedTeams || []) {
    ids.push(...getTeamUserIds(findTeamById(qualified.teamId)));
  }
  return [...new Set(ids.map(String))];
}

function overwriteForAllow(extra = {}) {
  return {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    ...extra,
  };
}

async function ensureKnockoutChannel({ client, guild, settings, event }) {
  const targetGuild = guild || await getConfiguredGuild(client, settings);
  if (!targetGuild) return null;

  const existingChannelId = event.knockout?.channelId || Object.values(event.knockout?.rounds || {})
    .map(round => round.channelId)
    .find(Boolean);
  const configuredChannel = existingChannelId
    ? await targetGuild.channels.fetch(existingChannelId).catch(() => null)
    : null;
  const existingByName = targetGuild.channels.cache.find(channel => (
    channel.name === KNOCKOUT_CHANNEL_NAME && channel.type === ChannelType.GuildText
  ));

  const channel = configuredChannel?.isTextBased?.() ? configuredChannel : existingByName;
  const adminRoleIds = getAdminRoleIds(targetGuild, settings);
  const qualifiedUserIds = getQualifiedUserIds(event.knockout?.qualifiedTeams || []);

  const permissionOverwrites = [
    {
      id: targetGuild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: targetGuild.client.user.id,
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
    ...adminRoleIds.map(roleId => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
    ...qualifiedUserIds.map(userId => ({
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];

  if (channel) {
    for (const overwrite of permissionOverwrites) {
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
      await channel.permissionOverwrites.edit(overwrite.id, options).catch(() => null);
    }
    return channel;
  }

  return targetGuild.channels.create({
    name: KNOCKOUT_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: settings.categories?.knockoutCategoryId || undefined,
    permissionOverwrites,
    reason: 'Loco Night Cup K.O.-Phase',
  });
}

function participantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'placeholder') return participant.displayName || 'TBD';
  if (participant.type === 'team') return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId;
  return participant.displayName || 'TBD';
}

function formatMatch(match) {
  const label = `${participantName(match.home)} vs ${participantName(match.away)}`;
  return `M${match.matchIndex}: ${label} (${match.status})`;
}

function formatRound(round) {
  if (!round?.matches?.length) return 'Nicht benoetigt';
  return round.matches.map(formatMatch).join('\n').slice(0, 1000);
}

function buildQualifiedText(qualifiedTeams) {
  return (qualifiedTeams || [])
    .map(team => `${team.seed}. ${team.displayName} (Gruppe ${team.groupKey}, Platz ${team.groupRank})`)
    .join('\n')
    .slice(0, 1000) || 'Keine qualifizierten Teams gefunden.';
}

function buildKnockoutEmbed(eventKey, event) {
  const knockout = event.knockout || {};
  const rounds = knockout.rounds || {};
  const embed = new EmbedBuilder()
    .setTitle('K.O.-Phase')
    .setColor(0xf2c94c)
    .setDescription([
      `Event: **${event.label || eventKey}**`,
      `Format: **${event.format?.size || '-'}er Turnier**`,
      `Status: **${knockout.status || 'not_created'}**`,
      `Qualifikation: **${knockout.source?.qualifiedRule || '-'}**`,
    ].join('\n'))
    .addFields({
      name: 'Qualifizierte Teams',
      value: buildQualifiedText(knockout.qualifiedTeams),
      inline: false,
    })
    .setTimestamp(new Date());

  for (const roundKey of ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final']) {
    const round = rounds[roundKey];
    embed.addFields({
      name: ROUND_LABELS[roundKey] || roundKey,
      value: formatRound(round),
      inline: false,
    });
  }

  return embed;
}

async function upsertKnockoutPost({ client, guild = null, eventKey, event }) {
  if (!client) return null;
  const settings = readSettings();
  const channel = await ensureKnockoutChannel({ client, guild, settings, event });
  if (!channel?.send) return null;

  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.knockout?.[eventKey] || {};
  const messageId = event.knockout?.messageId || state.messageId || Object.values(state.rounds || {})
    .map(round => round.messageId)
    .find(Boolean);
  const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  const payload = {
    embeds: [buildKnockoutEmbed(eventKey, event)],
    allowedMentions: { parse: [] },
  };

  const message = existing ? await existing.edit(payload) : await channel.send(payload);
  const timestamp = nowIso();

  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.knockout = current.knockout || {};
    current.knockout[eventKey] = current.knockout[eventKey] || { cycleKey: null, rounds: {} };
    current.knockout[eventKey].cycleKey = event.cycle?.cycleKey || null;
    current.knockout[eventKey].channelId = channel.id;
    current.knockout[eventKey].messageId = message.id;
    current.knockout[eventKey].updatedAt = timestamp;
    current.knockout[eventKey].rounds = current.knockout[eventKey].rounds || {};

    for (const roundKey of ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final']) {
      const previous = current.knockout[eventKey].rounds[roundKey] || {};
      current.knockout[eventKey].rounds[roundKey] = {
        channelId: channel.id,
        messageId: roundKey === event.knockout.firstRoundKey ? message.id : (previous.messageId || null),
        releaseMessageId: previous.releaseMessageId || null,
        reminderMessageIds: Array.isArray(previous.reminderMessageIds) ? previous.reminderMessageIds : [],
        createdAt: previous.createdAt || timestamp,
        updatedAt: timestamp,
      };
    }

    current.meta = { ...(current.meta || {}), updatedAt: timestamp };
    return current;
  });

  return { channelId: channel.id, messageId: message.id };
}

module.exports = {
  KNOCKOUT_CHANNEL_NAME,
  buildKnockoutEmbed,
  upsertKnockoutPost,
};
