'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { removeTeamFromAllEvents } = require('../checkins/checkin-service');
const { refreshCheckinMessages } = require('../checkins/checkin-panel');
const { ensureMyTeamPanel, ensureTeamPanel } = require('./team-panel');
const { handleInteraction } = require('./team-interactions');
const { handleMessage } = require('./team-message-handler');
const { ensureTeamAchievementsRankingMessage } = require('./team-achievements');
const { syncAllChampionRoles, syncChampionRolesForUsers } = require('./team-champion-roles');
const { refreshRegisteredTeamsOverview } = require('./team-overview');
const { cleanupTeamsWithoutLeadership, handleMemberRemoved } = require('./team-service');
const { syncAllManagerRoles, syncManagerRoleForUser } = require('./team-roles');

async function init(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());

  await ensureTeamPanel(client);
  await ensureMyTeamPanel(client);

  const deletedTeamIds = cleanupTeamsWithoutLeadership();
  const affectedEventKeys = [];
  for (const teamId of deletedTeamIds) {
    affectedEventKeys.push(...removeTeamFromAllEvents({ teamId, settings }));
  }
  if (affectedEventKeys.length) {
    await refreshCheckinMessages([...new Set(affectedEventKeys)], client);
  }

  await refreshRegisteredTeamsOverview(client);
  await ensureTeamAchievementsRankingMessage({ client }).catch(error => {
    console.warn(`[team-achievements] Basisnachricht konnte nicht initialisiert werden: ${error.message}`);
  });

  for (const guild of client.guilds.cache.values()) {
    await syncAllManagerRoles(guild, settings);
    await syncAllChampionRoles(guild, settings);
  }
}

async function handleGuildMemberRemove(member, client) {
  if (!member?.id) return false;

  const settings = readJson(FILES.settings, createSettingsDefault());
  const result = handleMemberRemoved({ userId: member.id });
  if (!result.changed) return false;

  for (const userId of result.affectedUserIds) {
    await syncManagerRoleForUser(member.guild, userId, settings).catch(() => {});
  }

  const affectedEventKeys = [];
  for (const teamId of result.invalidTeamIds || []) {
    affectedEventKeys.push(...removeTeamFromAllEvents({ teamId, settings }));
  }

  if (affectedEventKeys.length) {
    await refreshCheckinMessages([...new Set(affectedEventKeys)], client);
  }

  await refreshRegisteredTeamsOverview(client);
  await syncChampionRolesForUsers(member.guild, result.affectedUserIds, settings);
  return true;
}

module.exports = {
  handleGuildMemberRemove,
  handleInteraction,
  handleMessage,
  init,
};
