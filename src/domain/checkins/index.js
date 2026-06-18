'use strict';

const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction } = require('./checkin-interactions');
const { startCheckinReconcile } = require('./checkin-reconcile');

async function init(client) {
  await ensureAllCheckinMessages(client);
  startCheckinReconcile(client);
}

module.exports = {
  handleInteraction,
  init,
  startCheckinReconcile,
};
