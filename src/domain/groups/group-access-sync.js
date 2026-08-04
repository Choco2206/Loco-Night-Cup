'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { ensureGroupChannel, ensureGroupResultsChannel, ensureGroupVideoChannel, getGroupUserIds } = require('./group-channels');
const { getConfiguredGuild, getGroupTeamIds } = require('./group-roles');
const { refreshGroupPosts } = require('./group-posts');

function isActiveGroupPhase(event) {
  return event.groups?.groups
    && event.groups.status
    && !['not_created', 'completed', 'reset'].includes(event.groups.status);
}

function groupIncludesTeam(group, teamId) {
  const id = String(teamId);
  return getGroupTeamIds(group).some(entry => String(entry) === id);
}

async function assignGroupRoleToUsers(guild, group, userIds) {
  if (!guild || !group?.roleId) return 0;
  let assigned = 0;

  for (const userId of userIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.roles.cache.has(group.roleId)) continue;
    await member.roles.add(group.roleId, 'Loco Night Cup Gruppenrechte nach Co-VM-Änderung').then(() => {
      assigned += 1;
    }).catch(() => null);
  }

  return assigned;
}

async function syncTeamGroupAccess({ client, guild = null, teamId, settings = readJson(FILES.settings, createSettingsDefault()) }) {
  if (!teamId) return { groups: 0, rolesAssigned: 0, postsRefreshed: 0 };
  const targetGuild = guild || await getConfiguredGuild(client, settings);
  if (!targetGuild) return { groups: 0, rolesAssigned: 0, postsRefreshed: 0 };

  let groups = 0;
  let rolesAssigned = 0;
  let postsRefreshed = 0;

  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (!isActiveGroupPhase(event)) continue;

    for (const group of Object.values(event.groups.groups || {})) {
      if (!groupIncludesTeam(group, teamId)) continue;
      const userIds = getGroupUserIds(group);
      rolesAssigned += await assignGroupRoleToUsers(targetGuild, group, userIds);

      const channel = await ensureGroupChannel(targetGuild, settings, group, userIds).catch(error => {
        console.error(`Gruppe ${group.groupKey}: Gruppenrechte konnten nach Co-VM-Änderung nicht synchronisiert werden.`, error);
        return null;
      });
      const resultsChannel = await ensureGroupResultsChannel(targetGuild, settings, group, userIds).catch(error => {
        console.error(`Gruppe ${group.groupKey}: Ergebnis-Kanal konnte nicht synchronisiert werden.`, error);
        return null;
      });
      if (resultsChannel?.id && String(group.resultsChannelId || '') !== String(resultsChannel.id)) {
        group.resultsChannelId = resultsChannel.id;
        updateEventData(eventKey, stored => {
          if (stored.groups?.groups?.[group.groupKey]) {
            stored.groups.groups[group.groupKey].resultsChannelId = resultsChannel.id;
          }
          return stored;
        });
      }
      await ensureGroupVideoChannel(targetGuild, settings, group).catch(error => {
        console.error(`Gruppe ${group.groupKey}: Größenvideo-Kanal konnte nicht synchronisiert werden.`, error);
        return null;
      });
      const groupForRefresh = channel?.id ? { ...group, channelId: channel.id } : group;
      await refreshGroupPosts({ client, eventKey, event, group: groupForRefresh }).then(result => {
        if (result) postsRefreshed += 1;
      }).catch(error => {
        console.error(`Gruppe ${group.groupKey}: Gruppenposts konnten nach Co-VM-Änderung nicht aktualisiert werden.`, error);
      });

      groups += 1;
    }
  }

  return { groups, rolesAssigned, postsRefreshed };
}

async function reconcileActiveGroupChannels(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const guild = await getConfiguredGuild(client, settings);
  if (!guild) return 0;
  let reconciled = 0;
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (!isActiveGroupPhase(event)) continue;
    for (const group of Object.values(event.groups.groups || {})) {
      const userIds = getGroupUserIds(group);
      const overview = await ensureGroupChannel(guild, settings, group, userIds);
      const results = await ensureGroupResultsChannel(guild, settings, group, userIds);
      await ensureGroupVideoChannel(guild, settings, group);
      updateEventData(eventKey, stored => {
        const target = stored.groups?.groups?.[group.groupKey];
        if (target) {
          target.channelId = overview.id;
          target.resultsChannelId = results.id;
        }
        return stored;
      });
      await refreshGroupPosts({
        client,
        eventKey,
        event: readEventData(eventKey),
        group: { ...group, channelId: overview.id, resultsChannelId: results.id },
      });
      reconciled += 1;
    }
  }
  return reconciled;
}

module.exports = {
  reconcileActiveGroupChannels,
  syncTeamGroupAccess,
};
