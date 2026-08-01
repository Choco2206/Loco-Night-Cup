'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createEventDefault, createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { ensureEventCycle } = require('../checkins/checkin-schedule');
const { refreshCheckinMessage } = require('../checkins/checkin-panel');
const { scheduleCheckinEvent } = require('../checkins/checkin-reconcile');
const { getConfiguredGuild, getTeamUserIds } = require('../groups/group-roles');
const { cleanupLiveScheduleForEvent } = require('../live-schedule');
const { findTeamById } = require('../teams/team-service');
const { EVENT_KEYS } = require('../../app/constants');

const AUTO_CLEANUP_DELAY_MS = 10 * 60 * 1000;
const KNOCKOUT_CHANNEL_NAMES = new Set([
  'ko-phase',
  'ko-achtelfinale',
  'ko-viertelfinale',
  'ko-halbfinale',
  'ko-platz-3',
  'ko-finale',
]);
const KNOCKOUT_ROLE_NAMES = [
  'LNC K.O. Achtelfinale',
  'LNC K.O. Viertelfinale',
  'LNC K.O. Halbfinale',
  'LNC K.O. Finale',
  'LNC K.O. Spiel um Platz 3',
  'LNC K.O. Platz 3',
];
const autoCleanupTimers = new Map();

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
  if (event.leaguePhase?.phaseType === 'league') {
    refs.push({ groupKey: 'league', channelId: event.leaguePhase.overviewChannelId || null, roleId: event.leaguePhase.roleId || null, teamIds: (event.leaguePhase.slots || []).filter(slot => slot.type === 'team' && slot.teamId).map(slot => String(slot.teamId)) });
    if (event.leaguePhase.resultsChannelId && event.leaguePhase.resultsChannelId !== event.leaguePhase.overviewChannelId) refs.push({ groupKey: 'league-results', channelId: event.leaguePhase.resultsChannelId, roleId: null, teamIds: [] });
  }
  for (const group of Object.values(groups)) {
    refs.push({
      groupKey: group.groupKey,
      channelId: group.channelId || messageGroups[group.groupKey]?.channelId || null,
      roleId: group.roleId || messageGroups[group.groupKey]?.roleId || null,
      teamIds: (group.slots || []).filter(slot => slot.type === 'team' && slot.teamId).map(slot => String(slot.teamId)),
    });
    if (group.videoChannelId) {
      refs.push({
        groupKey: `${group.groupKey}-video`,
        channelId: group.videoChannelId,
        roleId: null,
        teamIds: [],
      });
    }
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

function nextEventDate(eventKey, now = new Date()) {
  const indexByEventKey = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const targetDay = indexByEventKey[eventKey];
  if (targetDay === undefined) return null;

  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  let diffDays = (targetDay - date.getDay() + 7) % 7;
  if (diffDays === 0) diffDays = 7;
  date.setDate(date.getDate() + diffDays);
  return date.toISOString().slice(0, 10);
}

function prepareNextCheckin(event, eventKey, timestamp) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  event.status = 'checkin';
  event.cycle = {
    ...(event.cycle || {}),
    eventDate: nextEventDate(eventKey) || null,
    timezone: 'Europe/Berlin',
  };
  event.checkin = {
    ...(event.checkin || {}),
    isOpen: true,
    openedAt: timestamp,
    closedAt: null,
    entries: [],
    activeTeamIds: [],
    waitlistTeamIds: [],
    lateLeaveBans: [],
  };
  ensureEventCycle(eventKey, event, settings, new Date(timestamp));
}

function resetEventRuntime(eventKey, actorUserId, { openNextCheckin = true } = {}) {
  let resetEvent;
  updateJson(FILES.events[eventKey], createEventDefault(eventKey), event => {
    const defaults = createEventDefault(eventKey);
    const timestamp = nowIso();
    const resetAt = event.reset?.resetAt || event.schedule?.resetAt || defaults.reset.resetAt;
    resetEvent = {
      ...defaults,
      status: openNextCheckin ? defaults.status : 'reset',
      cycle: openNextCheckin ? defaults.cycle : { ...defaults.cycle, ...(event.cycle || {}) },
      schedule: openNextCheckin ? defaults.schedule : { ...defaults.schedule, ...(event.schedule || {}) },
      format: openNextCheckin ? defaults.format : { ...defaults.format, ...(event.format || {}) },
      checkin: openNextCheckin ? defaults.checkin : { ...defaults.checkin, ...(event.checkin || {}), isOpen: false },
      reset: {
        ...defaults.reset,
        status: 'completed',
        resetAt,
        completedAt: timestamp,
        keepStats: true,
      },
      meta: {
        ...defaults.meta,
        createdAt: event.meta?.createdAt || defaults.meta.createdAt,
        updatedAt: timestamp,
        resetAt: timestamp,
        resetByUserId: actorUserId ? String(actorUserId) : null,
      },
    };
    if (openNextCheckin) prepareNextCheckin(resetEvent, eventKey, timestamp);
    return resetEvent;
  });
  return resetEvent;
}

function resetMessages(eventKey) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    const defaults = createMessagesDefault();
    messages.groups = messages.groups || {};
    messages.knockout = messages.knockout || {};
    messages.leaguePhase = messages.leaguePhase || {};
    messages.ceremony = messages.ceremony || {};
    messages.groups[eventKey] = defaults.groups[eventKey];
    messages.leaguePhase[eventKey] = defaults.leaguePhase[eventKey];
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
  if (autoCleanupTimers.has(eventKey)) {
    clearTimeout(autoCleanupTimers.get(eventKey));
    autoCleanupTimers.delete(eventKey);
  }

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
  summary.liveScheduleCleaned = await cleanupLiveScheduleForEvent(client, eventKey).catch(error => {
    console.warn(`Event cleanup could not clean live schedule for ${eventKey}: ${error.message}`);
    return { cleaned: false, deletedMessageIds: [] };
  });

  resetEventRuntime(eventKey, actorUserId, { openNextCheckin: false });
  summary.eventReset = true;
  resetMessages(eventKey);
  summary.messagesReset = true;
  summary.checkinRefreshed = await refreshCheckinMessage(eventKey, client).catch(error => {
    console.warn(`Event cleanup could not refresh check-in for ${eventKey}: ${error.message}`);
    return false;
  });
  summary.checkinRescheduled = Boolean(scheduleCheckinEvent(client, eventKey));

  console.log(`Event cleanup complete for ${eventKey}: groupChannels=${summary.deletedGroupChannels.length}, knockoutChannels=${summary.deletedKnockoutChannels.length}, roles=${summary.clearedGroupRoles.length}, checkinRefreshed=${summary.checkinRefreshed}, checkinRescheduled=${summary.checkinRescheduled}`);
  return summary;
}

function getAutoCleanupScheduledAt(postedAt) {
  const postedDate = new Date(postedAt);
  if (Number.isNaN(postedDate.getTime())) return null;
  return new Date(postedDate.getTime() + AUTO_CLEANUP_DELAY_MS).toISOString();
}

function markCeremonyAutoCleanupScheduled(eventKey, postedAt) {
  let scheduledAt = null;
  updateJson(FILES.events[eventKey], createEventDefault(eventKey), event => {
    if (event.ceremony?.status !== 'posted') return event;
    event.ceremony.cleanupScheduledAt = event.ceremony.cleanupScheduledAt || getAutoCleanupScheduledAt(postedAt);
    event.ceremony.cleanupStatus = event.ceremony.cleanupStatus || 'scheduled';
    event.ceremony.cleanupCompletedAt = event.ceremony.cleanupCompletedAt || null;
    event.meta = { ...(event.meta || {}), updatedAt: nowIso() };
    scheduledAt = event.ceremony.cleanupScheduledAt || null;
    return event;
  });
  return scheduledAt;
}

function shouldRunAutoCleanup(event, scheduledAt) {
  if (event?.ceremony?.status !== 'posted') return false;
  if (event.ceremony.cleanupStatus === 'completed') return false;
  if (event.ceremony.cleanupCompletedAt) return false;
  if (scheduledAt && event.ceremony.cleanupScheduledAt && event.ceremony.cleanupScheduledAt !== scheduledAt) return false;
  return true;
}

async function runAutoCleanup({ eventKey, client, guild = null, scheduledAt = null }) {
  autoCleanupTimers.delete(eventKey);
  const event = readJson(FILES.events[eventKey], createEventDefault(eventKey));
  if (!shouldRunAutoCleanup(event, scheduledAt)) {
    console.log(`Auto-cleanup skipped for ${eventKey}: ceremony is no longer pending cleanup.`);
    return { skipped: true, reason: 'not_pending' };
  }

  console.log(`Auto-cleanup started for ${eventKey}.`);
  return resetEventForTesting({
    eventKey,
    actorUserId: 'auto-cleanup',
    client,
    guild,
  });
}

function scheduleAutoCleanupForEvent({ eventKey, client, guild = null, scheduledAt = null }) {
  if (!client || !EVENT_KEYS.includes(eventKey)) return null;
  const event = readJson(FILES.events[eventKey], createEventDefault(eventKey));
  const targetScheduledAt = scheduledAt || event.ceremony?.cleanupScheduledAt || null;
  if (!targetScheduledAt || !shouldRunAutoCleanup(event, targetScheduledAt)) return null;

  const scheduledDate = new Date(targetScheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) return null;

  if (autoCleanupTimers.has(eventKey)) {
    clearTimeout(autoCleanupTimers.get(eventKey));
    autoCleanupTimers.delete(eventKey);
  }

  const delay = Math.max(0, scheduledDate.getTime() - Date.now());
  const timer = setTimeout(() => {
    runAutoCleanup({ eventKey, client, guild, scheduledAt: targetScheduledAt }).catch(error => {
      console.error(`Auto-cleanup failed for ${eventKey}:`, error);
    });
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  autoCleanupTimers.set(eventKey, timer);
  console.log(`Auto-cleanup scheduled for ${eventKey} at ${targetScheduledAt}.`);
  return { eventKey, scheduledAt: targetScheduledAt, delayMs: delay };
}

function schedulePendingAutoCleanups(client) {
  const scheduled = [];
  for (const eventKey of EVENT_KEYS) {
    const result = scheduleAutoCleanupForEvent({ eventKey, client });
    if (result) scheduled.push(result);
  }
  return scheduled;
}

module.exports = {
  AUTO_CLEANUP_DELAY_MS,
  getAutoCleanupScheduledAt,
  markCeremonyAutoCleanupScheduled,
  scheduleAutoCleanupForEvent,
  schedulePendingAutoCleanups,
  resetEventForTesting,
};


