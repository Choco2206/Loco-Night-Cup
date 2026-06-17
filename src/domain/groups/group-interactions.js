'use strict';

const EPHEMERAL = 64;
const PLACEHOLDER_BUTTONS = [
  'group_result_open:',
  'group_admin_result_open:',
  'group_replacement_open:',
];

function isGroupPhasePlaceholder(customId) {
  return PLACEHOLDER_BUTTONS.some(prefix => customId.startsWith(prefix));
}

async function handleGroupInteraction(interaction) {
  if (!interaction.isButton?.() || !isGroupPhasePlaceholder(interaction.customId)) return false;

  await interaction.reply({
    content: 'Diese Funktion kommt in Phase 6.2.',
    flags: EPHEMERAL,
  });
  return true;
}

module.exports = {
  handleGroupInteraction,
};
