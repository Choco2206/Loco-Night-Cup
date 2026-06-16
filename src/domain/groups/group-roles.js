'use strict';

const { findTeamById } = require('../teams/team-service');

function getTeamUserIds(team) {
  const ids = [];
  if (team?.manager?.userId) ids.push(String(team.manager.userId));
  for (const coManager of team?.coManagers || []) {
    if (coManager?.userId) ids.push(String(coManager.userId));
  }
  return [...new Set(ids)];
}

function getGroupTeamIds(group) {
  return (group.slots || [])
    .filter(slot => slot.type === 'team' && slot.teamId)
    .map(slot => String(slot.teamId));
}

async function assignRoleToUser(guild, userId, roleId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.roles.cache.has(roleId)) return false;
  await member.roles.add(roleId);
  return true;
}

async function assignGroupRoles({ client, event }) {
  if (!client) return { assigned: 0, skippedGroups: [] };

  const guild = client.guilds.cache.first();
  if (!guild) return { assigned: 0, skippedGroups: Object.keys(event.groups?.groups || {}) };

  let assigned = 0;
  const skippedGroups = [];

  for (const group of Object.values(event.groups?.groups || {})) {
    if (!group.roleId) {
      skippedGroups.push(group.groupKey);
      continue;
    }

    for (const teamId of getGroupTeamIds(group)) {
      const team = findTeamById(teamId);
      for (const userId of getTeamUserIds(team)) {
        if (await assignRoleToUser(guild, userId, group.roleId).catch(() => false)) {
          assigned += 1;
        }
      }
    }
  }

  return { assigned, skippedGroups };
}

module.exports = {
  assignGroupRoles,
};
