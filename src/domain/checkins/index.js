'use strict';

const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile } = require('./checkin-reconcile');

async function init(client) {
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
