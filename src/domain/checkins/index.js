'use strict';

const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile } = require('./checkin-reconcile');
const { updateEventData } = require('./checkin-repository');
const { BOMBER_X_LOCO_EVENT_DATE, isBomberXLocoEvent } = require('../events/bomber-x-loco-config');

const BOMBER_CHECKIN_RESET_MARKER = 'bomberCheckinReset20260904At';

function resetBomberCheckinOnce() {
  let reset = false;

  updateEventData('saturday', event => {
    const isCorrectEvent = isBomberXLocoEvent(event)
      && String(event.cycle?.eventDate || '') === BOMBER_X_LOCO_EVENT_DATE;

    if (!isCorrectEvent || event.meta?.[BOMBER_CHECKIN_RESET_MARKER]) return event;

    event.checkin = event.checkin || {};
    event.checkin.entries = [];
    event.checkin.activeTeamIds = [];
    event.checkin.waitlistTeamIds = [];

    event.format = {
      ...(event.format || {}),
      size: null,
      realTeamCount: 0,
      waitlistCount: 0,
      lockedAt: null,
    };

    const timestamp = new Date().toISOString();
    event.meta = {
      ...(event.meta || {}),
      updatedAt: timestamp,
      [BOMBER_CHECKIN_RESET_MARKER]: timestamp,
    };

    reset = true;
    return event;
  });

  if (reset) console.log('[checkin] Bomber X Loco check-in was reset to 0 teams once');
  return reset;
}

async function init(client) {
  resetBomberCheckinOnce();
  await ensureAllCheckinMessages(client);
  startCheckinReconcile(client);
}

async function handleInteraction(interaction, client) {
  return handleNormalInteraction(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
  startCheckinReconcile,
};
