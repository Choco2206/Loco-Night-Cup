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
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { getConfiguredGuild, getTeamUserIds } = require('../groups/group-roles');
const { findTeamById } = require('../teams/team-service');
const { ROUND_LABELS } = require('./knockout-bracket');
const { buildRoundReleasePayload, getRoundReminderAt, isRoundReadyForRelease, ROUND_VIDEO_CHANNEL_NAMES } = require('./knockout-release');
const { renderKoImage } = require('../../../utils/ko-image-renderer');

const KNOCKOUT_CATEGORY_NAME = 'K.O.-Phase';
const KNOCKOUT_OVERVIEW_CHANNEL_NAME = 'ko-phase';
const ROUND_CHANNEL_NAMES = {
  round_of_16: 'ko-achtelfinale',
  quarter_final: 'ko-viertelfinale',
  semi_final: 'ko-halbfinale',
  third_place: 'ko-platz-3',
  final: 'ko-finale',
};
const ROUND_RESULTS_CHANNEL_NAMES = {
  round_of_16: 'ergebnisse-achtelfinale',
  quarter_final: 'ergebnisse-viertelfinale',
  semi_final: 'ergebnisse-halbfinale',
  third_place: 'ergebnisse-platz-3',
  final: 'ergebnisse-finale',
};
const ROUND_ROLE_NAMES = {
  round_of_16: 'LNC K.O. Achtelfinale',
  quarter_final: 'LNC K.O. Viertelfinale',
  semi_final: 'LNC K.O. Halbfinale',
  third_place: 'LNC K.O. Spiel um Platz 3',
  final: 'LNC K.O. Finale',
};
const ROUND_ORDER = ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];
const roundReminderTimers = new Map();
const STATUS_LABELS = {
  open: '⏳ Offen',
  pending_confirmation: '🕐 Wartet auf Bestätigung',
  admin_decision_required: '🚨 Admin-Klärung',
  locked: '🔒 Noch nicht bereit',
  not_needed: 'Nicht benötigt',
  completed: '✅ Abgeschlossen',
  confirmed: '✅ Bestätigt',
};
const DIVIDER = '━━━━━━━━━━━━━━';

function nowIso() {
  return new Date().toISOString();
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function getAdminRoleIds(guild, settings) {
  return uniqueStrings([
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ]).filter(roleId => guild.roles.cache.has(roleId));
}

function getTeamIdsFromParticipant(participant) {
  return participant?.type === 'team' && participant.teamId ? [String(participant.teamId)] : [];
}

function getRoundTeamUserIds(round) {
  const ids = [];
  for (const match of round?.matches || []) {
    for (const teamId of [...getTeamIdsFromParticipant(match.home), ...getTeamIdsFromParticipant(match.away)]) {
      ids.push(...getTeamUserIds(findTeamById(teamId)));
    }
  }
  return uniqueStrings(ids);
}

function roundRoleIds(settings) {
  return uniqueStrings(Object.values(settings.roles?.knockoutRoleIds || {}));
}

function getQualifiedUserIds(qualifiedTeams) {
  const ids = [];
  for (const qualified of qualifiedTeams || []) {
    ids.push(...getTeamUserIds(findTeamById(qualified.teamId)));
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

function baseOverwrites(guild, settings) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
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
    ...getAdminRoleIds(guild, settings).map(roleId => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];
}

function channelOverwrites(guild, settings, { userIds = [], roleIds = [], publicView = false } = {}) {
  if (publicView) {
    return [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      },
      ...baseOverwrites(guild, settings).filter(overwrite => String(overwrite.id) !== String(guild.roles.everyone.id)),
    ];
  }

  return [
    ...baseOverwrites(guild, settings),
    ...uniqueStrings(roleIds).map(roleId => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    })),
    ...uniqueStrings(userIds).map(userId => ({
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];
}

async function applyOverwrites(channel, overwrites) {
  if (!channel?.permissionOverwrites) return;
  for (const overwrite of overwrites) {
    await channel.permissionOverwrites.edit(overwrite.id, overwriteOptions(overwrite)).catch(() => null);
  }
}

async function pruneMemberOverwrites(channel, allowedUserIds = []) {
  if (!channel?.permissionOverwrites?.cache) return;
  const allowed = new Set(uniqueStrings(allowedUserIds));
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    const type = String(overwrite.type).toLowerCase();
    const isMemberOverwrite = overwrite.type === 1 || type === 'member';
    if (!isMemberOverwrite || allowed.has(String(overwrite.id))) continue;
    await channel.permissionOverwrites.delete(overwrite.id).catch(() => null);
  }
}

async function pruneKnockoutRoleOverwrites(channel, settings, allowedRoleIds = []) {
  if (!channel?.permissionOverwrites?.cache) return;
  const allowed = new Set(uniqueStrings(allowedRoleIds));
  const knockoutRoles = new Set(roundRoleIds(settings));
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    const type = String(overwrite.type).toLowerCase();
    const isRoleOverwrite = overwrite.type === 0 || type === 'role';
    if (!isRoleOverwrite || !knockoutRoles.has(String(overwrite.id)) || allowed.has(String(overwrite.id))) continue;
    await channel.permissionOverwrites.delete(overwrite.id).catch(() => null);
  }
}

async function ensureKnockoutCategory(guild, settings) {
  const configuredId = settings.categories?.knockoutCategoryId;
  const configured = configuredId ? await guild.channels.fetch(configuredId).catch(() => null) : null;
  const existing = guild.channels.cache.find(channel => (
    channel.name === KNOCKOUT_CATEGORY_NAME && channel.type === ChannelType.GuildCategory
  ));
  const category = configured?.type === ChannelType.GuildCategory
    ? configured
    : existing || await guild.channels.create({
      name: KNOCKOUT_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: baseOverwrites(guild, settings),
      reason: 'Loco Night Cup K.O.-Phase',
    });

  await applyOverwrites(category, baseOverwrites(guild, settings));

  const groupCategoryId = settings.categories?.groupCategoryId;
  const groupCategory = groupCategoryId ? await guild.channels.fetch(groupCategoryId).catch(() => null) : null;
  if (groupCategory?.type === ChannelType.GuildCategory && typeof category.setPosition === 'function') {
    await category.setPosition(groupCategory.position + 1).catch(() => null);
  }

  return category;
}

async function ensureKnockoutRole(guild, settings, roundKey) {
  const configuredRoleId = settings.roles?.knockoutRoleIds?.[roundKey];
  const configuredRole = configuredRoleId ? await guild.roles.fetch(configuredRoleId).catch(() => null) : null;
  if (configuredRole) return configuredRole;

  const name = ROUND_ROLE_NAMES[roundKey];
  const existingRole = guild.roles.cache.find(role => role.name === name);
  if (existingRole) return existingRole;

  return guild.roles.create({
    name,
    mentionable: false,
    reason: 'Loco Night Cup K.O.-Phase',
  });
}

async function syncKnockoutRoles(guild, settings, event) {
  const roleIds = {};
  const desiredUsersByRoleId = {};

  for (const roundKey of activeRoundKeys(event)) {
    const role = await ensureKnockoutRole(guild, settings, roundKey).catch(() => null);
    if (!role) continue;
    roleIds[roundKey] = role.id;
    desiredUsersByRoleId[role.id] = getRoundTeamUserIds(event.knockout?.rounds?.[roundKey]);
  }

  await guild.members.fetch().catch(() => null);
  for (const [roundKey, roleId] of Object.entries(roleIds)) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;
    const desired = new Set(desiredUsersByRoleId[roleId] || []);

    for (const userId of desired) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && !member.roles.cache.has(role.id)) {
        await member.roles.add(role.id, 'Loco Night Cup K.O.-Rollen-Sync').catch(() => null);
      }
    }

    for (const member of role.members.values()) {
      if (!desired.has(String(member.id))) {
        await member.roles.remove(role.id, 'Loco Night Cup K.O.-Rollen-Sync').catch(() => null);
      }
    }
  }

  return roleIds;
}

async function ensureTextChannel({ guild, settings, name, category, userIds = [], roleIds = [], existingChannelId = null, publicView = false }) {
  const configured = existingChannelId ? await guild.channels.fetch(existingChannelId).catch(() => null) : null;
  const existing = guild.channels.cache.find(channel => (
    channel.name === name && channel.type === ChannelType.GuildText
  ));
  const overwrites = channelOverwrites(guild, settings, { userIds, roleIds, publicView });
  const channel = configured?.isTextBased?.()
    ? configured
    : existing || await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category?.id || undefined,
      permissionOverwrites: overwrites,
      reason: 'Loco Night Cup K.O.-Phase',
    });

  if (category?.id && channel.parentId !== category.id && typeof channel.setParent === 'function') {
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => null);
  }
  await applyOverwrites(channel, overwrites);
  await pruneMemberOverwrites(channel, userIds);
  await pruneKnockoutRoleOverwrites(channel, settings, roleIds);
  return channel;
}

function activeRoundKeys(event) {
  const rounds = event.knockout?.rounds || {};
  return ROUND_ORDER.filter(roundKey => {
    const round = rounds[roundKey];
    return round?.matches?.length && round.status !== 'not_needed';
  });
}

function participantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'placeholder') return participant.displayName || 'TBD';
  if (participant.type === 'team') return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId;
  return participant.displayName || 'TBD';
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'Unbekannt';
}

function participantKey(participant) {
  if (!participant) return null;
  if (participant.participantKey) return participant.participantKey;
  if (participant.type === 'team') return `team:${participant.teamId}`;
  return null;
}

function waitingForLabel(match) {
  const reports = Array.isArray(match.reports) ? match.reports : [];
  const reported = new Set(reports.map(report => report.participantKey).filter(Boolean));
  const pending = [match.home, match.away]
    .filter(participant => participant?.type === 'team')
    .filter(participant => !reported.has(participantKey(participant)))
    .map(participantName);
  return pending.length ? `🕐 Wartet auf Bestätigung von ${pending.join(' & ')}` : statusLabel(match.status);
}

function formatMatchStatus(match) {
  if (match.status === 'pending_confirmation') return waitingForLabel(match);
  return statusLabel(match.status);
}

function resultLine(match) {
  if (!match.result) return null;
  return `Ergebnis: ${participantName(match.home)} ${match.result.homeGoals}:${match.result.awayGoals} ${participantName(match.away)}`;
}

function winnerLine(match) {
  if (!match.winner) return null;
  return `Sieger: ${participantName(match.winner)}`;
}

function buildRoundButtons(eventKey, roundKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ko_result_open:${eventKey}:${roundKey}`)
      .setLabel('Ergebnis eintragen')
      .setEmoji('⚽')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ko_admin_result_open:${eventKey}:${roundKey}`)
      .setLabel('Admin-Ergebnis')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ko_replace_open:${eventKey}:${roundKey}`)
      .setLabel('Team ersetzen')
      .setStyle(ButtonStyle.Secondary)
  );
}

function currentRoundLabel(event) {
  const roundKey = ['round_of_32', ...ROUND_ORDER].find(key => {
    const round = event.knockout?.rounds?.[key];
    return round?.matches?.length && ['open', 'pending_confirmation', 'admin_decision_required'].includes(round.status);
  });
  if (!roundKey) {
    if (event.knockout?.status === 'completed') return 'K.O.-Phase abgeschlossen';
    return 'Noch keine aktive Runde';
  }
  return `${ROUND_LABELS[roundKey] || roundKey} läuft`;
}

function channelLines(event) {
  const lines = [];
  const roundKeys = ['round_of_32', ...activeRoundKeys(event)]
    .filter((roundKey, index, keys) => keys.indexOf(roundKey) === index)
    .filter(roundKey => {
      const round = event.knockout?.rounds?.[roundKey];
      return round?.matches?.length && round.status !== 'not_needed';
    });
  for (const roundKey of roundKeys) {
    const channelId = event.knockout?.rounds?.[roundKey]?.channelId;
    lines.push(`• ${ROUND_LABELS[roundKey] || roundKey}: ${channelId ? `<#${channelId}>` : 'wird vorbereitet'}`);
  }
  return lines.join('\n') || 'Noch keine K.O.-Kanäle vorbereitet.';
}

function buildRoundEmbed(eventKey, event, roundKey) {
  const round = event.knockout?.rounds?.[roundKey];
  const label = ROUND_LABELS[roundKey] || roundKey;
  const lines = [];

  for (const match of round?.matches || []) {
    lines.push(`⚔️ **M${match.matchIndex}**`);
    lines.push(`${participantName(match.home)} vs ${participantName(match.away)}`);
    lines.push(`Status: ${formatMatchStatus(match)}`);
    const result = resultLine(match);
    if (result) lines.push(result);
    const winner = winnerLine(match);
    if (winner) lines.push(winner);
    lines.push('');
  }

  if (!lines.length) lines.push('Diese Runde wird in diesem Format nicht benötigt.');

  return new EmbedBuilder()
    .setTitle(`🏆 ${label}`)
    .setColor(roundKey === event.knockout?.firstRoundKey ? 0xf2c94c : 0x5865f2)
    .setDescription([
      DIVIDER,
      lines.join('\n').trim(),
      DIVIDER,
    ].join('\n\n'))
    .addFields({
      name: 'Hinweis',
      value: [
        '⚠️ Beide Teams müssen das Ergebnis eintragen.',
        '⚠️ In der K.O.-Phase muss ein Sieger feststehen.',
        'Spielt bei Gleichstand Verlängerung und Elfmeterschiessen, bis ein Gewinner feststeht.',
      ].join('\n'),
      inline: false,
    })
    .setFooter({ text: `${event.label || eventKey} · K.O.-Phase` })
    .setTimestamp(new Date());
}

function buildOverviewEmbed(eventKey, event) {
  const knockout = event.knockout || {};
  const qualified = (knockout.qualifiedTeams || [])
    .map(team => `${team.seed}. ${team.displayName}`)
    .join('\n') || 'Keine qualifizierten Teams gefunden.';

  return new EmbedBuilder()
    .setTitle('🏆 K.O.-Phase Übersicht')
    .setColor(0xf2c94c)
    .setDescription([
      `**Event:** ${event.label || eventKey}`,
      `**Format:** ${event.format?.size || '-'}er Turnier`,
      `**Status:** ${knockout.status === 'completed' ? 'Abgeschlossen' : 'Aktiv'}`,
      '',
      DIVIDER,
      '',
      '🎟️ **Qualifizierte Teams**',
      qualified.slice(0, 900),
      '',
      DIVIDER,
      '',
      '⚔️ **Aktuelle Runde**',
      currentRoundLabel(event),
      '',
      '📍 **Kanäle**',
      channelLines(event),
    ].join('\n'))
    .setTimestamp(new Date());
}

function roundStatusContent(round) {
  const lines = [];
  for (const match of round?.matches || []) {
    if (match.status === 'pending_confirmation') lines.push(`M${match.matchIndex}: ${waitingForLabel(match)}`);
    if (match.status === 'admin_decision_required') lines.push(`M${match.matchIndex}: Admin-Klärung erforderlich`);
  }
  return lines.length ? lines.join('\n') : null;
}

async function buildOverviewImagePayload(eventKey, event) {
  const qualifiedTeams = event.knockout?.qualifiedTeams || [];
  const image = await renderKoImage({
    phase: 'qualification_overview',
    qualifiedTeams,
    eventId: event.cycle?.cycleKey || eventKey,
  });
  return {
    content: null,
    embeds: [new EmbedBuilder()
      .setTitle('K.O.-Phase Übersicht')
      .setDescription(`Aktuelle Runde: **${currentRoundLabel(event)}**\n${channelLines(event)}`)
      .setImage(`attachment://${image.fileName}`)
      .setColor(0xf2c94c)],
    attachments: [],
    files: [{ attachment: image.buffer, name: image.fileName }],
    allowedMentions: { parse: [] },
  };
}

async function buildRoundImagePayload(eventKey, event, roundKey, { includeButtons = true } = {}) {
  const round = event.knockout?.rounds?.[roundKey];
  const image = await renderKoImage({
    phase: roundKey,
    matches: round?.matches || [],
    eventId: event.cycle?.cycleKey || eventKey,
  });
  return {
    content: roundStatusContent(round),
    embeds: [new EmbedBuilder()
      .setTitle(ROUND_LABELS[roundKey] || roundKey)
      .setImage(`attachment://${image.fileName}`)
      .setColor(roundKey === event.knockout?.firstRoundKey ? 0xf2c94c : 0x5865f2)],
    attachments: [],
    files: [{ attachment: image.buffer, name: image.fileName }],
    components: includeButtons ? [buildRoundButtons(eventKey, roundKey)] : [],
    allowedMentions: { parse: [] },
  };
}

async function upsertMessage(channel, messageId, payload) {
  const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  return existing ? existing.edit(payload) : channel.send(payload);
}

function updateGeneratedSettings({ categoryId, roundChannels, roundRoles }) {
  updateJson(FILES.settings, createSettingsDefault(), settings => {
    settings.categories = settings.categories || {};
    settings.categories.knockoutCategoryId = categoryId || settings.categories.knockoutCategoryId || null;
    settings.roles = settings.roles || {};
    settings.roles.knockoutRoleIds = settings.roles.knockoutRoleIds || {};
    for (const [roundKey, roleId] of Object.entries(roundRoles || {})) {
      if (roleId) settings.roles.knockoutRoleIds[roundKey] = roleId;
    }
    settings.channels = settings.channels || {};
    settings.channels.knockoutChannelIds = settings.channels.knockoutChannelIds || {};
    for (const [roundKey, channelId] of Object.entries(roundChannels || {})) {
      if (channelId) settings.channels.knockoutChannelIds[roundKey] = channelId;
    }
    settings.meta = { ...(settings.meta || {}), updatedAt: nowIso() };
    return settings;
  });
}

function isTeamParticipant(participant) {
  return participant?.type === 'team' && participant.teamId;
}

function readRoundMessageState(eventKey, roundKey) {
  const messages = readJson(FILES.messages, createMessagesDefault());
  return messages.knockout?.[eventKey]?.rounds?.[roundKey] || {};
}

function updateRoundMessageState(eventKey, roundKey, updater) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    messages.knockout = messages.knockout || {};
    messages.knockout[eventKey] = messages.knockout[eventKey] || { cycleKey: null, rounds: {} };
    messages.knockout[eventKey].rounds = messages.knockout[eventKey].rounds || {};
    const current = messages.knockout[eventKey].rounds[roundKey] || {};
    messages.knockout[eventKey].rounds[roundKey] = updater(current);
    messages.meta = { ...(messages.meta || {}), updatedAt: nowIso() };
    return messages;
  });
}

async function ensureRoundReleaseMessage({ channel, event, eventKey, roundKey, round, roleId = null }) {
  if (!isRoundReadyForRelease(event, roundKey)) return null;
  const state = readRoundMessageState(eventKey, roundKey);
  if (state.releaseMessageId) {
    const existing = await channel.messages.fetch(state.releaseMessageId).catch(() => null);
    if (existing) {
      scheduleRoundReminder({ channel, eventKey, roundKey });
      return existing.id;
    }
  }

  const storedReleaseAt = state.releasedAt ? new Date(state.releasedAt) : null;
  const releasedAt = storedReleaseAt && !Number.isNaN(storedReleaseAt.getTime()) ? storedReleaseAt : new Date();
  const label = ROUND_LABELS[roundKey] || roundKey;
  const message = await channel.send(buildRoundReleasePayload({ label, releasedAt, roleId }));

  updateRoundMessageState(eventKey, roundKey, current => ({
    ...current,
    releaseMessageId: message.id,
    releasedAt: releasedAt.toISOString(),
    reminderAt: getRoundReminderAt(releasedAt).toISOString(),
    reminderSentAt: null,
    updatedAt: nowIso(),
  }));
  scheduleRoundReminder({ channel, eventKey, roundKey });
  return message.id;
}

function reminderTimerKey(eventKey, roundKey) {
  return `${eventKey}:${roundKey}`;
}

function hasOpenRoundMatches(round) {
  return (round?.matches || []).some(match => (
    isTeamParticipant(match.home)
    && isTeamParticipant(match.away)
    && ['open', 'pending_confirmation'].includes(match.status)
  ));
}

async function postRoundReminder({ channel, eventKey, roundKey }) {
  const event = readEventData(eventKey);
  const round = event.knockout?.rounds?.[roundKey];
  const state = readRoundMessageState(eventKey, roundKey);
  if (!round || state.reminderSentAt || !hasOpenRoundMatches(round)) return null;

  const label = ROUND_LABELS[roundKey] || roundKey;
  const message = await channel.send({
    content: `⏰ **${label}: Bitte tragt eure Ergebnisse ein bzw. bestätigt offene Meldungen.**`,
    allowedMentions: { parse: [] },
  });
  updateRoundMessageState(eventKey, roundKey, current => ({
    ...current,
    reminderMessageIds: [...new Set([...(current.reminderMessageIds || []), message.id])],
    reminderSentAt: nowIso(),
    updatedAt: nowIso(),
  }));
  return message.id;
}

function scheduleRoundReminder({ channel, eventKey, roundKey }) {
  const key = reminderTimerKey(eventKey, roundKey);
  const existing = roundReminderTimers.get(key);
  if (existing) clearTimeout(existing);
  roundReminderTimers.delete(key);

  const state = readRoundMessageState(eventKey, roundKey);
  if (!state.releasedAt || state.reminderSentAt) return null;
  const reminderAt = state.reminderAt
    ? new Date(state.reminderAt)
    : getRoundReminderAt(new Date(state.releasedAt));
  if (Number.isNaN(reminderAt.getTime())) return null;

  const timer = setTimeout(() => {
    roundReminderTimers.delete(key);
    postRoundReminder({ channel, eventKey, roundKey }).catch(error => {
      console.error(`K.O.-Ergebnisreminder für ${eventKey} ${roundKey} fehlgeschlagen:`, error);
    });
  }, Math.max(0, reminderAt.getTime() - Date.now()));
  if (typeof timer.unref === 'function') timer.unref();
  roundReminderTimers.set(key, timer);
  return timer;
}

function updateKnockoutMessageState({ eventKey, event, categoryId, overview, roundPosts }) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    const timestamp = nowIso();
    messages.knockout = messages.knockout || {};
    messages.knockout[eventKey] = messages.knockout[eventKey] || { cycleKey: null, rounds: {} };
    messages.knockout[eventKey].cycleKey = event.cycle?.cycleKey || null;
    messages.knockout[eventKey].categoryId = categoryId || null;
    messages.knockout[eventKey].channelId = overview?.channelId || null;
    messages.knockout[eventKey].messageId = overview?.messageId || null;
    messages.knockout[eventKey].updatedAt = timestamp;
    messages.knockout[eventKey].rounds = messages.knockout[eventKey].rounds || {};

    for (const roundKey of ROUND_ORDER) {
      const previous = messages.knockout[eventKey].rounds[roundKey] || {};
      const post = roundPosts[roundKey] || {};
      messages.knockout[eventKey].rounds[roundKey] = {
        channelId: post.channelId || previous.channelId || null,
        videoChannelId: post.videoChannelId || previous.videoChannelId || null,
        messageId: post.messageId || previous.messageId || null,
        resultsChannelId: post.resultsChannelId || previous.resultsChannelId || null,
        resultsMessageId: post.resultsMessageId || previous.resultsMessageId || null,
        releaseMessageId: previous.releaseMessageId || null,
        releasedAt: previous.releasedAt || null,
        reminderAt: previous.reminderAt || null,
        reminderSentAt: previous.reminderSentAt || null,
        reminderMessageIds: Array.isArray(previous.reminderMessageIds) ? previous.reminderMessageIds : [],
        createdAt: previous.createdAt || timestamp,
        updatedAt: post.messageId ? timestamp : previous.updatedAt || null,
      };
    }

    messages.meta = { ...(messages.meta || {}), updatedAt: timestamp };
    return messages;
  });
}

async function upsertKnockoutPost({ client, guild = null, eventKey, event }) {
  if (!client) return null;
  const settings = readSettings();
  const targetGuild = guild || await getConfiguredGuild(client, settings);
  if (!targetGuild) return null;

  const category = await ensureKnockoutCategory(targetGuild, settings);
  const roundRoles = await syncKnockoutRoles(targetGuild, settings, event);
  const overviewChannel = await ensureTextChannel({
    guild: targetGuild,
    settings,
    name: KNOCKOUT_OVERVIEW_CHANNEL_NAME,
    category,
    roleIds: uniqueStrings(Object.values(roundRoles)),
    existingChannelId: event.knockout?.overviewChannelId || event.knockout?.channelId || null,
  });
  const overviewMessageId = event.knockout?.overviewMessageId || event.knockout?.messageId || null;
  let overviewMessage;
  try {
    overviewMessage = await upsertMessage(overviewChannel, overviewMessageId, await buildOverviewImagePayload(eventKey, event));
  } catch (error) {
    console.error('[KO IMAGE ERROR]', {
      phase: 'qualification_overview', eventId: eventKey,
      qualifiedTeamCount: event.knockout?.qualifiedTeams?.length || 0, error: error.message,
    });
    overviewMessage = await upsertMessage(overviewChannel, overviewMessageId, {
      content: null, embeds: [buildOverviewEmbed(eventKey, event)], attachments: [], allowedMentions: { parse: [] },
    });
  }

  const roundPosts = {};
  const roundChannels = {};
  const roundChannelObjects = {};
  for (const roundKey of activeRoundKeys(event)) {
    const round = event.knockout.rounds[roundKey];
    const channel = await ensureTextChannel({
      guild: targetGuild,
      settings,
      name: ROUND_CHANNEL_NAMES[roundKey],
      category,
      roleIds: roundRoles[roundKey] ? [roundRoles[roundKey]] : [],
      existingChannelId: round.channelId || null,
    });
    const videoChannel = await ensureTextChannel({
      guild: targetGuild,
      settings,
      name: ROUND_VIDEO_CHANNEL_NAMES[roundKey],
      category,
      roleIds: roundRoles[roundKey] ? [roundRoles[roundKey]] : [],
      existingChannelId: round.videoChannelId || null,
    });
    const resultsChannel = await ensureTextChannel({
      guild: targetGuild,
      settings,
      name: ROUND_RESULTS_CHANNEL_NAMES[roundKey],
      category,
      roleIds: roundRoles[roundKey] ? [roundRoles[roundKey]] : [],
      existingChannelId: round.resultsChannelId || null,
    });
    let message;
    try {
      message = await upsertMessage(channel, round.messageId || null, await buildRoundImagePayload(eventKey, event, roundKey, { includeButtons: false }));
    } catch (error) {
      console.error('[KO IMAGE ERROR]', {
        phase: roundKey, eventId: eventKey, template: ROUND_CHANNEL_NAMES[roundKey], error: error.message,
      });
      message = await upsertMessage(channel, round.messageId || null, {
        content: null,
        embeds: [buildRoundEmbed(eventKey, event, roundKey)],
        attachments: [],
        components: [],
        allowedMentions: { parse: [] },
      });
    }
    let resultsMessage;
    try {
      resultsMessage = await upsertMessage(resultsChannel, round.resultsMessageId || null, await buildRoundImagePayload(eventKey, event, roundKey));
    } catch (error) {
      resultsMessage = await upsertMessage(resultsChannel, round.resultsMessageId || null, {
        content: null, embeds: [buildRoundEmbed(eventKey, event, roundKey)], attachments: [],
        components: [buildRoundButtons(eventKey, roundKey)], allowedMentions: { parse: [] },
      });
    }
    roundPosts[roundKey] = {
      channelId: channel.id, videoChannelId: videoChannel.id, messageId: message.id,
      resultsChannelId: resultsChannel.id, resultsMessageId: resultsMessage.id,
    };
    roundChannels[roundKey] = channel.id;
    roundChannelObjects[roundKey] = channel;
  }

  updateGeneratedSettings({ categoryId: category.id, roundChannels, roundRoles });
  updateKnockoutMessageState({
    eventKey,
    event,
    categoryId: category.id,
    overview: { channelId: overviewChannel.id, messageId: overviewMessage.id },
    roundPosts,
  });
  updateEventData(eventKey, current => {
    if (!current.knockout) return current;
    current.knockout.categoryId = category.id;
    current.knockout.overviewChannelId = overviewChannel.id;
    current.knockout.overviewMessageId = overviewMessage.id;
    for (const [roundKey, refs] of Object.entries(roundPosts)) {
      const round = current.knockout.rounds?.[roundKey];
      if (!round) continue;
      round.channelId = refs.channelId;
      round.videoChannelId = refs.videoChannelId;
      round.messageId = refs.messageId;
      round.resultsChannelId = refs.resultsChannelId;
      round.resultsMessageId = refs.resultsMessageId;
    }
    current.knockout.meta = { ...(current.knockout.meta || {}), updatedAt: nowIso() };
    current.meta = { ...(current.meta || {}), updatedAt: nowIso() };
    return current;
  });

  for (const roundKey of activeRoundKeys(event)) {
    const channel = roundChannelObjects[roundKey];
    if (!channel) continue;
    await ensureRoundReleaseMessage({
      channel,
      event,
      eventKey,
      roundKey,
      round: event.knockout.rounds[roundKey],
      roleId: roundRoles[roundKey] || null,
    });
  }

  return {
    categoryId: category.id,
    overviewChannelId: overviewChannel.id,
    overviewMessageId: overviewMessage.id,
    roundPosts,
  };
}

async function initKnockoutReleases(client) {
  if (!client) return;
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (!event.knockout?.rounds || ['not_created', 'completed'].includes(event.knockout.status)) continue;
    await upsertKnockoutPost({ client, eventKey, event }).catch(error => {
      console.error(`K.O.-Freigabe-Init für ${eventKey} fehlgeschlagen:`, error);
    });
  }
}

module.exports = {
  KNOCKOUT_CATEGORY_NAME,
  KNOCKOUT_OVERVIEW_CHANNEL_NAME,
  ROUND_CHANNEL_NAMES,
  ROUND_RESULTS_CHANNEL_NAMES,
  ROUND_VIDEO_CHANNEL_NAMES,
  ROUND_ROLE_NAMES,
  buildOverviewEmbed,
  buildRoundButtons,
  buildRoundEmbed,
  initKnockoutReleases,
  postRoundReminder,
  scheduleRoundReminder,
  upsertKnockoutPost,
};
