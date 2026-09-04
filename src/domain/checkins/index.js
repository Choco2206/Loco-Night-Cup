'use strict';

const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile } = require('./checkin-reconcile');
const bomberManualDraw = require('./bomber-x-loco-manual-draw');

async function init(client) {
  // Bomber X Loco nutzt ausschließlich den offiziellen Saturday-Event-State.
  // Es gibt keine separate Voranmeldung und keine spätere Übergabe einer zweiten Liste.
  await ensureAllCheckinMessages(client);
  bomberManualDraw.scheduleManualDrawPreparation(client);
  startCheckinReconcile(client);
}

async function handleInteraction(interaction, client) {
  if (await bomberManualDraw.handleInteraction(interaction, client)) return true;
  return handleNormalInteraction(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
  startCheckinReconcile,
};
