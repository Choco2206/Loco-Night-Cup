const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const LOGOS_DIR = path.join(DATA_DIR, 'logos');

const FILES = {
  config: path.join(DATA_DIR, 'config.json'),
  setupMessages: path.join(DATA_DIR, 'setup-messages.json'),
  teams: path.join(DATA_DIR, 'teams.json'),
  checkins: path.join(DATA_DIR, 'checkins.json'),
  groups: path.join(DATA_DIR, 'groups.json'),
  results: path.join(DATA_DIR, 'results.json'),
};

module.exports = {
  DATA_DIR,
  LOGOS_DIR,
  FILES,
};