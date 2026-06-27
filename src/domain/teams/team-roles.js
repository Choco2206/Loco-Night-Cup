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

function userIsActiveManager(userId) {
  const id = String(userId);
  return readTeamsData().teams.some(team => isActiveTeam(team) && String(team.manager?.userId) === id);
}

function userIsActiveCoManager(userId) {
  const id = String(userId);
  return readTeamsData().teams.some(team => (
    isActiveTeam(team)
    && Array.isArray(team.coManagers)
    && team.coManagers.some(co => String(co.userId) === id)
  ));
}

async function getRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
}

async function syncRoleMembership(member, role, shouldHave) {
  if (!member || !role) return false;
  const hasRole = member.roles.cache.has(role.id);
  if (shouldHave && !hasRole) {
    await member.roles.add(role.id);
    return true;
  }
  if (!shouldHave && hasRole) {
    await member.roles.remove(role.id);
    return true;
  }
  return false;
}

async function syncManagerRoleForUser(guild, userId, settings, options = {}) {
  const managerRoleId = settings.roles.managerRoleId;
  const playerRoleId = settings.roles.playerRoleId;
  const preserveManagerIntent = options.preserveManagerIntent === true;
  if (!guild || !managerRoleId || !userId) return false;

  const managerRole = await getRole(guild, managerRoleId);
  if (!managerRole) return false;

  const playerRole = await getRole(guild, playerRoleId);
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return false;

  const hasTeamFunction = userHasActiveTeamRole(userId);
  const hasManagerRole = member.roles.cache.has(managerRole.id);
  const hasPlayerRole = playerRole ? member.roles.cache.has(playerRole.id) : false;
  let changed = false;

  if (hasTeamFunction) {
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

  if (preserveManagerIntent) return changed;

  if (hasManagerRole) {
    await member.roles.remove(managerRole.id).catch(() => {});
    changed = true;
  }

  return changed;
}

async function syncTeamFunctionRolesForUser(guild, userId, settings, options = {}) {
  const managerRoleId = settings.roles.managerRoleId;
  const coManagerRoleId = settings.roles.coManagerRoleId;
  const playerRoleId = settings.roles.playerRoleId;
  const preserveManagerIntent = options.preserveManagerIntent === true;
  if (!guild || !userId) return false;

  const managerRole = await getRole(guild, managerRoleId);
  const coManagerRole = await getRole(guild, coManagerRoleId);
  const playerRole = await getRole(guild, playerRoleId);
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return false;

  const shouldHaveManager = userIsActiveManager(userId);
  const shouldHaveCoManager = userIsActiveCoManager(userId);
  const hasAnyTeamFunction = shouldHaveManager || shouldHaveCoManager;
  let changed = false;

  if (managerRole) {
    changed = await syncRoleMembership(member, managerRole, hasAnyTeamFunction || (preserveManagerIntent && member.roles.cache.has(managerRole.id))) || changed;
  }
  if (coManagerRole) {
    changed = await syncRoleMembership(member, coManagerRole, shouldHaveCoManager) || changed;
  }
  if (playerRole && hasAnyTeamFunction && member.roles.cache.has(playerRole.id)) {
    await member.roles.remove(playerRole.id);
    changed = true;
  }

  return changed;
}

async function syncManagerRolesForTeam(guild, team, settings) {
  if (!team) return;

  for (const userId of getTeamUserIds(team)) {
    await syncTeamFunctionRolesForUser(guild, userId, settings);
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
    await syncTeamFunctionRolesForUser(guild, userId, settings, { preserveManagerIntent: true });
  }
}

module.exports = {
  getTeamUserIds,
  syncAllManagerRoles,
  syncManagerRoleForUser,
  syncManagerRolesForTeam,
  syncTeamFunctionRolesForUser,
  userHasActiveTeamRole,
};
