'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData } = require('../events/event-repository');
const { ensureGroupChannel, ensureGroupVideoChannel, getGroupUserIds } = require('./group-channels');
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
    await member.roles.add(group.roleId, 'Loco Night Cup Gruppenrechte nach Co-VM-Aenderung').then(() => {
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
        console.error(`Gruppe ${group.groupKey}: Gruppenrechte konnten nach Co-VM-Aenderung nicht synchronisiert werden.`, error);
        return null;
      });
      await ensureGroupVideoChannel(targetGuild, settings, group).catch(error => {
        console.error(`Gruppe ${group.groupKey}: Gruessenvideo-Kanal konnte nicht synchronisiert werden.`, error);
        return null;
      });
      const groupForRefresh = channel?.id ? { ...group, channelId: channel.id } : group;
      await refreshGroupPosts({ client, eventKey, event, group: groupForRefresh }).then(result => {
        if (result) postsRefreshed += 1;
      }).catch(error => {
        console.error(`Gruppe ${group.groupKey}: Gruppenposts konnten nach Co-VM-Aenderung nicht aktualisiert werden.`, error);
      });

      groups += 1;
    }
  }

  return { groups, rolesAssigned, postsRefreshed };
}

module.exports = {
  syncTeamGroupAccess,
};

