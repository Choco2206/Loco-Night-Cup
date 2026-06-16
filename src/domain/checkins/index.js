'use strict';

const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction } = require('./checkin-interactions');

async function init(client) {
  await ensureAllCheckinMessages(client);
}

module.exports = {
  handleInteraction,
  init,
};
