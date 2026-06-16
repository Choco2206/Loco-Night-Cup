'use strict';

const { ensureAdminPanel } = require('./admin-panel');
const { handleAdminButton } = require('./admin-interactions');

async function init(client) {
  await ensureAdminPanel(client);
}

async function handleInteraction(interaction, client) {
  if (!interaction.isButton()) return false;
  return handleAdminButton(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
};
