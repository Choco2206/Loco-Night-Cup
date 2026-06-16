'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { removeTeamFromAllEvents } = require('../checkins/checkin-service');
const { refreshCheckinMessages } = require('../checkins/checkin-panel');
const { ensureTeamPanel } = require('./team-panel');
const { handleInteraction } = require('./team-interactions');
const { handleMessage } = require('./team-message-handler');
const { refreshRegisteredTeamsOverview } = require('./team-overview');
const { handleMemberRemoved } = require('./team-service');
const { syncAllManagerRoles, syncManagerRoleForUser } = require('./team-roles');

async function init(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());

  await ensureTeamPanel(client);
  await refreshRegisteredTeamsOverview(client);

  for (const guild of client.guilds.cache.values()) {
    await syncAllManagerRoles(guild, settings);
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
  return true;
}

module.exports = {
  handleGuildMemberRemove,
  handleInteraction,
  handleMessage,
  init,
};
