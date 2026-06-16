'use strict';

const { ensureAdminPanel } = require('./admin-panel');
const { handleAdminInteraction } = require('./admin-interactions');

async function init(client) {
  await ensureAdminPanel(client);
}

async function handleInteraction(interaction, client) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return false;
  return handleAdminInteraction(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
};
