'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { getTeamUserIds } = require('../groups/group-roles');
const { isBomberXLocoEvent } = require('../events/bomber-x-loco-config');

const ROUND_KEY = 'round_of_32';
const CHANNEL_NAME = 'ko-sechzehntelfinale';
const RESULTS_CHANNEL_NAME = 'ergebnisse-sechzehntelfinale';
const fingerprints = new Map();
let intervalRef = null;

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
    match.result ? `✅ ${match.result.homeGoals}:${match.result.awayGoals}` : match.status === 'admin_decision_required' ? '🚨 Admin-Klärung' : match.status === 'pending_confirmation' ? '🕐 Wartet auf Bestätigung' : '⏳ Offen',
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

function roundFingerprint(event) {
  const round = event.knockout?.rounds?.[ROUND_KEY];
  if (!round?.matches?.length) return null;
  return JSON.stringify({
    cycleKey: event.cycle?.cycleKey || null,
    status: round.status,
    matches: round.matches.map(match => ({
      id: match.id,
      status: match.status,
      home: match.home?.teamId || match.home?.participantKey || null,
      away: match.away?.teamId || match.away?.participantKey || null,
      result: match.result ? [match.result.homeGoals, match.result.awayGoals] : null,
    })),
  });
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

async function refreshEvent(client, eventKey) {
  const event = readEventData(eventKey);
  if (!isBomberXLocoEvent(event)) {
    fingerprints.delete(eventKey);
    return false;
  }
  const fingerprint = roundFingerprint(event);
  if (!fingerprint) return false;
  if (fingerprints.get(eventKey) === fingerprint) return false;

  const post = await upsertBomberRound32Post({ client, eventKey, event });
  if (!post) return false;

  updateEventData(eventKey, current => {
    const round = current.knockout?.rounds?.[ROUND_KEY];
    if (!round) return current;
    round.channelId = post.channelId || round.channelId || null;
    round.messageId = post.messageId || round.messageId || null;
    round.resultsChannelId = post.resultsChannelId || round.resultsChannelId || null;
    round.resultsMessageId = post.resultsMessageId || round.resultsMessageId || null;
    current.knockout.meta = { ...(current.knockout.meta || {}), updatedAt: new Date().toISOString() };
    current.meta = { ...(current.meta || {}), updatedAt: new Date().toISOString() };
    return current;
  });

  fingerprints.set(eventKey, fingerprint);
  return true;
}

async function initBomberRound32Posts(client) {
  for (const eventKey of EVENT_KEYS) {
    await refreshEvent(client, eventKey).catch(error => console.error(`[bomber-x-loco-round32] ${eventKey}:`, error));
  }
  if (!intervalRef) {
    intervalRef = setInterval(() => {
      for (const eventKey of EVENT_KEYS) {
        refreshEvent(client, eventKey).catch(error => console.error(`[bomber-x-loco-round32] ${eventKey}:`, error));
      }
    }, 3000);
    if (typeof intervalRef.unref === 'function') intervalRef.unref();
  }
}

module.exports = {
  initBomberRound32Posts,
  upsertBomberRound32Post,
};
