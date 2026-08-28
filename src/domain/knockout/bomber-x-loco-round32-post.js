'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { findTeamById } = require('../teams/team-service');
const { getTeamUserIds } = require('../groups/group-roles');

const ROUND_KEY = 'round_of_32';
const CHANNEL_NAME = 'ko-sechzehntelfinale';
const RESULTS_CHANNEL_NAME = 'ergebnisse-sechzehntelfinale';

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function participantName(participant) {
  return participant?.displayName || (participant?.teamId ? findTeamById(participant.teamId)?.clubName : null) || 'TBD';
}

function roundUserIds(round) {
  const ids = [];
  for (const match of round?.matches || []) {
    for (const participant of [match.home, match.away]) {
      if (participant?.type !== 'team' || !participant.teamId) continue;
      ids.push(...getTeamUserIds(findTeamById(participant.teamId)));
    }
  }
  return unique(ids);
}

function permissionOverwrites(guild, userIds) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    },
    ...userIds.map(id => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];
}

async function ensureChannel(guild, parentId, name, existingId, userIds) {
  const existingById = existingId ? await guild.channels.fetch(existingId).catch(() => null) : null;
  const existingByName = guild.channels.cache.find(channel => channel.name === name && channel.type === ChannelType.GuildText);
  const channel = existingById?.isTextBased?.()
    ? existingById
    : existingByName || await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentId || undefined,
      permissionOverwrites: permissionOverwrites(guild, userIds),
      reason: 'Bomber X Loco Cup Sechzehntelfinale',
    });
  if (parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false }).catch(() => null);
  for (const overwrite of permissionOverwrites(guild, userIds)) {
    const options = overwrite.deny?.includes(PermissionFlagsBits.ViewChannel)
      ? { ViewChannel: false }
      : { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };
    await channel.permissionOverwrites.edit(overwrite.id, options).catch(() => null);
  }
  return channel;
}

function buildEmbed(round) {
  const lines = (round?.matches || []).flatMap(match => [
    `⚔️ **M${match.matchIndex}**`,
    `${participantName(match.home)} vs ${participantName(match.away)}`,
    match.result ? `✅ ${match.result.homeGoals}:${match.result.awayGoals}` : '⏳ Offen',
    '',
  ]);
  return new EmbedBuilder()
    .setColor(0xf2c94c)
    .setTitle('🏆 Sechzehntelfinale')
    .setDescription(lines.join('\n') || 'Noch keine Begegnungen vorhanden.');
}

function resultButtons(eventKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ko_result_open:${eventKey}:${ROUND_KEY}`).setLabel('Ergebnis eintragen').setEmoji('⚽').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ko_admin_result_open:${eventKey}:${ROUND_KEY}`).setLabel('Admin-Ergebnis').setEmoji('🛠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ko_replace_open:${eventKey}:${ROUND_KEY}`).setLabel('Team ersetzen').setStyle(ButtonStyle.Secondary),
  );
}

async function upsertMessage(channel, messageId, payload) {
  const old = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  return old ? old.edit(payload) : channel.send(payload);
}

async function upsertBomberRound32Post({ client, guild, eventKey, event }) {
  const round = event.knockout?.rounds?.[ROUND_KEY];
  if (!client || !round?.matches?.length || round.status === 'not_needed') return null;
  const targetGuild = guild || client.guilds.cache.first();
  if (!targetGuild) return null;

  const userIds = roundUserIds(round);
  const parentId = event.knockout?.categoryId || null;
  const channel = await ensureChannel(targetGuild, parentId, CHANNEL_NAME, round.channelId, userIds);
  const resultsChannel = await ensureChannel(targetGuild, parentId, RESULTS_CHANNEL_NAME, round.resultsChannelId, userIds);
  const mainMessage = await upsertMessage(channel, round.messageId, { embeds: [buildEmbed(round)], components: [] });
  const resultsMessage = await upsertMessage(resultsChannel, round.resultsMessageId, { embeds: [buildEmbed(round)], components: [resultButtons(eventKey)] });

  return {
    channelId: channel.id,
    messageId: mainMessage.id,
    resultsChannelId: resultsChannel.id,
    resultsMessageId: resultsMessage.id,
  };
}

module.exports = {
  upsertBomberRound32Post,
};
