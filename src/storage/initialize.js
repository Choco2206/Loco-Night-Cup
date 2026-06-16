'use strict';

const fs = require('fs');
const { EVENT_KEYS, KNOCKOUT_ROUNDS } = require('../app/constants');
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

  if (!fs.existsSync(FILES.settings)) {
    writeJsonAtomic(FILES.settings, seed);
    return seed;
  }

  const settings = readJson(FILES.settings, createSettingsDefault());
  const changed = mergeMissingSettings(settings, seed);
  if (changed) writeJsonAtomic(FILES.settings, settings);
  return settings;
}

function seedCheckinBanner() {
  if (fs.existsSync(FILES.checkinBanner)) return false;
  if (!fs.existsSync(FILES.checkinBannerSeed)) return false;

  fs.copyFileSync(FILES.checkinBannerSeed, FILES.checkinBanner);
  return true;
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
  seedCheckinBanner();

  ensureJsonFile(FILES.teams, createTeamsDefault);
  ensureJsonFile(FILES.bans, createBansDefault);
  ensureJsonFile(FILES.messages, createMessagesDefault);

  for (const eventKey of EVENT_KEYS) {
    ensureJsonFile(FILES.events[eventKey], () => createEventDefault(eventKey));
  }

  normalizeMessagesFile();
}

module.exports = {
  initializeStorage,
  mergeMissingSettings,
  normalizeMessagesFile,
  seedCheckinBanner,
  seedSettingsFile,
};
