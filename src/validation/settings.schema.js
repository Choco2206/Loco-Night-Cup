'use strict';

const {
  BAN_REASONS,
  EVENT_KEYS,
  EVENT_PROFILE_BY_KEY,
  GROUP_KEYS,
  KNOCKOUT_ROUNDS,
  TOURNAMENT_FORMAT_SIZES,
} = require('../app/constants');
const {
  requireArray,
  requireNonNegativeInteger,
  requireObject,
  requireSnowflakeOrNull,
} = require('./common');

const CHAMPION_ROLE_KEYS = ['champion', 'elite', 'master', 'legend', 'immortal'];

function validateIdMap(errors, object, keys, path) {
  if (!requireObject(errors, object, path)) return;

  keys.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(object, key)) errors.push(`${path}.${key} is required`);
    requireSnowflakeOrNull(errors, object[key], `${path}.${key}`);
  });
}

function validateSettings(data) {
  const errors = [];
  if (!requireObject(errors, data, 'settings root')) return errors;
  if (data.version !== 1) errors.push('version must be 1');

  if (requireObject(errors, data.guild, 'guild')) {
    requireSnowflakeOrNull(errors, data.guild.guildId, 'guild.guildId');
  }

  if (requireObject(errors, data.roles, 'roles')) {
    requireArray(errors, data.roles.adminRoleIds, 'roles.adminRoleIds');
    requireArray(errors, data.roles.cupLeadRoleIds, 'roles.cupLeadRoleIds');
    requireSnowflakeOrNull(errors, data.roles.playerRoleId, 'roles.playerRoleId');
    requireSnowflakeOrNull(errors, data.roles.managerRoleId, 'roles.managerRoleId');
    requireSnowflakeOrNull(errors, data.roles.coManagerRoleId, 'roles.coManagerRoleId');
    validateIdMap(errors, data.roles.championRoleIds, CHAMPION_ROLE_KEYS, 'roles.championRoleIds');
    validateIdMap(errors, data.roles.groupRoleIds, GROUP_KEYS, 'roles.groupRoleIds');
    validateIdMap(errors, data.roles.knockoutRoleIds, KNOCKOUT_ROUNDS, 'roles.knockoutRoleIds');
  }

  if (requireObject(errors, data.channels, 'channels')) {
    [
      'welcomeChannelId',
      'roleSelectChannelId',
      'teamRegistrationChannelId',
      'registeredTeamsChannelId',
      'rulesChannelId',
      'banlistChannelId',
      'adminPanelChannelId',
      'announcementChannelId',
      'liveScheduleChannelId',
      'teamSearchChannelId',
      'helperSearchChannelId',
      'hallOfFameChannelId',
      'logChannelId',
      'rulebookChannelId',
      'chatChannelId',
      'cooperationChannelId',
      'feedbackChannelId',
      'managerSupportChannelId',
      'playerSearchChannelId',
      'helperAvailableChannelId',
      'knockoutOverviewChannelId',
    ].forEach(field => requireSnowflakeOrNull(errors, data.channels[field], `channels.${field}`));

    validateIdMap(errors, data.channels.checkinChannelIds, EVENT_KEYS, 'channels.checkinChannelIds');
    validateIdMap(errors, data.channels.groupChannelIds, GROUP_KEYS, 'channels.groupChannelIds');
    validateIdMap(errors, data.channels.knockoutChannelIds, KNOCKOUT_ROUNDS, 'channels.knockoutChannelIds');
  }

  if (data.assets !== undefined && data.assets !== null && requireObject(errors, data.assets, 'assets')) {
    if (data.assets.checkinBannerPath !== null && data.assets.checkinBannerPath !== undefined && typeof data.assets.checkinBannerPath !== 'string') {
      errors.push('assets.checkinBannerPath must be a string or null');
    }
  }

  if (requireObject(errors, data.categories, 'categories')) {
    [
      'welcomeCategoryId',
      'systemCategoryId',
      'accessCategoryId',
      'nightHubCategoryId',
      'managerCategoryId',
      'publicScheduleCategoryId',
      'nightEventsCategoryId',
      'searchCategoryId',
      'groupsCategoryId',
      'checkinCategoryId',
      'groupCategoryId',
      'knockoutCategoryId',
      'archiveCategoryId',
    ].forEach(field => {
      requireSnowflakeOrNull(errors, data.categories[field], `categories.${field}`);
    });
  }

  if (requireObject(errors, data.timeProfiles, 'timeProfiles')) {
    if (data.timeProfiles.timezone !== 'Europe/Berlin') errors.push('timeProfiles.timezone must be Europe/Berlin');

    if (requireObject(errors, data.timeProfiles.eventProfiles, 'timeProfiles.eventProfiles')) {
      EVENT_KEYS.forEach(eventKey => {
        if (data.timeProfiles.eventProfiles[eventKey] !== EVENT_PROFILE_BY_KEY[eventKey]) {
          errors.push(`timeProfiles.eventProfiles.${eventKey} must be ${EVENT_PROFILE_BY_KEY[eventKey]}`);
        }
      });
    }
  }

  if (requireObject(errors, data.tournament, 'tournament')) {
    if (data.tournament.minimumRealTeams !== 8) errors.push('tournament.minimumRealTeams must be 8');
    if (JSON.stringify(data.tournament.allowedSizes) !== JSON.stringify(TOURNAMENT_FORMAT_SIZES)) {
      errors.push(`tournament.allowedSizes must be [${TOURNAMENT_FORMAT_SIZES.join(',')}]`);
    }
    if (data.tournament.groupSize !== 4) errors.push('tournament.groupSize must be 4');
    if (data.tournament.thirdPlaceMatchRequired !== true) errors.push('tournament.thirdPlaceMatchRequired must be true');
    if (data.tournament.knockoutDrawsAllowed !== false) errors.push('tournament.knockoutDrawsAllowed must be false');
  }

  if (requireObject(errors, data.teams, 'teams')) {
    requireNonNegativeInteger(errors, data.teams.coManagerLimit, 'teams.coManagerLimit');
    if (data.teams.logoRequired !== true) errors.push('teams.logoRequired must be true');
  }

  if (requireObject(errors, data.checkin, 'checkin')) {
    if (data.checkin.allowMultipleEventsPerTeam !== true) errors.push('checkin.allowMultipleEventsPerTeam must be true');
    if (data.checkin.allowDuplicateCheckinPerEvent !== false) errors.push('checkin.allowDuplicateCheckinPerEvent must be false');
    if (data.checkin.waitlistIsInformationalOnly !== true) errors.push('checkin.waitlistIsInformationalOnly must be true');
    if (data.checkin.noPromotionFromWaitlist !== true) errors.push('checkin.noPromotionFromWaitlist must be true');
  }

  if (requireObject(errors, data.bans, 'bans') && requireObject(errors, data.bans.durationsDays, 'bans.durationsDays')) {
    const expected = {
      late_withdrawal: 7,
      no_show: 14,
      left_tournament: 14,
      disrespect: 14,
      admin_other: 14,
    };

    BAN_REASONS.forEach(reason => {
      if (data.bans.durationsDays[reason] !== expected[reason]) {
        errors.push(`bans.durationsDays.${reason} must be ${expected[reason]}`);
      }
    });
  }

  if (requireObject(errors, data.liveSchedule, 'liveSchedule')) {
    if (data.liveSchedule.mode !== 'mirror_only') errors.push('liveSchedule.mode must be mirror_only');
    if (data.liveSchedule.buttonsEnabled !== false) errors.push('liveSchedule.buttonsEnabled must be false');
  }

  if (requireObject(errors, data.teamSearch, 'teamSearch')) {
    if (Object.prototype.hasOwnProperty.call(data.teamSearch, 'teamSearchChannelId')) {
      errors.push('teamSearch.teamSearchChannelId must not exist; use channels.teamSearchChannelId');
    }
    if (Object.prototype.hasOwnProperty.call(data.teamSearch, 'helperSearchChannelId')) {
      errors.push('teamSearch.helperSearchChannelId must not exist; use channels.helperSearchChannelId');
    }
    if (requireObject(errors, data.teamSearch.cooldownsSeconds, 'teamSearch.cooldownsSeconds')) {
      if (data.teamSearch.cooldownsSeconds.teamSearchPost !== 21600) errors.push('teamSearch.cooldownsSeconds.teamSearchPost must be 21600');
      if (data.teamSearch.cooldownsSeconds.helperSearchPost !== 600) errors.push('teamSearch.cooldownsSeconds.helperSearchPost must be 600');
    }
  }

  return errors;
}

module.exports = {
  validateSettings,
};
