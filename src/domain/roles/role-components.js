'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

function buildRoleSelectPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🎭 Rolle auswählen')
    .setDescription([
      '**🎮 Spieler**',
      'Ich möchte als Spieler teilnehmen oder einem Team beitreten.',
      '',
      '**🧢 Team anmelden / Manager**',
      'Ich möchte ein Team registrieren oder verwalten.',
    ].join('\n'))
    .setColor(0xff0000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('role_select_player')
      .setLabel('🎮 Spieler')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('role_select_manager')
      .setLabel('🧢 Team anmelden / Manager')
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
