'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

function buildRoleSelectPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🎭 Rolle auswählen')
    .setDescription('Wähle aus, wie du am Loco Night Cup teilnehmen möchtest.')
    .setColor(0xff0000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('role_select_player')
      .setLabel('🎮 Spieler')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('role_select_manager')
      .setLabel('🧢 Manager')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

module.exports = {
  buildRoleSelectPayload,
};
