'use strict';

const { readTeamsData } = require('./team-repository');
const { isNonDeletedTeam, isTeamMember } = require('./team-service');

function getTeamUserIds(team) {
  return [
    team.manager?.userId,
    ...(Array.isArray(team.coManagers) ? team.coManagers.map(co => co.userId) : []),
  ].filter(Boolean).map(String);
}

function userHasNonDeletedTeam(userId) {
  const id = String(userId);
  return readTeamsData().teams.some(team => isNonDeletedTeam(team) && isTeamMember(team, id));
}

async function syncManagerRoleForUser(guild, userId, settings) {
  const managerRoleId = settings.roles.managerRoleId;
  if (!guild || !managerRoleId || !userId) return false;

  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return false;

  const shouldHaveRole = userHasNonDeletedTeam(userId);
  const hasRole = member.roles.cache.has(managerRoleId);

  if (shouldHaveRole && !hasRole) {
    await member.roles.add(managerRoleId);
    return true;
  }

  if (!shouldHaveRole && hasRole) {
    await member.roles.remove(managerRoleId);
    return true;
  }

  return false;
}

async function syncManagerRolesForTeam(guild, team, settings) {
  if (!team) return;

  for (const userId of getTeamUserIds(team)) {
    await syncManagerRoleForUser(guild, userId, settings);
  }
}

async function syncAllManagerRoles(guild, settings) {
  if (!guild || !settings.roles.managerRoleId) return;

  const teams = readTeamsData().teams.filter(isNonDeletedTeam);
  const userIds = new Set();

  teams.forEach(team => getTeamUserIds(team).forEach(userId => userIds.add(userId)));

  for (const userId of userIds) {
    await syncManagerRoleForUser(guild, userId, settings);
  }
}

module.exports = {
  getTeamUserIds,
  syncAllManagerRoles,
  syncManagerRoleForUser,
  syncManagerRolesForTeam,
  userHasNonDeletedTeam,
};
