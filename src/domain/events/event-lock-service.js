'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('./event-repository');
const { buildLockedParticipantField } = require('./event-format');
const { createGroups } = require('../groups/group-draw');
const { assertCanLockEvent, assertGroupsHaveFourSlots } = require('../groups/group-validation');
const { ensureGroupRolesAndMembers } = require('../groups/group-roles');
const { ensureGroupChannel, ensureGroupVideoChannel, getGroupUserIds } = require('../groups/group-channels');
const { updateGroupMessageRefs, upsertGroupPosts } = require('../groups/group-posts');
const { createInitialReleaseState, maybeReleaseNextSlot, scheduleEvent } = require('../groups/group-releases');
const { refreshLiveSchedule } = require('../live-schedule');
const { isLeaguePhaseFormat } = require('../../app/constants');

function nowIso(now = new Date()) {
  return now.toISOString();
}

function getStoredGroupMessageRefs(eventKey) {
  const messages = readJson(FILES.messages, createMessagesDefault());
  return messages.groups?.[eventKey]?.groups || {};
}

function updateGeneratedSettings(groupUpdates) {
  updateJson(FILES.settings, createSettingsDefault(), settings => {
    settings.roles = settings.roles || {};
    settings.roles.groupRoleIds = settings.roles.groupRoleIds || {};
    settings.channels = settings.channels || {};
    settings.channels.groupChannelIds = settings.channels.groupChannelIds || {};

    for (const update of groupUpdates) {
      if (update.roleId) settings.roles.groupRoleIds[update.groupKey] = update.roleId;
      if (update.channelId) settings.channels.groupChannelIds[update.groupKey] = update.channelId;
    }

    settings.meta = {
      ...(settings.meta || {}),
      updatedAt: nowIso(),
    };

    return settings;
  });
}

function createFieldFromLockedEvent(event) {
  const size = Number(event.format?.size || 0);
  const participants = Array.isArray(event.format?.participants)
    ? event.format.participants.slice(0, size)
    : [];

  if (!event.format?.lockedAt || !size) {
    throw new Error('Bitte locke zuerst das Turnierformat.');
  }

  if (participants.length !== size) {
    throw new Error('Das gelockte Format enthaelt keine vollstaendige Teilnehmerliste.');
  }

  return {
    size,
    groupCount: isLeaguePhaseFormat(size) ? 0 : size / 4,
    participants,
    activeTeams: participants.filter(participant => participant.type === 'team'),
    activeByes: participants.filter(participant => participant.type === 'bye'),
  };
}

function lockEventFormat(eventKey, actorUserId, now = new Date()) {
  const timestamp = nowIso(now);
  let result;

  updateEventData(eventKey, event => {
    assertCanLockEvent(event);
    const field = buildLockedParticipantField(event, now);

    event.status = 'checkin';
    event.format = {
      ...event.format,
      minimumRealTeams: field.minimumRealTeams,
      allowedSizes: field.allowedSizes,
      size: field.size,
      realTeamCount: field.checkedInRealTeamCount,
      activeRealTeamCount: field.activeTeams.length,
      byeCount: field.activeByeCount,
      activeByeCount: field.activeByeCount,
      waitlistByeCount: field.waitlistByeCount,
      waitlistCount: field.waitlistTeams.length + field.waitlistByeCount,
      lockedAt: timestamp,
      lockedByUserId: actorUserId ? String(actorUserId) : null,
      participants: field.participants,
    };

    event.checkin = {
      ...event.checkin,
      isOpen: false,
      closedAt: event.checkin?.closedAt || timestamp,
      entries: event.checkin?.entries || [],
      activeTeamIds: field.activeTeams.map(team => String(team.id)),
      waitlistTeamIds: field.waitlistTeams.map(team => String(team.id)),
      lateLeaveBans: event.checkin?.lateLeaveBans || [],
    };

    event.groups = {
      ...(event.groups || {}),
      status: 'not_created',
      groups: {},
      meta: {
        ...(event.groups?.meta || {}),
        skippedCheckins: field.skipped,
      },
    };
    event.leaguePhase = {
      phaseType: null, status: 'not_created', participants: [], slots: [], matchdays: [], standings: [],
      currentMatchday: 0, transitionStatus: 'not_started', messages: {},
    };

    event.meta = {
      ...event.meta,
      updatedAt: timestamp,
    };

    result = {
      event,
      field,
      size: field.size,
      participants: field.participants,
      waitlistTeamIds: field.waitlistTeams.map(team => String(team.id)),
      waitlistByeCount: field.waitlistByeCount,
    };

    return event;
  });

  return result;
}

async function syncGroupDiscordResources({ eventKey, event, client, guild, settings }) {
  if (!client || !guild) return [];

  const storedRefs = getStoredGroupMessageRefs(eventKey);
  const roleResult = await ensureGroupRolesAndMembers({ client, event, settings });
  const updates = [];

  for (const group of Object.values(event.groups?.groups || {})) {
    const roleUpdate = roleResult.updates.find(update => update.groupKey === group.groupKey);
    if (roleUpdate?.roleId) group.roleId = roleUpdate.roleId;

    const userIds = getGroupUserIds(group);
    const channel = await ensureGroupChannel(roleResult.guild || guild, settings, group, userIds);
    group.channelId = channel.id;
    const videoChannel = await ensureGroupVideoChannel(roleResult.guild || guild, settings, group);
    group.videoChannelId = videoChannel.id;

    const messageRefs = await upsertGroupPosts(channel, { ...group, eventKey, formatSize: event.format?.size }, {
      eventKey,
      ...(storedRefs[group.groupKey] || {}),
      messageId: group.messageId || storedRefs[group.groupKey]?.messageId || null,
      headerMessageId: group.headerMessageId || storedRefs[group.groupKey]?.headerMessageId || null,
      teamsMessageId: group.teamsMessageId || storedRefs[group.groupKey]?.teamsMessageId || null,
      tableMessageId: group.tableMessageId || storedRefs[group.groupKey]?.tableMessageId || null,
      scheduleMessageId: group.scheduleMessageId || storedRefs[group.groupKey]?.scheduleMessageId || null,
    });
    group.messageId = messageRefs.messageId;
    group.headerMessageId = messageRefs.headerMessageId;
    group.teamsMessageId = messageRefs.teamsMessageId;
    group.tableMessageId = messageRefs.tableMessageId;
    group.scheduleMessageId = messageRefs.scheduleMessageId;

    // Sobald die sichtbaren Discord-Posts existieren, muss auch das vollstaendige
    // normal erzeugte Gruppenobjekt in derselben Eventdatei auffindbar sein.
    updateEventData(eventKey, persistedEvent => {
      persistedEvent.groups = persistedEvent.groups || {};
      persistedEvent.groups.groups = persistedEvent.groups.groups || {};
      persistedEvent.groups.groups[group.groupKey] = JSON.parse(JSON.stringify(group));
      persistedEvent.meta = { ...(persistedEvent.meta || {}), updatedAt: nowIso() };
      return persistedEvent;
    });

    const { ensureAttendancePost } = require('../groups/attendance-service');
    await ensureAttendancePost(client, eventKey, group.groupKey);

    updates.push({
      groupKey: group.groupKey,
      roleId: group.roleId || null,
      channelId: group.channelId,
      videoChannelId: group.videoChannelId,
      messageId: group.messageId,
      headerMessageId: group.headerMessageId,
      teamsMessageId: group.teamsMessageId,
      tableMessageId: group.tableMessageId,
      scheduleMessageId: group.scheduleMessageId,
    });
  }

  updateGeneratedSettings(updates);
  updateGroupMessageRefs(eventKey, event, updates);
  return updates;
}

async function drawGroupsForEvent({ eventKey, actorUserId = null, client = null, guild = null, now = new Date() }) {
  const lockedEvent = readEventData(eventKey);
  if (isLeaguePhaseFormat(lockedEvent.format?.size)) {
    const { drawLeaguePhaseForEvent } = require('../league-phase');
    return drawLeaguePhaseForEvent({ eventKey, actorUserId, client, guild, now });
  }
  const settings = readJson(FILES.settings, createSettingsDefault());
  const timestamp = nowIso(now);
  let drawResult;

  updateEventData(eventKey, event => {
    if (event.groups?.status && event.groups.status !== 'not_created') {
      throw new Error('Die Gruppen wurden bereits gezogen.');
    }

    const field = createFieldFromLockedEvent(event);
    const groups = createGroups({
      eventKey,
      field,
      settings,
      createdAt: timestamp,
    });
    assertGroupsHaveFourSlots(groups);

    event.status = 'groups';
    event.groups = {
      ...(event.groups || {}),
      status: 'created',
      drawnAt: timestamp,
      drawnBy: actorUserId ? String(actorUserId) : null,
      groups,
      releases: createInitialReleaseState(eventKey, { ...event, groups: { ...(event.groups || {}), groups } }, now),
    };
    event.meta = {
      ...event.meta,
      updatedAt: timestamp,
    };

    drawResult = { event, groups, field };
    return event;
  });

  console.info('[groups] Gruppen persistent erzeugt.', {
    selectedEvent: eventKey,
    normalizedWeekday: eventKey,
    eventId: drawResult.event?.id || drawResult.event?.eventId || eventKey,
    eventFile: FILES.events[eventKey],
    formatSize: drawResult.event?.format?.size,
    storedGroupCount: Object.keys(drawResult.groups || {}).length,
    groups: Object.values(drawResult.groups || {}).map(group => ({
      groupId: String(group.groupKey),
      channelId: group.channelId || null,
    })),
  });

  let targetGuild = guild || null;
  if (!targetGuild && client) {
    targetGuild = settings.guild?.guildId
      ? await client.guilds.fetch(settings.guild.guildId).catch(() => null)
      : client.guilds.cache.first() || null;
  }
  const updates = await syncGroupDiscordResources({
    eventKey,
    event: drawResult.event,
    client,
    guild: targetGuild,
    settings,
  });

  if (updates.length) {
    updateEventData(eventKey, event => {
      for (const update of updates) {
        const group = event.groups?.groups?.[update.groupKey];
        if (!group) continue;
        group.roleId = update.roleId;
        group.channelId = update.channelId;
        group.videoChannelId = update.videoChannelId;
        group.messageId = update.messageId;
        group.headerMessageId = update.headerMessageId;
        group.teamsMessageId = update.teamsMessageId;
        group.tableMessageId = update.tableMessageId;
        group.scheduleMessageId = update.scheduleMessageId;
      }
      event.meta = {
        ...event.meta,
        updatedAt: nowIso(),
      };
      drawResult.event = event;
      drawResult.groups = event.groups.groups;
      return event;
    });
  }

  const persistedEvent = readEventData(eventKey);
  console.info('[groups] Discord-Zuordnung persistent gespeichert.', {
    selectedEvent: eventKey,
    normalizedWeekday: eventKey,
    eventId: persistedEvent?.id || persistedEvent?.eventId || eventKey,
    eventFile: FILES.events[eventKey],
    storedGroupCount: Object.keys(persistedEvent.groups?.groups || {}).length,
    groups: Object.values(persistedEvent.groups?.groups || {}).map(group => ({
      groupId: String(group.groupKey),
      channelId: group.channelId || null,
    })),
  });

  await maybeReleaseNextSlot(client, eventKey, now);
  scheduleEvent(client, eventKey);
  await refreshLiveSchedule(client, eventKey).catch(error => {
    console.warn(`[live-schedule] Refresh nach Gruppenziehung fuer ${eventKey} fehlgeschlagen: ${error.message}`);
  });

  return {
    ...drawResult,
    resourceUpdates: updates,
  };
}

async function lockEventAndCreateGroups({ eventKey, actorUserId = null, client = null, now = new Date() }) {
  const lock = lockEventFormat(eventKey, actorUserId, now);
  const draw = await drawGroupsForEvent({ eventKey, actorUserId, client, now });
  return {
    ...draw,
    lock,
  };
}

function getLockedEventPreview(eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  const field = event.format?.lockedAt
    ? createFieldFromLockedEvent(event)
    : buildLockedParticipantField(event, now);
  return {
    eventKey,
    formatSize: field.size,
    activeTeamIds: (field.activeTeams || []).map(team => String(team.teamId || team.id)),
    waitlistTeamIds: event.checkin?.waitlistTeamIds || [],
    usedByeIds: (field.activeByes || []).map(bye => String(bye.byeId || bye.id)),
    skippedCheckins: event.groups?.meta?.skippedCheckins || [],
  };
}

module.exports = {
  drawGroupsForEvent,
  getLockedEventPreview,
  lockEventAndCreateGroups,
  lockEventFormat,
};

