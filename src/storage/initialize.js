'use strict';

const fs = require('fs');
const {
  EVENT_KEYS,
  EVENT_PROFILE_BY_KEY,
  KNOCKOUT_ROUNDS,
  TOURNAMENT_FORMAT_SIZES,
  TOURNAMENT_FORMATS,
} = require('../app/constants');
const {
  BANS_DIR,
  DATA_ASSETS_DIR,
  DATA_DIR,
  EVENTS_DIR,
  FILES,
  MESSAGES_DIR,
  SETTINGS_DIR,
  TEAM_LOGOS_DIR,
  TEAMS_DIR,
} = require('./paths');
const {
  createBansDefault,
  createEventDefault,
  createMessagesDefault,
  createSettingsDefault,
  createTeamsDefault,
} = require('./defaults');
const { ensureDir, ensureJsonFile, readJson, writeJsonAtomic } = require('./json-store');
const { ensureEventCycle } = require('../domain/checkins/checkin-schedule');

const UNIFIED_NIGHT_PROFILE = {
  deadlineTime: '23:30',
  lateWindowUntilTime: '23:45',
  drawTime: '23:50',
  tournamentStartTime: '00:00',
  startIsNextDay: true,
};

function emptyPanelMessage() {
  return {
    channelId: null,
    messageId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function mergeMissingSettings(target, seed) {
  if (!isPlainObject(seed) || !isPlainObject(target)) return false;

  let changed = false;

  Object.entries(seed).forEach(([key, seedValue]) => {
    const currentValue = target[key];

    if (currentValue === undefined) {
      target[key] = cloneJson(seedValue);
      changed = true;
      return;
    }

    if (currentValue === null && seedValue !== null && seedValue !== undefined) {
      target[key] = cloneJson(seedValue);
      changed = true;
      return;
    }

    if (Array.isArray(currentValue)) return;

    if (isPlainObject(currentValue) && isPlainObject(seedValue)) {
      changed = mergeMissingSettings(currentValue, seedValue) || changed;
    }
  });

  return changed;
}

function isConfiguredCheckinMap(map) {
  return isPlainObject(map) && EVENT_KEYS.every(eventKey => typeof map[eventKey] === 'string' && map[eventKey].trim());
}

function repairCheckinChannelIdsFromSeed(settings, seed) {
  const seedMap = seed?.channels?.checkinChannelIds;
  if (!isConfiguredCheckinMap(seedMap)) return false;

  settings.channels = settings.channels || {};
  settings.channels.checkinChannelIds = settings.channels.checkinChannelIds || {};

  const currentMap = settings.channels.checkinChannelIds;
  const currentIds = EVENT_KEYS.map(eventKey => currentMap[eventKey]).filter(Boolean).map(String);
  const hasMissing = EVENT_KEYS.some(eventKey => !currentMap[eventKey]);
  const hasSharedLegacyChannel = currentIds.length > 1 && new Set(currentIds).size === 1;

  if (!hasMissing && !hasSharedLegacyChannel) return false;

  for (const eventKey of EVENT_KEYS) {
    currentMap[eventKey] = String(seedMap[eventKey]);
  }
  return true;
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => Number(value) === Number(right[index]));
}

function migrateAllowedSizes(container) {
  if (!isPlainObject(container)) return false;
  if (arraysEqual(container.allowedSizes, TOURNAMENT_FORMAT_SIZES)) return false;

  container.allowedSizes = [...TOURNAMENT_FORMAT_SIZES];
  return true;
}

function migrateQualificationRules(settings) {
  if (!isPlainObject(settings?.tournament)) return false;

  const expectedRules = Object.fromEntries(
    TOURNAMENT_FORMAT_SIZES.map(size => [String(size), TOURNAMENT_FORMATS[size].rule])
  );

  if (JSON.stringify(settings.tournament.qualificationRules || {}) === JSON.stringify(expectedRules)) return false;
  settings.tournament.qualificationRules = expectedRules;
  return true;
}

function migrateTournamentFormatSettings(settings) {
  if (!isPlainObject(settings)) return false;
  settings.tournament = isPlainObject(settings.tournament) ? settings.tournament : {};
  let changed = false;
  changed = migrateAllowedSizes(settings.tournament) || changed;
  changed = migrateQualificationRules(settings) || changed;
  return changed;
}

function migrateUnifiedNightScheduleSettings(settings) {
  if (!isPlainObject(settings)) return false;

  settings.timeProfiles = isPlainObject(settings.timeProfiles) ? settings.timeProfiles : {};
  settings.timeProfiles.eventProfiles = isPlainObject(settings.timeProfiles.eventProfiles)
    ? settings.timeProfiles.eventProfiles
    : {};
  settings.timeProfiles.profiles = isPlainObject(settings.timeProfiles.profiles)
    ? settings.timeProfiles.profiles
    : {};

  let changed = false;

  for (const eventKey of EVENT_KEYS) {
    const expectedProfile = 'weekend_night';
    if (settings.timeProfiles.eventProfiles[eventKey] !== expectedProfile) {
      settings.timeProfiles.eventProfiles[eventKey] = expectedProfile;
      changed = true;
    }
  }

  for (const profileKey of ['early', 'weekend_night']) {
    const profile = isPlainObject(settings.timeProfiles.profiles[profileKey])
      ? settings.timeProfiles.profiles[profileKey]
      : {};

    for (const [field, value] of Object.entries(UNIFIED_NIGHT_PROFILE)) {
      if (profile[field] !== value) {
        profile[field] = value;
        changed = true;
      }
    }

    settings.timeProfiles.profiles[profileKey] = profile;
  }

  return changed;
}

function migrateEventFormat(event) {
  if (!isPlainObject(event)) return false;
  event.format = isPlainObject(event.format) ? event.format : {};
  return migrateAllowedSizes(event.format);
}

function readSettingsSeed() {
  return fs.existsSync(FILES.settingsSeed)
    ? readJson(FILES.settingsSeed, createSettingsDefault())
    : createSettingsDefault();
}

function ensureEventKeys(object, factory) {
  let changed = false;

  for (const eventKey of EVENT_KEYS) {
    if (!object[eventKey]) {
      object[eventKey] = factory(eventKey);
      changed = true;
    }
  }

  return changed;
}

function ensureKnockoutRounds(rounds) {
  let changed = false;

  for (const roundKey of KNOCKOUT_ROUNDS) {
    if (!rounds[roundKey]) {
      rounds[roundKey] = {
        channelId: null,
        messageId: null,
        releaseMessageId: null,
        reminderMessageIds: [],
        createdAt: null,
        updatedAt: null,
      };
      changed = true;
    }
  }

  return changed;
}

function seedSettingsFile() {
  const seed = readSettingsSeed();
  migrateTournamentFormatSettings(seed);
  ensureChampionRoleIds(seed);

  if (!fs.existsSync(FILES.settings)) {
    writeJsonAtomic(FILES.settings, seed);
    return seed;
  }

  const settings = readJson(FILES.settings, createSettingsDefault());
  let changed = false;
  changed = mergeMissingSettings(settings, seed) || changed;
  changed = repairCheckinChannelIdsFromSeed(settings, seed) || changed;
  changed = migrateUnifiedNightScheduleSettings(settings) || changed;
  changed = migrateTournamentFormatSettings(settings) || changed;
  changed = ensureChampionRoleIds(settings) || changed;
  if (changed) writeJsonAtomic(FILES.settings, settings);
  return settings;
}

function ensureChampionRoleIds(settings) {
  settings.roles = settings.roles || {};
  const hadInvalidMap = !isPlainObject(settings.roles.championRoleIds);
  settings.roles.championRoleIds = hadInvalidMap ? {} : settings.roles.championRoleIds;
  const keys = ['champion', 'elite', 'master', 'legend', 'immortal'];
  let changed = hadInvalidMap;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(settings.roles.championRoleIds, key)) {
      settings.roles.championRoleIds[key] = null;
      changed = true;
    }
  }

  return changed;
}

function removeLegacyResetTimeFromSettings(settings) {
  let changed = false;
  const profiles = settings.timeProfiles?.profiles || {};

  for (const profile of Object.values(profiles)) {
    if (!isPlainObject(profile) || !Object.prototype.hasOwnProperty.call(profile, 'resetTime')) continue;
    delete profile.resetTime;
    changed = true;
  }

  return changed;
}

function removeLegacyResetTimeFromSettingsFile() {
  const settings = readJson(FILES.settings, createSettingsDefault());
  let changed = false;
  changed = removeLegacyResetTimeFromSettings(settings) || changed;
  changed = migrateUnifiedNightScheduleSettings(settings) || changed;
  if (changed) writeJsonAtomic(FILES.settings, settings);
  return changed;
}

function migrateEventScheduleDefaults(eventKey, event) {
  if (!isPlainObject(event)) return false;

  event.schedule = isPlainObject(event.schedule) ? event.schedule : {};
  let changed = false;

  const expected = {
    profile: EVENT_PROFILE_BY_KEY[eventKey],
    deadlineTime: UNIFIED_NIGHT_PROFILE.deadlineTime,
    lateWindowUntilTime: UNIFIED_NIGHT_PROFILE.lateWindowUntilTime,
    drawTime: UNIFIED_NIGHT_PROFILE.drawTime,
    tournamentStartTime: UNIFIED_NIGHT_PROFILE.tournamentStartTime,
  };

  for (const [field, value] of Object.entries(expected)) {
    if (event.schedule[field] !== value) {
      event.schedule[field] = value;
      changed = true;
    }
  }

  return changed;
}

function seedCheckinBanner() {
  if (fs.existsSync(FILES.checkinBanner)) return false;
  if (!fs.existsSync(FILES.checkinBannerSeed)) return false;

  fs.copyFileSync(FILES.checkinBannerSeed, FILES.checkinBanner);
  return true;
}

function normalizeLegacyBye(bye, eventKey, index) {
  const normalized = isPlainObject(bye) ? bye : { legacyValue: bye };
  let changed = normalized !== bye;

  if (!normalized.id || typeof normalized.id !== 'string') {
    normalized.id = `bye_${eventKey}_${index + 1}`;
    changed = true;
  }

  if (!normalized.type) {
    normalized.type = 'bye';
    changed = true;
  }

  if (!['active', 'removed'].includes(normalized.status)) {
    normalized.status = 'active';
    changed = true;
  }

  if (!normalized.displayName) {
    normalized.displayName = normalized.name || 'Freilos';
    changed = true;
  }

  return { bye: normalized, changed };
}

function normalizeEventFile(eventKey) {
  const event = readJson(FILES.events[eventKey], createEventDefault(eventKey));
  const settings = readJson(FILES.settings, createSettingsDefault());
  let changed = false;

  if (event.schedule && Object.prototype.hasOwnProperty.call(event.schedule, 'resetTime')) {
    delete event.schedule.resetTime;
    changed = true;
  }

  changed = migrateEventScheduleDefaults(eventKey, event) || changed;

  if (!Array.isArray(event.byes)) {
    event.byes = [];
    changed = true;
  }

  changed = migrateEventFormat(event) || changed;

  event.ceremony = isPlainObject(event.ceremony) ? event.ceremony : createEventDefault(eventKey).ceremony;
  if (!isPlainObject(event.ceremony.teamAchievements)) {
    event.ceremony.teamAchievements = {
      appliedAt: null,
      placements: {
        gold: null,
        silver: null,
        bronze: null,
      },
      championPromotion: null,
    };
    changed = true;
  }
  if (!isPlainObject(event.ceremony.teamAchievements.placements)) {
    event.ceremony.teamAchievements.placements = {
      gold: null,
      silver: null,
      bronze: null,
    };
    changed = true;
  }
  if (!Object.prototype.hasOwnProperty.call(event.ceremony.teamAchievements, 'championPromotion')) {
    event.ceremony.teamAchievements.championPromotion = null;
    changed = true;
  }
  if (!isPlainObject(event.ceremony.teamStats)) {
    event.ceremony.teamStats = {
      appliedAt: null,
      participantTeamIds: [],
      matchCount: 0,
    };
    changed = true;
  }
  if (!Array.isArray(event.ceremony.teamStats.participantTeamIds)) {
    event.ceremony.teamStats.participantTeamIds = [];
    changed = true;
  }
  if (!Number.isInteger(event.ceremony.teamStats.matchCount) || event.ceremony.teamStats.matchCount < 0) {
    event.ceremony.teamStats.matchCount = 0;
    changed = true;
  }

  event.byes = event.byes.map((bye, index) => {
    const result = normalizeLegacyBye(bye, eventKey, index);
    changed = result.changed || changed;
    return result.bye;
  });

  changed = ensureEventCycle(eventKey, event, settings) || changed;

  if (changed) writeJsonAtomic(FILES.events[eventKey], event);
  return event;
}

function normalizeEventFiles() {
  return EVENT_KEYS.map(eventKey => normalizeEventFile(eventKey));
}

function normalizeMessagesFile() {
  const messages = readJson(FILES.messages, createMessagesDefault());
  let changed = false;

  if (!messages.roles) {
    messages.roles = {};
    changed = true;
  }

  if (!messages.roles.roleSelect) {
    messages.roles.roleSelect = emptyPanelMessage();
    changed = true;
  }

  if (!messages.roles.roleSelectPanel) {
    messages.roles.roleSelectPanel = { ...emptyPanelMessage(), ...messages.roles.roleSelect };
    changed = true;
  }

  if (!messages.admin) {
    messages.admin = {};
    changed = true;
  }

  if (!messages.admin.panel) {
    messages.admin.panel = emptyPanelMessage();
    changed = true;
  }

  if (!messages.admin.managersWithoutTeam) {
    messages.admin.managersWithoutTeam = {
      channelId: null,
      messageIds: [],
      createdAt: null,
      updatedAt: null,
    };
    changed = true;
  }

  if (!Array.isArray(messages.admin.managersWithoutTeam.messageIds)) {
    messages.admin.managersWithoutTeam.messageIds = [];
    changed = true;
  }

  messages.teams = messages.teams || {};
  if (!messages.teams.teamAchievements) {
    messages.teams.teamAchievements = {
      channelId: null,
      messageIds: [],
      createdAt: null,
      updatedAt: null,
    };
    changed = true;
  }

  if (!Array.isArray(messages.teams.teamAchievements.messageIds)) {
    messages.teams.teamAchievements.messageIds = [];
    changed = true;
  }

  if (!messages.checkins) {
    messages.checkins = {};
    changed = true;
  }

  if (!messages.groups) {
    messages.groups = {};
    changed = true;
  }

  if (!messages.knockout) {
    messages.knockout = {};
    changed = true;
  }

  if (!messages.ceremony) {
    messages.ceremony = {};
    changed = true;
  }

  changed = ensureEventKeys(messages.checkins, () => ({
    channelId: null,
    mainMessageId: null,
    teamsListMessageIds: [],
    waitlistMessageIds: [],
    warningMessageId: null,
    summaryMessageId: null,
    createdAt: null,
    updatedAt: null,
  })) || changed;

  changed = ensureEventKeys(messages.groups, () => ({
    cycleKey: null,
    groups: {},
  })) || changed;

  changed = ensureEventKeys(messages.knockout, () => ({
    cycleKey: null,
    rounds: {},
  })) || changed;

  changed = ensureEventKeys(messages.ceremony, () => ({
    cycleKey: null,
    channelId: null,
    imageMessageId: null,
    textMessageId: null,
    testMessageIds: [],
    postedAt: null,
    updatedAt: null,
  })) || changed;

  for (const eventKey of EVENT_KEYS) {
    if (!messages.knockout[eventKey].rounds) {
      messages.knockout[eventKey].rounds = {};
      changed = true;
    }

    changed = ensureKnockoutRounds(messages.knockout[eventKey].rounds) || changed;
  }

  if (changed) {
    writeJsonAtomic(FILES.messages, messages);
  }

  return messages;
}

function initializeStorage() {
  [
    DATA_DIR,
    DATA_ASSETS_DIR,
    TEAMS_DIR,
    TEAM_LOGOS_DIR,
    EVENTS_DIR,
    BANS_DIR,
    MESSAGES_DIR,
    SETTINGS_DIR,
  ].forEach(ensureDir);

  seedSettingsFile();
  removeLegacyResetTimeFromSettingsFile();
  seedCheckinBanner();

  ensureJsonFile(FILES.teams, createTeamsDefault);
  ensureJsonFile(FILES.bans, createBansDefault);
  ensureJsonFile(FILES.messages, createMessagesDefault);

  for (const eventKey of EVENT_KEYS) {
    ensureJsonFile(FILES.events[eventKey], () => createEventDefault(eventKey));
  }

  normalizeEventFiles();
  normalizeMessagesFile();
}

module.exports = {
  initializeStorage,
  mergeMissingSettings,
  migrateEventFormat,
  migrateUnifiedNightScheduleSettings,
  migrateTournamentFormatSettings,
  normalizeEventFile,
  normalizeEventFiles,
  normalizeMessagesFile,
  seedCheckinBanner,
  seedSettingsFile,
};
