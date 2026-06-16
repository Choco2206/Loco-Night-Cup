'use strict';

const { ensureRoleSelectPanel } = require('./role-panel');
const { handleInteraction } = require('./role-interactions');

async function init(client) {
  await ensureRoleSelectPanel(client);
}

module.exports = {
  handleInteraction,
  init,
};
