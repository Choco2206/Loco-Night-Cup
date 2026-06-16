'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createEventDefault } = require('../../storage/defaults');
const { EVENT_KEYS } = require('../../app/constants');

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

function readAllEvents() {
  return Object.fromEntries(EVENT_KEYS.map(eventKey => [eventKey, readEventData(eventKey)]));
}

module.exports = {
  readAllEvents,
  readEventData,
  updateEventData,
};
