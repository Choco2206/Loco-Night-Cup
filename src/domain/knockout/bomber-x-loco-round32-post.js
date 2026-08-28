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
const { renderKoImage } = require('../../../utils/ko-image-renderer');

const ROUND_KEY = 'round_of_32';
const ROUND_ROLE_NAME = 'LNC K.O. Sechzehntelfinale';
const CHANNEL_NAME = 'ko-sechzehntelfinale';
const RESULTS_CHANNEL_NAME = 'ergebnisse-sechzehntelfinale';
const fingerprints = new Map();
let intervalRef = null;

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
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

async function ensureRoundRole(guild, userIds) {
  let role = guild.roles.cache.find(entry => entry.name === ROUND_ROLE_NAME) || null;
  if (!role) {
    role = await guild.roles.create({ name: ROUND_ROLE_NAME, mentionable: false, reason: 'Bomber X Loco Cup Sechzehntelfinale' });
  }
  await guild.members.fetch().catch(() => null);
  const desired = new Set(userIds.map(String));
  for (const userId of desired) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(role.id)) await member.roles.add(role.id, 'Bomber X Loco Cup Sechzehntelfinale').catch(() => null);
  }
  for (const member of role.members.values()) {
    if (!desired.has(String(member.id))) await member.roles.remove(role.id, 'Bomber X Loco Cup Sechzehntelfinale Rollen-Sync').catch(() => null);
  }
  return role;
}

function permissionOverwrites(guild, userIds, roleId = null) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ...(roleId ? [{ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] }] : []),
    ...userIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
  ];
}

async function ensureChannel(guild, parentId, name, existingId, userIds, roleId = null) {
  const existingById = existingId ? await guild.channels.fetch(existingId).catch(() => null) : null;
  const existingByName = guild.channels.cache.find(channel => channel.name === name && channel.type === ChannelType.GuildText);
  const channel = existingById?.isTextBased?.() ? existingById : existingByName || await guild.channels.create({
    name, type: ChannelType.GuildText, parent: parentId || undefined,
    permissionOverwrites: permissionOverwrites(guild, userIds, roleId), reason: 'Bomber X Loco Cup Sechzehntelfinale',
  });
  if (parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false }).catch(() => null);
  for (const overwrite of permissionOverwrites(guild, userIds, roleId)) {
    const options = overwrite.deny?.includes(PermissionFlagsBits.ViewChannel)
      ? { ViewChannel: false }
      : { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true };
    await channel.permissionOverwrites.edit(overwrite.id, options).catch(() => null);
  }
  return channel;
}

function resultButtons(eventKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ko_result_open:${eventKey}:${ROUND_KEY}`).setLabel('Ergebnis eintragen').setEmoji('⚽').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ko_admin_result_open:${eventKey}:${ROUND_KEY}`).setLabel('Admin-Ergebnis').setEmoji('🛠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ko_replace_open:${eventKey}:${ROUND_KEY}`).setLabel('Team ersetzen').setStyle(ButtonStyle.Secondary),
  );
}

async function buildImagePayload(event, round, { includeButtons = false, eventKey = 'saturday' } = {}) {
  const image = await renderKoImage({
    phase: ROUND_KEY,
    matches: round?.matches || [],
    eventId: event.cycle?.cycleKey || eventKey,
  });
  return {
    content: null,
    embeds: [new EmbedBuilder().setImage(`attachment://${image.fileName}`)],
    attachments: [],
    files: [{ attachment: image.buffer, name: image.fileName }],
    components: includeButtons ? [resultButtons(eventKey)] : [],
    allowedMentions: { parse: [] },
  };
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
  const role = await ensureRoundRole(targetGuild, userIds);
  const parentId = event.knockout?.categoryId || null;
  const channel = await ensureChannel(targetGuild, parentId, CHANNEL_NAME, round.channelId, userIds, role.id);
  const resultsChannel = await ensureChannel(targetGuild, parentId, RESULTS_CHANNEL_NAME, round.resultsChannelId, userIds, role.id);
  const mainMessage = await upsertMessage(channel, round.messageId, await buildImagePayload(event, round, { includeButtons: false, eventKey }));
  const resultsMessage = await upsertMessage(resultsChannel, round.resultsMessageId, await buildImagePayload(event, round, { includeButtons: true, eventKey }));

  return { roleId: role.id, channelId: channel.id, messageId: mainMessage.id, resultsChannelId: resultsChannel.id, resultsMessageId: resultsMessage.id };
}

async function refreshEvent(client, eventKey) {
  const event = readEventData(eventKey);
  if (!isBomberXLocoEvent(event)) { fingerprints.delete(eventKey); return false; }
  const fingerprint = roundFingerprint(event);
  if (!fingerprint || fingerprints.get(eventKey) === fingerprint) return false;
  const post = await upsertBomberRound32Post({ client, eventKey, event });
  if (!post) return false;
  updateEventData(eventKey, current => {
    const round = current.knockout?.rounds?.[ROUND_KEY];
    if (!round) return current;
    round.roleId = post.roleId || round.roleId || null;
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
  for (const eventKey of EVENT_KEYS) await refreshEvent(client, eventKey).catch(error => console.error(`[bomber-x-loco-round32] ${eventKey}:`, error));
  if (!intervalRef) {
    intervalRef = setInterval(() => {
      for (const eventKey of EVENT_KEYS) refreshEvent(client, eventKey).catch(error => console.error(`[bomber-x-loco-round32] ${eventKey}:`, error));
    }, 3000);
    if (typeof intervalRef.unref === 'function') intervalRef.unref();
  }
}

module.exports = { initBomberRound32Posts, upsertBomberRound32Post };
