'use strict';

const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile } = require('./checkin-reconcile');
const bomberXLocoPrecheckin = require('./bomber-x-loco-precheckin');

async function init(client) {
  await bomberXLocoPrecheckin.init(client);
  await ensureAllCheckinMessages(client);
  startCheckinReconcile(client);
}

async function handleInteraction(interaction, client) {
  if (await bomberXLocoPrecheckin.handleInteraction(interaction, client)) return true;
  return handleNormalInteraction(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
  startCheckinReconcile,
};
