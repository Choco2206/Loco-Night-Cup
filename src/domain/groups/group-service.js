'use strict';

const { getLockedEventPreview, lockEventAndCreateGroups } = require('../events/event-lock-service');

async function startGroupPhase({ eventKey, actorUserId = null, client = null, now = new Date() }) {
  return lockEventAndCreateGroups({ eventKey, actorUserId, client, now });
}

function previewGroupPhase({ eventKey, now = new Date() }) {
  return getLockedEventPreview(eventKey, now);
}

module.exports = {
  previewGroupPhase,
  startGroupPhase,
};
