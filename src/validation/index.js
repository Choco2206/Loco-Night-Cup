'use strict';

const { EVENT_KEYS } = require('../app/constants');
const { FILES, readJson } = require('../storage');
const { validateBans } = require('./bans.schema');
const { validateEvent } = require('./events.schema');
const { validateMessages } = require('./messages.schema');
const { validateSettings } = require('./settings.schema');
const { validateTeams } = require('./teams.schema');

function throwIfInvalid(label, errors) {
  if (!errors.length) return;

  const error = new Error(`${label} validation failed:\n- ${errors.join('\n- ')}`);
  error.validationErrors = errors;
  throw error;
}

function validateAllStorage() {
  const teams = readJson(FILES.teams);
  const bans = readJson(FILES.bans);
  const messages = readJson(FILES.messages);
  const settings = readJson(FILES.settings);

  throwIfInvalid('teams.json', validateTeams(teams));
  throwIfInvalid('bans.json', validateBans(bans));
  throwIfInvalid('messages.json', validateMessages(messages));
  throwIfInvalid('settings.json', validateSettings(settings));

  for (const eventKey of EVENT_KEYS) {
    const event = readJson(FILES.events[eventKey]);
    throwIfInvalid(`events/${eventKey}.json`, validateEvent(event, eventKey));
  }
}

module.exports = {
  throwIfInvalid,
  validateAllStorage,
  validateBans,
  validateEvent,
  validateMessages,
  validateSettings,
  validateTeams,
};
