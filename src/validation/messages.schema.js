'use strict';

const { EVENT_KEYS, GROUP_KEYS, KNOCKOUT_ROUNDS } = require('../app/constants');
const {
  requireArray,
  requireObject,
  requireSnowflakeOrNull,
} = require('./common');

function validateMessageRef(errors, ref, path, fields = ['channelId', 'messageId']) {
  if (!requireObject(errors, ref, path)) return;
  fields.forEach(field => requireSnowflakeOrNull(errors, ref[field], `${path}.${field}`));
}

function validateEventMap(errors, object, path) {
  if (!requireObject(errors, object, path)) return false;

  for (const eventKey of EVENT_KEYS) {
    if (!object[eventKey]) errors.push(`${path}.${eventKey} is required`);
  }

  return true;
}

function validateMessages(data) {
  const errors = [];
  if (!requireObject(errors, data, 'messages root')) return errors;
  if (data.version !== 1) errors.push('version must be 1');
  requireSnowflakeOrNull(errors, data.guildId, 'guildId');

  validateMessageRef(errors, data.setup?.welcome, 'setup.welcome');
  validateMessageRef(errors, data.roles?.roleSelect, 'roles.roleSelect');
  if (data.roles?.roleSelectPanel !== undefined) {
    validateMessageRef(errors, data.roles.roleSelectPanel, 'roles.roleSelectPanel');
  }
  validateMessageRef(errors, data.teams?.registrationPanel, 'teams.registrationPanel');
  validateMessageRef(errors, data.teams?.myTeamPanel, 'teams.myTeamPanel');

  if (requireObject(errors, data.teams?.registeredTeamsOverview, 'teams.registeredTeamsOverview')) {
    requireSnowflakeOrNull(errors, data.teams.registeredTeamsOverview.channelId, 'teams.registeredTeamsOverview.channelId');
    requireSnowflakeOrNull(errors, data.teams.registeredTeamsOverview.headerMessageId, 'teams.registeredTeamsOverview.headerMessageId');
    requireArray(errors, data.teams.registeredTeamsOverview.listMessageIds, 'teams.registeredTeamsOverview.listMessageIds');
  }

  if (requireObject(errors, data.teams?.teamAchievements, 'teams.teamAchievements')) {
    requireSnowflakeOrNull(errors, data.teams.teamAchievements.channelId, 'teams.teamAchievements.channelId');
    requireArray(errors, data.teams.teamAchievements.messageIds, 'teams.teamAchievements.messageIds');
  }

  if (validateEventMap(errors, data.checkins, 'checkins')) {
    EVENT_KEYS.forEach(eventKey => {
      const ref = data.checkins[eventKey];
      if (!requireObject(errors, ref, `checkins.${eventKey}`)) return;
      requireSnowflakeOrNull(errors, ref.channelId, `checkins.${eventKey}.channelId`);
      requireSnowflakeOrNull(errors, ref.mainMessageId, `checkins.${eventKey}.mainMessageId`);
      requireArray(errors, ref.teamsListMessageIds, `checkins.${eventKey}.teamsListMessageIds`);
      requireArray(errors, ref.waitlistMessageIds, `checkins.${eventKey}.waitlistMessageIds`);
      requireSnowflakeOrNull(errors, ref.warningMessageId, `checkins.${eventKey}.warningMessageId`);
      requireSnowflakeOrNull(errors, ref.summaryMessageId, `checkins.${eventKey}.summaryMessageId`);
    });
  }

  if (requireObject(errors, data.liveSchedule, 'liveSchedule')) {
    requireSnowflakeOrNull(errors, data.liveSchedule.channelId, 'liveSchedule.channelId');
    if (![null, 'groups', 'knockout', 'ceremony'].includes(data.liveSchedule.phase)) {
      errors.push('liveSchedule.phase must be null, groups, knockout, or ceremony');
    }
  }

  if (validateEventMap(errors, data.groups, 'groups')) {
    EVENT_KEYS.forEach(eventKey => {
      const eventGroups = data.groups[eventKey];
      if (!requireObject(errors, eventGroups, `groups.${eventKey}`)) return;
      if (eventGroups.cycleKey !== null && typeof eventGroups.cycleKey !== 'string') errors.push(`groups.${eventKey}.cycleKey must be string or null`);
      if (!requireObject(errors, eventGroups.groups, `groups.${eventKey}.groups`)) return;
      Object.keys(eventGroups.groups).forEach(groupKey => {
        if (!GROUP_KEYS.includes(groupKey)) errors.push(`groups.${eventKey}.groups.${groupKey} is not a valid group key`);
      });
    });
  }

  if (validateEventMap(errors, data.knockout, 'knockout')) {
    EVENT_KEYS.forEach(eventKey => {
      const eventKo = data.knockout[eventKey];
      if (!requireObject(errors, eventKo, `knockout.${eventKey}`)) return;
      if (eventKo.cycleKey !== null && typeof eventKo.cycleKey !== 'string') errors.push(`knockout.${eventKey}.cycleKey must be string or null`);
      if (!requireObject(errors, eventKo.rounds, `knockout.${eventKey}.rounds`)) return;
      KNOCKOUT_ROUNDS.forEach(roundKey => {
        const round = eventKo.rounds[roundKey];
        if (!requireObject(errors, round, `knockout.${eventKey}.rounds.${roundKey}`)) return;
        requireSnowflakeOrNull(errors, round.channelId, `knockout.${eventKey}.rounds.${roundKey}.channelId`);
        requireSnowflakeOrNull(errors, round.messageId, `knockout.${eventKey}.rounds.${roundKey}.messageId`);
        requireSnowflakeOrNull(errors, round.releaseMessageId, `knockout.${eventKey}.rounds.${roundKey}.releaseMessageId`);
        requireArray(errors, round.reminderMessageIds, `knockout.${eventKey}.rounds.${roundKey}.reminderMessageIds`);
      });
    });
  }

  if (requireObject(errors, data.banlist, 'banlist')) {
    ['channelId', 'infoMessageId', 'listMessageId'].forEach(field => {
      requireSnowflakeOrNull(errors, data.banlist[field], `banlist.${field}`);
    });
  }

  validateMessageRef(errors, data.admin?.panel, 'admin.panel');
  if (requireObject(errors, data.admin?.managersWithoutTeam, 'admin.managersWithoutTeam')) {
    requireSnowflakeOrNull(errors, data.admin.managersWithoutTeam.channelId, 'admin.managersWithoutTeam.channelId');
    requireArray(errors, data.admin.managersWithoutTeam.messageIds, 'admin.managersWithoutTeam.messageIds');
  }

  if (validateEventMap(errors, data.ceremony, 'ceremony')) {
    EVENT_KEYS.forEach(eventKey => {
      const ceremony = data.ceremony[eventKey];
      if (!requireObject(errors, ceremony, `ceremony.${eventKey}`)) return;
      ['channelId', 'imageMessageId', 'textMessageId'].forEach(field => {
        requireSnowflakeOrNull(errors, ceremony[field], `ceremony.${eventKey}.${field}`);
      });
      requireArray(errors, ceremony.testMessageIds, `ceremony.${eventKey}.testMessageIds`);
    });
  }

  return errors;
}

module.exports = {
  validateMessages,
};
