'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createEventDefault } = require('../../storage/defaults');

function assertEventKey(eventKey) {
  if (!EVENT_KEYS.includes(eventKey)) {
    throw new Error(`Unknown event key: ${eventKey}`);
  }
}

function readEventData(eventKey) {
  assertEventKey(eventKey);
  return readJson(FILES.events[eventKey], createEventDefault(eventKey));
}

function updateEventData(eventKey, updater) {
  assertEventKey(eventKey);
  return updateJson(FILES.events[eventKey], createEventDefault(eventKey), updater);
}

module.exports = {
  readEventData,
  updateEventData,
};
