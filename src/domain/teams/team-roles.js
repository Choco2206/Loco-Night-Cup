'use strict';

const { readTeamsData } = require('./team-repository');
const { isTeamMember } = require('./team-service');

function getTeamUserIds(team) {
  return [
    team.manager?.userId,
    ...(Array.isArray(team.coManagers) ? team.coManagers.map(co => co.userId) : []),
  ].filter(Boolean).map(String);
}

function isActiveTeam(team) {
  return team && team.status === 'active';
}

function userHasActiveTeamRole(userId) {
  const id = String(userId);
  return readTeamsData().teams.some(team => isActiveTeam(team) && isTeamMember(team, id));
}

async function getRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
}

async function syncManagerRoleForUser(guild, userId, settings) {
  const managerRoleId = settings.roles.managerRoleId;
  const playerRoleId = settings.roles.playerRoleId;
  if (!guild || !managerRoleId || !userId) return false;

  const managerRole = await getRole(guild, managerRoleId);
  if (!managerRole) return false;

  const playerRole = await getRole(guild, playerRoleId);
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return false;

  const shouldHaveManagerRole = userHasActiveTeamRole(userId);
  const hasManagerRole = member.roles.cache.has(managerRole.id);
  const hasPlayerRole = playerRole ? member.roles.cache.has(playerRole.id) : false;
  let changed = false;

  if (shouldHaveManagerRole) {
    if (hasPlayerRole) {
      await member.roles.remove(playerRole.id).catch(() => {});
      changed = true;
    }

    if (!hasManagerRole) {
      await member.roles.add(managerRole.id).catch(() => {});
      changed = true;
    }

    return changed;
  }

  if (hasManagerRole) {
    await member.roles.remove(managerRole.id).catch(() => {});
    changed = true;
  }

  return changed;
}

async function syncManagerRolesForTeam(guild, team, settings) {
  if (!team) return;

  for (const userId of getTeamUserIds(team)) {
    await syncManagerRoleForUser(guild, userId, settings);
  }
}

async function syncAllManagerRoles(guild, settings) {
  const managerRoleId = settings.roles.managerRoleId;
  if (!guild || !managerRoleId) return;

  const managerRole = await getRole(guild, managerRoleId);
  if (!managerRole) return;

  const userIds = new Set();
  readTeamsData().teams
    .filter(isActiveTeam)
    .forEach(team => getTeamUserIds(team).forEach(userId => userIds.add(userId)));

  await guild.members.fetch().catch(() => null);

  guild.members.cache.forEach(member => {
    if (member.roles.cache.has(managerRole.id)) {
      userIds.add(member.id);
    }
  });

  for (const userId of userIds) {
    await syncManagerRoleForUser(guild, userId, settings);
  }
}

module.exports = {
  getTeamUserIds,
  syncAllManagerRoles,
  syncManagerRoleForUser,
  syncManagerRolesForTeam,
  userHasActiveTeamRole,
};
