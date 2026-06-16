'use strict';

const path = require('path');
const { EVENT_KEYS } = require('../app/constants');

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');

const TEAMS_DIR = path.join(DATA_DIR, 'teams');
const TEAM_LOGOS_DIR = path.join(TEAMS_DIR, 'logos');
const EVENTS_DIR = path.join(DATA_DIR, 'events');
const BANS_DIR = path.join(DATA_DIR, 'bans');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');

const FILES = {
  teams: path.join(TEAMS_DIR, 'teams.json'),
  bans: path.join(BANS_DIR, 'bans.json'),
  messages: path.join(MESSAGES_DIR, 'messages.json'),
  settings: path.join(SETTINGS_DIR, 'settings.json'),
  events: Object.fromEntries(
    EVENT_KEYS.map(eventKey => [eventKey, path.join(EVENTS_DIR, `${eventKey}.json`)])
  ),
};

module.exports = {
  BANS_DIR,
  DATA_DIR,
  EVENTS_DIR,
  FILES,
  MESSAGES_DIR,
  ROOT_DIR,
  SETTINGS_DIR,
  TEAM_LOGOS_DIR,
  TEAMS_DIR,
};
