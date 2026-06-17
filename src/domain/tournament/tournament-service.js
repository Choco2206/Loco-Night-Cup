'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { EVENT_LABELS, GROUP_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { getManualByes, getEntryTeamIds, recalculateCheckinFormat } = require('../checkins/checkin-format');
const { readEventData, updateEventData } = require('../checkins/checkin-repository');
const { findTeamById } = require('../teams/team-service');

const GROUP_SIZE = 4;
const MATCHDAY_PAIRINGS = [
  [[1, 2], [3, 4]],
  [[1, 3], [2, 4]],
  [[1, 4], [2, 3]],
];

function nowIso() {
  return new Date().toISOString();
}

function getSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function getAllowedSizes(settings, event) {
  return (settings.tournament?.allowedSizes || event.format?.allowedSizes || [8, 16, 24, 32])
    .map(Number)
    .filter(size => [8, 16, 24, 32].includes(size))
    .sort((a, b) => a - b);
}

function getParticipantDisplayName(participant) {
  if (participant.type === 'team') return findTeamById(participant.teamId)?.clubName || participant.displayName || participant.teamId;
  return participant.displayName || 'Freilos';
}

function getParticipantKey(participant) {
  return participant.type === 'team' ? `team:${participant.teamId}` : `bye:${participant.byeId}`;
}

function buildParticipantPool(event) {
  const teamIds = getEntryTeamIds(event);
  const teamParticipants = teamIds.map(teamId => {
    const team = findTeamById(teamId);
    return {
      type: 'team',
      teamId: String(teamId),
      displayName: team?.clubName || `Team ${teamId}`,
    };
  });

  const byeParticipants = getManualByes(event).map((bye, index) => ({
    type: 'bye',
    byeId: String(bye.id || `bye_${index + 1}`),
    displayName: bye.displayName || 'Freilos',
  }));

  return { teamIds, teamParticipants, byeParticipants };
}

function chooseLockSize({ participantSlotCount, allowedSizes, minimumParticipantSlots }) {
  if (participantSlotCount < minimumParticipantSlots) return null;
  let selected = null;
  for (const size of allowedSizes) {
    if (size <= participantSlotCount) selected = size;
  }
  return selected;
}

function buildFinalParticipants(event, size) {
  const { teamParticipants, byeParticipants } = buildParticipantPool(event);
  const selectedTeams = teamParticipants.slice(0, size);
  const remainingSlots = Math.max(0, size - selectedTeams.length);
  return [...selectedTeams, ...byeParticipants.slice(0, remainingSlots)];
}

function lockEventFormat(eventKey, actorUserId) {
  const settings = getSettings();
  let result;

  updateEventData(eventKey, event => {
    if (event.format?.lockedAt) {
      throw new Error(`${EVENT_LABELS[eventKey] || eventKey}: Das Format ist bereits gelockt.`);
    }

    recalculateCheckinFormat(event, settings);
    const { teamIds, byeParticipants } = buildParticipantPool(event);
    const participantSlotCount = teamIds.length + byeParticipants.length;
    const minimumParticipantSlots = Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
    const allowedSizes = getAllowedSizes(settings, event);
    const size = chooseLockSize({ participantSlotCount, allowedSizes, minimumParticipantSlots });

    if (!size) {
      throw new Error(`${EVENT_LABELS[eventKey] || eventKey}: Mindestens ${minimumParticipantSlots} Teilnehmerplätze sind für den Format-Lock erforderlich.`);
    }

    const participants = buildFinalParticipants(event, size);
    const activeTeamIds = participants.filter(participant => participant.type === 'team').map(participant => participant.teamId);
    const activeTeamSet = new Set(activeTeamIds);
    const waitlistTeamIds = teamIds.filter(teamId => !activeTeamSet.has(String(teamId))).map(String);
    const activeByeCount = participants.filter(participant => participant.type === 'bye').length;
    const waitlistByeCount = Math.max(0, byeParticipants.length - activeByeCount);
    const timestamp = nowIso();

    event.format = {
      ...event.format,
      minimumRealTeams: minimumParticipantSlots,
      allowedSizes,
      size,
      realTeamCount: teamIds.length,
      byeCount: byeParticipants.length,
      activeByeCount,
      waitlistByeCount,
      waitlistCount: waitlistTeamIds.length + waitlistByeCount,
      lockedAt: timestamp,
      lockedByUserId: String(actorUserId),
      participants,
    };
    event.checkin.activeTeamIds = activeTeamIds;
    event.checkin.waitlistTeamIds = waitlistTeamIds;
    event.status = 'checkin';
    event.meta = { ...event.meta, updatedAt: timestamp };

    result = { event, size, participants, waitlistTeamIds, waitlistByeCount };
    return event;
  });

  return result;
}

function getLockedParticipants(event) {
  if (!event.format?.lockedAt || !event.format?.size) {
    throw new Error('Bitte locke zuerst das Turnierformat.');
  }

  if (Array.isArray(event.format.participants) && event.format.participants.length >= Number(event.format.size)) {
    return event.format.participants.slice(0, Number(event.format.size));
  }

  return buildFinalParticipants(event, Number(event.format.size));
}

function createGroupMatches(groupKey, slots) {
  return MATCHDAY_PAIRINGS.map((pairings, matchdayIndex) => ({
    matchday: matchdayIndex + 1,
    matches: pairings.map((pairing, index) => {
      const homeSlot = slots[pairing[0] - 1];
      const awaySlot = slots[pairing[1] - 1];
      const hasBye = homeSlot?.participant?.type === 'bye' || awaySlot?.participant?.type === 'bye';
      return {
        id: `${groupKey}_md${matchdayIndex + 1}_m${index + 1}`,
        status: hasBye ? 'admin_decision_required' : 'scheduled',
        groupKey,
        matchday: matchdayIndex + 1,
        homeSlot: pairing[0],
        awaySlot: pairing[1],
        home: homeSlot?.participant || null,
        away: awaySlot?.participant || null,
        result: null,
        confirmation: {
          status: 'not_submitted',
          submittedByUserId: null,
          confirmedByUserId: null,
          submittedAt: null,
          confirmedAt: null,
        },
      };
    }),
  }));
}

function distributeParticipantsForGroups(participants, groupCount) {
  const teams = participants.filter(participant => participant.type === 'team');
  const byes = participants.filter(participant => participant.type === 'bye');
  const reservedByes = Array.from({ length: groupCount }, () => []);

  byes.forEach((bye, index) => {
    reservedByes[index % groupCount].push(bye);
  });

  return reservedByes.map(groupByes => {
    const groupParticipants = [];
    const teamSlotsBeforeByes = Math.max(0, GROUP_SIZE - groupByes.length);

    while (groupParticipants.length < teamSlotsBeforeByes && teams.length) {
      groupParticipants.push(teams.shift());
    }

    groupParticipants.push(...groupByes);

    while (groupParticipants.length < GROUP_SIZE && teams.length) {
      groupParticipants.push(teams.shift());
    }

    return groupParticipants.slice(0, GROUP_SIZE);
  });
}

function buildGroups(event) {
  const participants = getLockedParticipants(event);
  const groupCount = Number(event.format.size) / GROUP_SIZE;
  const distributedGroups = distributeParticipantsForGroups(participants, groupCount);
  const groups = {};

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupKey = GROUP_KEYS[groupIndex];
    const groupParticipants = distributedGroups[groupIndex];
    const slots = groupParticipants.map((participant, index) => ({
      slot: index + 1,
      participant,
      participantKey: getParticipantKey(participant),
      displayName: getParticipantDisplayName(participant),
    }));

    groups[groupKey] = {
      groupKey,
      name: `Gruppe ${groupKey}`,
      roleId: event.groups?.groups?.[groupKey]?.roleId || null,
      channelId: event.groups?.groups?.[groupKey]?.channelId || null,
      messageId: event.groups?.groups?.[groupKey]?.messageId || null,
      slots,
      standings: slots.map(slot => ({
        slot: slot.slot,
        participantKey: slot.participantKey,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      })),
      matchdays: createGroupMatches(groupKey, slots),
    };
  }

  return groups;
}

function getTeamUserIds(teamId) {
  const team = findTeamById(teamId);
  if (!team || team.isTestTeam) return [];

  const ids = [];
  if (team.manager?.userId) ids.push(String(team.manager.userId));
  for (const coManager of team.coManagers || []) {
    if (coManager?.userId) ids.push(String(coManager.userId));
  }
  return [...new Set(ids)];
}

function getGroupUserIds(group) {
  const ids = [];
  for (const slot of group.slots || []) {
    if (slot.participant?.type !== 'team') continue;
    ids.push(...getTeamUserIds(slot.participant.teamId));
  }
  return [...new Set(ids)];
}

async function ensureGroupRole(guild, settings, groupKey) {
  const configuredRoleId = settings.roles?.groupRoleIds?.[groupKey];
  const existingById = configuredRoleId ? await guild.roles.fetch(configuredRoleId).catch(() => null) : null;
  if (existingById) return existingById;

  const roleName = `LNC Gruppe ${groupKey}`;
  const existingByName = guild.roles.cache.find(role => role.name === roleName);
  if (existingByName) return existingByName;

  return guild.roles.create({
    name: roleName,
    mentionable: false,
    reason: 'Loco Night Cup Gruppenziehung',
  });
}

function getExistingRoleIds(guild, roleIds) {
  return [...new Set((roleIds || []).filter(Boolean).map(String))]
    .filter(roleId => guild.roles.cache.has(roleId));
}

async function ensureGroupChannel(guild, settings, groupKey, role, userIds) {
  const configuredChannelId = settings.channels?.groupChannelIds?.[groupKey];
  const existingById = configuredChannelId ? await guild.channels.fetch(configuredChannelId).catch(() => null) : null;
  if (existingById?.isTextBased?.()) return existingById;

  const channelName = `gruppe-${groupKey.toLowerCase()}`;
  const existingByName = guild.channels.cache.find(channel => channel.name === channelName && channel.type === ChannelType.GuildText);
  if (existingByName) return existingByName;

  const adminRoleIds = getExistingRoleIds(guild, [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ]);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: guild.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    },
    {
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    ...adminRoleIds.map(roleId => ({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
    })),
    ...userIds.map(userId => ({
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: settings.categories?.groupCategoryId || undefined,
    permissionOverwrites,
    reason: 'Loco Night Cup Gruppenziehung',
  });
}

function buildGroupPostPayload(group) {
  const teamLines = (group.slots || []).map(slot => {
    const participant = slot.participant;
    const label = participant?.type === 'bye' ? 'Freilos' : slot.displayName;
    return `${slot.slot}. ${label}`;
  });

  return {
    content: [
      `**${group.name}**`,
      '',
      teamLines.join('\n'),
      '',
      'Bitte nutzt diesen Kanal fuer eure Gruppenabsprachen.',
      'Ergebnisse werden in einer spaeteren Phase ueber das Ergebnis-System gemeldet und bestaetigt.',
    ].join('\n'),
    allowedMentions: { parse: [] },
  };
}

async function upsertGroupMessage(channel, group) {
  const payload = buildGroupPostPayload(group);
  const existing = group.messageId ? await channel.messages.fetch(group.messageId).catch(() => null) : null;
  if (existing) {
    await existing.edit(payload);
    return existing;
  }
  return channel.send(payload);
}

function updateGeneratedSettings(groupUpdates) {
  updateJson(FILES.settings, createSettingsDefault(), settings => {
    settings.roles = settings.roles || {};
    settings.roles.groupRoleIds = settings.roles.groupRoleIds || {};
    settings.channels = settings.channels || {};
    settings.channels.groupChannelIds = settings.channels.groupChannelIds || {};

    for (const update of groupUpdates) {
      if (!settings.roles.groupRoleIds[update.groupKey]) settings.roles.groupRoleIds[update.groupKey] = update.roleId;
      if (!settings.channels.groupChannelIds[update.groupKey]) settings.channels.groupChannelIds[update.groupKey] = update.channelId;
    }

    return settings;
  });
}

function updateGroupMessages(eventKey, event, groupUpdates) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    messages.groups = messages.groups || {};
    messages.groups[eventKey] = messages.groups[eventKey] || { cycleKey: null, groups: {} };
    messages.groups[eventKey].cycleKey = event.cycle?.cycleKey || null;
    messages.groups[eventKey].groups = messages.groups[eventKey].groups || {};

    for (const update of groupUpdates) {
      messages.groups[eventKey].groups[update.groupKey] = {
        channelId: update.channelId,
        messageId: update.messageId,
        roleId: update.roleId,
        updatedAt: nowIso(),
      };
    }

    return messages;
  });
}

async function syncGroupDiscordResources({ eventKey, client, guild, groups }) {
  const settings = getSettings();
  const groupUpdates = [];

  for (const group of Object.values(groups)) {
    const userIds = getGroupUserIds(group);
    const role = await ensureGroupRole(guild, settings, group.groupKey);

    for (const userId of userIds) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && !member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => null);
      }
    }

    const channel = await ensureGroupChannel(guild, settings, group.groupKey, role, userIds);
    const message = await upsertGroupMessage(channel, { ...group, roleId: role.id, channelId: channel.id });

    group.roleId = role.id;
    group.channelId = channel.id;
    group.messageId = message.id;

    groupUpdates.push({
      groupKey: group.groupKey,
      roleId: role.id,
      channelId: channel.id,
      messageId: message.id,
    });
  }

  updateGeneratedSettings(groupUpdates);
  const event = readEventData(eventKey);
  updateGroupMessages(eventKey, event, groupUpdates);
  return groupUpdates;
}

async function drawGroupsForEvent({ eventKey, actorUserId, client, guild }) {
  let drawResult;

  updateEventData(eventKey, event => {
    if (!event.format?.lockedAt) throw new Error('Bitte locke zuerst das Turnierformat.');
    if (event.groups?.status === 'created') throw new Error('Die Gruppen wurden bereits gezogen.');

    const groups = buildGroups(event);
    const timestamp = nowIso();
    event.groups = {
      ...event.groups,
      status: 'created',
      drawnAt: timestamp,
      drawnBy: String(actorUserId),
      groups,
    };
    event.status = 'groups';
    event.meta = { ...event.meta, updatedAt: timestamp };
    drawResult = { event, groups };
    return event;
  });

  if (guild && client) {
    const updates = await syncGroupDiscordResources({ eventKey, client, guild, groups: drawResult.groups });
    updateEventData(eventKey, event => {
      for (const update of updates) {
        if (!event.groups?.groups?.[update.groupKey]) continue;
        event.groups.groups[update.groupKey].roleId = update.roleId;
        event.groups.groups[update.groupKey].channelId = update.channelId;
        event.groups.groups[update.groupKey].messageId = update.messageId;
      }
      event.meta = { ...event.meta, updatedAt: nowIso() };
      drawResult.event = event;
      return event;
    });
  }

  return drawResult;
}

module.exports = {
  drawGroupsForEvent,
  lockEventFormat,
};
