'use strict';

const { ChannelType } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createEventDefault, createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { refreshCheckinMessage } = require('../checkins/checkin-panel');
const { getConfiguredGuild, getTeamUserIds } = require('../groups/group-roles');
const { findTeamById } = require('../teams/team-service');

const KNOCKOUT_CHANNEL_NAMES = new Set([
  'ko-phase',
  'ko-achtelfinale',
  'ko-viertelfinale',
  'ko-halbfinale',
  'ko-platz-3',
  'ko-finale',
]);
const KNOCKOUT_CATEGORY_NAME = 'K.O.-Phase';
const KNOCKOUT_ROLE_NAMES = [
  'LNC K.O. Achtelfinale',
  'LNC K.O. Viertelfinale',
  'LNC K.O. Halbfinale',
  'LNC K.O. Finale',
  'LNC K.O. Platz 3',
];

function nowIso() {
  return new Date().toISOString();
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function collectGroupRefs(eventKey, event, messages) {
  const refs = [];
  const messageGroups = messages.groups?.[eventKey]?.groups || {};
  const groups = event.groups?.groups || {};
  for (const group of Object.values(groups)) {
    refs.push({
      groupKey: group.groupKey,
      channelId: group.channelId || messageGroups[group.groupKey]?.channelId || null,
      roleId: group.roleId || messageGroups[group.groupKey]?.roleId || null,
      teamIds: (group.slots || []).filter(slot => slot.type === 'team' && slot.teamId).map(slot => String(slot.teamId)),
    });
  }
  for (const [groupKey, ref] of Object.entries(messageGroups)) {
    if (refs.some(entry => entry.groupKey === groupKey)) continue;
    refs.push({ groupKey, channelId: ref.channelId || null, roleId: ref.roleId || null, teamIds: [] });
  }
  return refs;
}

function collectKnockoutChannelIds(eventKey, event, messages) {
  const ids = [];
  const knockoutMessages = messages.knockout?.[eventKey] || {};
  if (event.knockout?.overviewChannelId) ids.push(event.knockout.overviewChannelId);
  if (event.knockout?.channelId) ids.push(event.knockout.channelId);
  if (knockoutMessages.channelId) ids.push(knockoutMessages.channelId);

  for (const round of Object.values(event.knockout?.rounds || {})) {
    if (round?.channelId) ids.push(round.channelId);
  }
  for (const round of Object.values(knockoutMessages.rounds || {})) {
    if (round?.channelId) ids.push(round.channelId);
  }

  return uniqueStrings(ids);
}

async function fetchGuild(client, settings) {
  if (!client) return null;
  return getConfiguredGuild(client, settings || {});
}

async function deleteChannelById(client, channelId, expectedNames, deleted, missing) {
  if (!client || !channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    missing.push(channelId);
    return false;
  }
  if (expectedNames?.size && channel.name && !expectedNames.has(channel.name)) {
    console.warn(`Event cleanup skipped channel ${channel.id} (${channel.name}) because the name is not in the expected set.`);
    return false;
  }
  await channel.delete('Loco Night Cup Event reset').catch(error => {
    console.warn(`Event cleanup could not delete channel ${channelId}: ${error.message}`);
    return null;
  });
  deleted.push({ id: channelId, name: channel.name || null });
  return true;
}

async function deleteGroupChannels(client, groupRefs, summary) {
  for (const ref of groupRefs) {
    await deleteChannelById(client, ref.channelId, null, summary.deletedGroupChannels, summary.missingChannels);
  }
}

async function deleteKnockoutChannels(client, channelIds, summary) {
  for (const channelId of channelIds) {
    await deleteChannelById(client, channelId, KNOCKOUT_CHANNEL_NAMES, summary.deletedKnockoutChannels, summary.missingChannels);
  }
}

async function deleteEmptyKnockoutCategory(guild, event, messages, summary) {
  if (!guild) return;
  const categoryId = event.knockout?.categoryId || messages.knockout?.[event.eventKey]?.categoryId || null;
  const category = categoryId
    ? await guild.channels.fetch(categoryId).catch(() => null)
    : guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === KNOCKOUT_CATEGORY_NAME);
  if (!category || category.type !== ChannelType.GuildCategory) return;
  const children = guild.channels.cache.filter(channel => channel.parentId === category.id);
  if (children.size > 0) return;
  await category.delete('Loco Night Cup Event reset: empty K.O. category').catch(error => {
    console.warn(`Event cleanup could not delete K.O. category ${category.id}: ${error.message}`);
    return null;
  });
  summary.deletedKnockoutCategoryId = category.id;
}

function userIdsForGroupRef(ref) {
  const ids = [];
  for (const teamId of ref.teamIds || []) ids.push(...getTeamUserIds(findTeamById(teamId)));
  return uniqueStrings(ids);
}

async function clearRoleMembers(guild, groupRefs, summary) {
  if (!guild) return;
  await guild.members.fetch().catch(() => null);
  for (const ref of groupRefs) {
    if (!ref.roleId) continue;
    const role = await guild.roles.fetch(ref.roleId).catch(() => null);
    if (!role) {
      summary.missingRoles.push(ref.roleId);
      continue;
    }

    const members = new Map();
    for (const member of role.members.values()) members.set(member.id, member);
    for (const userId of userIdsForGroupRef(ref)) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) members.set(member.id, member);
    }

    let removed = 0;
    for (const member of members.values()) {
      if (!member.roles.cache.has(role.id)) continue;
      await member.roles.remove(role.id, 'Loco Night Cup Event reset').catch(error => {
        console.warn(`Event cleanup could not remove role ${role.id} from ${member.id}: ${error.message}`);
        return null;
      });
      removed += 1;
    }
    summary.clearedGroupRoles.push({ roleId: role.id, name: role.name, removed });
  }
}

async function clearKnockoutRoleMembers(guild, settings, summary) {
  if (!guild) return;
  await guild.members.fetch().catch(() => null);
  const configuredRoleIds = uniqueStrings(Object.values(settings.roles?.knockoutRoleIds || {}));
  const roles = new Map();

  for (const roleId of configuredRoleIds) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (role) roles.set(role.id, role);
    else summary.missingRoles.push(roleId);
  }

  for (const roleName of KNOCKOUT_ROLE_NAMES) {
    const role = guild.roles.cache.find(entry => entry.name === roleName);
    if (role) roles.set(role.id, role);
  }

  for (const role of roles.values()) {
    let removed = 0;
    for (const member of role.members.values()) {
      await member.roles.remove(role.id, 'Loco Night Cup Event reset').catch(error => {
        console.warn(`Event cleanup could not remove K.O. role ${role.id} from ${member.id}: ${error.message}`);
        return null;
      });
      removed += 1;
    }
    summary.clearedKnockoutRoles.push({ roleId: role.id, name: role.name, removed });
  }
}

function resetEventRuntime(eventKey, actorUserId) {
  let resetEvent;
  updateJson(FILES.events[eventKey], createEventDefault(eventKey), event => {
    const defaults = createEventDefault(eventKey);
    resetEvent = {
      ...defaults,
      reset: {
        ...defaults.reset,
        status: 'completed',
        completedAt: nowIso(),
        keepStats: true,
      },
      meta: {
        ...defaults.meta,
        createdAt: event.meta?.createdAt || defaults.meta.createdAt,
        updatedAt: nowIso(),
        resetAt: nowIso(),
        resetByUserId: actorUserId ? String(actorUserId) : null,
      },
    };
    return resetEvent;
  });
  return resetEvent;
}

function resetMessages(eventKey) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    const defaults = createMessagesDefault();
    messages.groups = messages.groups || {};
    messages.knockout = messages.knockout || {};
    messages.ceremony = messages.ceremony || {};
    messages.groups[eventKey] = defaults.groups[eventKey];
    messages.knockout[eventKey] = defaults.knockout[eventKey];
    messages.ceremony[eventKey] = defaults.ceremony[eventKey];

    if (messages.liveSchedule?.currentEventKey === eventKey) {
      messages.liveSchedule.phase = null;
      messages.liveSchedule.currentEventKey = null;
      messages.liveSchedule.groupMessageIds = {};
      messages.liveSchedule.knockoutMessageIds = {};
      messages.liveSchedule.updatedAt = nowIso();
    }

    messages.meta = { ...(messages.meta || {}), updatedAt: nowIso() };
    return messages;
  });
}

async function resetEventForTesting({ eventKey, actorUserId, client, guild = null, settings = null }) {
  const event = readJson(FILES.events[eventKey], createEventDefault(eventKey));
  const messages = readJson(FILES.messages, createMessagesDefault());
  const activeSettings = settings || readJson(FILES.settings, createSettingsDefault());
  const targetGuild = guild || await fetchGuild(client, activeSettings);

  const summary = {
    eventKey,
    deletedGroupChannels: [],
    deletedKnockoutChannels: [],
    deletedKnockoutCategoryId: null,
    clearedGroupRoles: [],
    clearedKnockoutRoles: [],
    missingChannels: [],
    missingRoles: [],
    messagesReset: false,
    eventReset: false,
    checkinRefreshed: false,
  };

  const groupRefs = collectGroupRefs(eventKey, event, messages);
  const knockoutChannelIds = collectKnockoutChannelIds(eventKey, event, messages);

  await clearRoleMembers(targetGuild, groupRefs, summary);
  await clearKnockoutRoleMembers(targetGuild, activeSettings, summary);
  await deleteGroupChannels(client, groupRefs, summary);
  await deleteKnockoutChannels(client, knockoutChannelIds, summary);
  await deleteEmptyKnockoutCategory(targetGuild, event, messages, summary);

  resetEventRuntime(eventKey, actorUserId);
  summary.eventReset = true;
  resetMessages(eventKey);
  summary.messagesReset = true;
  summary.checkinRefreshed = await refreshCheckinMessage(eventKey, client).catch(error => {
    console.warn(`Event cleanup could not refresh check-in for ${eventKey}: ${error.message}`);
    return false;
  });

  console.log(`Event cleanup complete for ${eventKey}: groupChannels=${summary.deletedGroupChannels.length}, knockoutChannels=${summary.deletedKnockoutChannels.length}, roles=${summary.clearedGroupRoles.length}, checkinRefreshed=${summary.checkinRefreshed}`);
  return summary;
}

module.exports = {
  resetEventForTesting,
};
