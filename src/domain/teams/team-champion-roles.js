'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readTeamsData } = require('./team-repository');
const { getTeamTitles } = require('./team-achievements');

const CHAMPION_ELIGIBLE_ROLE_IDS = [
  '1516428922387169321',
  '1516428950992064642',
  '1517040800817610792',
];

const CHAMPION_ROLE_LEVELS = [
  { key: 'champion', threshold: 1, name: '🥇 Loco Night Champion', color: 0xf1c40f },
  { key: 'elite', threshold: 3, name: '🏆 Loco Night Elite', color: 0xe67e22 },
  { key: 'master', threshold: 5, name: '👑 Loco Night Master', color: 0x992d22 },
  { key: 'legend', threshold: 10, name: '💎 Loco Night Legend', color: 0x9b59b6 },
  { key: 'immortal', threshold: 25, name: '🌟 Loco Night Immortal', color: 0xecf0f1 },
];

function createChampionRoleIdMap() {
  return Object.fromEntries(CHAMPION_ROLE_LEVELS.map(level => [level.key, null]));
}

function normalizeChampionRoleIdMap(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(CHAMPION_ROLE_LEVELS.map(level => [
    level.key,
    source[level.key] ? String(source[level.key]) : null,
  ]));
}

function getChampionLevelForGold(goldCount) {
  const count = Number.isInteger(goldCount) ? goldCount : 0;
  return [...CHAMPION_ROLE_LEVELS].reverse().find(level => count >= level.threshold) || null;
}

function getTeamUserIds(team) {
  return [
    team?.manager?.userId,
    ...(Array.isArray(team?.coManagers) ? team.coManagers.map(coManager => coManager?.userId) : []),
  ].filter(Boolean).map(String);
}

function isActiveTeam(team) {
  return team?.status === 'active';
}

function isTeamMember(team, userId) {
  const id = String(userId);
  return getTeamUserIds(team).some(teamUserId => String(teamUserId) === id);
}

function getActiveTeamsForUser(userId) {
  return readTeamsData().teams.filter(team => isActiveTeam(team) && isTeamMember(team, userId));
}

function getTeamById(teamId) {
  const id = String(teamId);
  return readTeamsData().teams.find(team => String(team.id) === id) || null;
}

function getRequiredChampionLevelForUser(userId) {
  return getActiveTeamsForUser(userId)
    .map(team => getChampionLevelForGold(getTeamTitles(team).gold))
    .filter(Boolean)
    .sort((left, right) => right.threshold - left.threshold)[0] || null;
}

function memberHasEligibleBaseRole(member) {
  return CHAMPION_ELIGIBLE_ROLE_IDS.some(roleId => member?.roles?.cache?.has(String(roleId)));
}

async function fetchRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
}

async function findOrCreateChampionRole(guild, level, configuredRoleId) {
  const configuredRole = await fetchRole(guild, configuredRoleId);
  if (configuredRole) return configuredRole;

  const existingRole = guild.roles.cache.find(role => role.name === level.name);
  if (existingRole) return existingRole;

  try {
    return await guild.roles.create({
      name: level.name,
      color: level.color,
      hoist: true,
      mentionable: false,
      permissions: [],
      reason: 'Loco Night Champion-Rolle automatisch angelegt',
    });
  } catch (error) {
    console.warn(`[champion-roles] Rolle ${level.name} konnte nicht erstellt werden: ${error.message}`);
    return null;
  }
}

async function placeChampionRoles(guild, rolesByKey, settings) {
  const anchorRoleIds = [
    ...CHAMPION_ELIGIBLE_ROLE_IDS,
    settings.roles?.playerRoleId,
    settings.roles?.managerRoleId,
    settings.roles?.coManagerRoleId,
  ].filter(Boolean).map(String);
  const anchorRoles = anchorRoleIds
    .map(roleId => guild.roles.cache.get(roleId))
    .filter(Boolean);
  if (!anchorRoles.length) return;

  const anchorPosition = Math.max(...anchorRoles.map(role => role.position || 0));
  for (const role of Object.values(rolesByKey).filter(Boolean)) {
    if (role.position > anchorPosition) continue;
    if (role.editable === false) {
      console.warn(`[champion-roles] Rolle ${role.name} kann wegen Rollen-Hierarchie nicht verschoben werden.`);
      continue;
    }
    await role.setPosition(anchorPosition + 1, { reason: 'Loco Night Champion-Rollen sichtbar platzieren' }).catch(error => {
      console.warn(`[champion-roles] Rolle ${role.name} konnte nicht verschoben werden: ${error.message}`);
    });
  }
}

async function ensureChampionRoles(guild, settings = readJson(FILES.settings, createSettingsDefault())) {
  if (!guild) return { rolesByKey: {}, settings };
  await guild.roles.fetch().catch(() => null);

  const configuredIds = normalizeChampionRoleIdMap(settings.roles?.championRoleIds);
  const rolesByKey = {};
  let changed = false;

  for (const level of CHAMPION_ROLE_LEVELS) {
    const role = await findOrCreateChampionRole(guild, level, configuredIds[level.key]);
    rolesByKey[level.key] = role;
    if (role && configuredIds[level.key] !== String(role.id)) {
      configuredIds[level.key] = String(role.id);
      changed = true;
    }
  }

  if (changed) {
    updateJson(FILES.settings, createSettingsDefault(), current => {
      current.roles = current.roles || {};
      current.roles.championRoleIds = {
        ...normalizeChampionRoleIdMap(current.roles.championRoleIds),
        ...configuredIds,
      };
      current.meta = { ...(current.meta || {}), updatedAt: new Date().toISOString() };
      return current;
    });
    settings.roles = settings.roles || {};
    settings.roles.championRoleIds = configuredIds;
  }

  await placeChampionRoles(guild, rolesByKey, settings);
  return { rolesByKey, settings };
}

async function syncChampionRolesForUser(guild, userId, settings = readJson(FILES.settings, createSettingsDefault())) {
  if (!guild || !userId) return { changed: false, reason: 'missing_input' };

  const { rolesByKey } = await ensureChampionRoles(guild, settings);
  const championRoles = Object.values(rolesByKey).filter(Boolean);
  if (!championRoles.length) return { changed: false, reason: 'missing_roles' };

  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return { changed: false, reason: 'missing_member' };

  const targetLevel = memberHasEligibleBaseRole(member) ? getRequiredChampionLevelForUser(userId) : null;
  const targetRole = targetLevel ? rolesByKey[targetLevel.key] : null;
  let changed = false;

  for (const role of championRoles) {
    const shouldHave = targetRole && String(role.id) === String(targetRole.id);
    const hasRole = member.roles.cache.has(role.id);
    if (shouldHave && !hasRole) {
      await member.roles.add(role.id, 'Loco Night Champion-Rollen-Sync').catch(error => {
        console.warn(`[champion-roles] Rolle ${role.name} konnte User ${userId} nicht gegeben werden: ${error.message}`);
      });
      changed = true;
    } else if (!shouldHave && hasRole) {
      await member.roles.remove(role.id, 'Loco Night Champion-Rollen-Sync').catch(error => {
        console.warn(`[champion-roles] Rolle ${role.name} konnte User ${userId} nicht entfernt werden: ${error.message}`);
      });
      changed = true;
    }
  }

  return {
    changed,
    targetRoleId: targetRole?.id || null,
    targetLevelKey: targetLevel?.key || null,
  };
}

async function syncChampionRolesForUsers(guild, userIds, settings = readJson(FILES.settings, createSettingsDefault())) {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  const results = [];
  for (const userId of uniqueUserIds) {
    results.push(await syncChampionRolesForUser(guild, userId, settings));
  }
  return results;
}

async function syncChampionRolesForTeam(guild, teamOrTeamId, settings = readJson(FILES.settings, createSettingsDefault())) {
  const team = typeof teamOrTeamId === 'string' ? getTeamById(teamOrTeamId) : teamOrTeamId;
  if (!team) return [];
  return syncChampionRolesForUsers(guild, getTeamUserIds(team), settings);
}

async function syncAllChampionRoles(guild, settings = readJson(FILES.settings, createSettingsDefault())) {
  if (!guild) return [];
  const userIds = new Set();
  readTeamsData().teams
    .filter(isActiveTeam)
    .forEach(team => getTeamUserIds(team).forEach(userId => userIds.add(userId)));

  await guild.members.fetch().catch(() => null);
  const configuredIds = normalizeChampionRoleIdMap(settings.roles?.championRoleIds);
  const championRoleIds = Object.values(configuredIds).filter(Boolean).map(String);
  guild.members.cache.forEach(member => {
    if (CHAMPION_ELIGIBLE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) userIds.add(member.id);
    if (championRoleIds.some(roleId => member.roles.cache.has(roleId))) userIds.add(member.id);
  });

  return syncChampionRolesForUsers(guild, [...userIds], settings);
}

module.exports = {
  CHAMPION_ELIGIBLE_ROLE_IDS,
  CHAMPION_ROLE_LEVELS,
  createChampionRoleIdMap,
  ensureChampionRoles,
  getChampionLevelForGold,
  normalizeChampionRoleIdMap,
  syncAllChampionRoles,
  syncChampionRolesForTeam,
  syncChampionRolesForUser,
  syncChampionRolesForUsers,
};
