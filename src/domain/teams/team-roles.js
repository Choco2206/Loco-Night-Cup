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

async function syncManagerRoleForUser(guild, userId, settings) {
  const managerRoleId = settings.roles.managerRoleId;
  const playerRoleId = settings.roles.playerRoleId;
  if (!guild || !managerRoleId || !userId) return false;

  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return false;

  const shouldHaveManagerRole = userHasActiveTeamRole(userId);
  const hasManagerRole = member.roles.cache.has(managerRoleId);
  const hasPlayerRole = playerRoleId ? member.roles.cache.has(playerRoleId) : false;
  let changed = false;

  if (shouldHaveManagerRole) {
    if (hasPlayerRole) {
      await member.roles.remove(playerRoleId);
      changed = true;
    }

    if (!hasManagerRole) {
      await member.roles.add(managerRoleId);
      changed = true;
    }

    return changed;
  }

  if (hasManagerRole) {
    await member.roles.remove(managerRoleId);
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

  const userIds = new Set();
  readTeamsData().teams
    .filter(isActiveTeam)
    .forEach(team => getTeamUserIds(team).forEach(userId => userIds.add(userId)));

  await guild.members.fetch().catch(() => null);

  guild.members.cache.forEach(member => {
    if (member.roles.cache.has(managerRoleId)) {
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
