'use strict';

const { findTeamById } = require('../teams/team-service');

function roleNameForGroup(groupKey) {
  return `LNC Gruppe ${groupKey}`;
}

function getTeamUserIds(team) {
  if (!team || team.isTestTeam) return [];
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

async function getConfiguredGuild(client, settings) {
  if (!client) return null;
  const guildId = settings.guild?.guildId;
  if (guildId) {
    return client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  }
  return client.guilds.cache.first() || null;
}

async function assignRoleToUser(guild, userId, roleId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.roles.cache.has(roleId)) return false;
  await member.roles.add(roleId);
  return true;
}

async function ensureGroupRole(guild, settings, groupKey) {
  const configuredRoleId = settings.roles?.groupRoleIds?.[groupKey];
  const configuredRole = configuredRoleId ? await guild.roles.fetch(configuredRoleId).catch(() => null) : null;
  if (configuredRole) return configuredRole;

  const name = roleNameForGroup(groupKey);
  const existingRole = guild.roles.cache.find(role => role.name === name);
  if (existingRole) return existingRole;

  return guild.roles.create({
    name,
    mentionable: false,
    reason: 'Loco Night Cup Phase 5 Gruppenziehung',
  });
}

async function assignGroupRoles({ client, event, settings }) {
  if (!client) return { assigned: 0, skippedGroups: [] };

  const guild = await getConfiguredGuild(client, settings || {});
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

async function ensureGroupRolesAndMembers({ client, event, settings }) {
  const guild = await getConfiguredGuild(client, settings || {});
  if (!guild) return { guild: null, updates: [], assigned: 0, skippedGroups: Object.keys(event.groups?.groups || {}) };

  const updates = [];
  const skippedGroups = [];
  let assigned = 0;

  for (const group of Object.values(event.groups?.groups || {})) {
    const role = await ensureGroupRole(guild, settings, group.groupKey).catch(() => null);
    if (!role) {
      skippedGroups.push(group.groupKey);
      continue;
    }

    group.roleId = role.id;
    updates.push({ groupKey: group.groupKey, roleId: role.id });

    for (const teamId of getGroupTeamIds(group)) {
      const team = findTeamById(teamId);
      for (const userId of getTeamUserIds(team)) {
        if (await assignRoleToUser(guild, userId, role.id).catch(() => false)) {
          assigned += 1;
        }
      }
    }
  }

  return { guild, updates, assigned, skippedGroups };
}

module.exports = {
  assignGroupRoles,
  ensureGroupRolesAndMembers,
  getConfiguredGuild,
  getGroupTeamIds,
  getTeamUserIds,
};
