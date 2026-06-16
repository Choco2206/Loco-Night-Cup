'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);
}

function buildAdminPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🔧 Loco Night Cup Admin Panel')
    .setDescription('Zentrale Steuerung des Turniersystems.')
    .setColor(0xff0000)
    .addFields(
      { name: 'EVENT', value: 'Check-in öffnen\nCheck-in schließen\nEvent zurücksetzen\nFreilos hinzufügen\nFreilos entfernen', inline: true },
      { name: 'TURNIER', value: 'Format locken\nGruppen ziehen', inline: true },
      { name: 'TEAMS', value: 'Teams anzeigen\nTeamdetails', inline: true },
      { name: 'TESTS', value: 'Check-in Refresh\nTeamübersicht Refresh\nTestdaten erzeugen\nTestdaten entfernen\nCeremony Test', inline: true }
    )
    .setTimestamp(new Date());

  const eventRow = new ActionRowBuilder().addComponents(
    button('admin_checkin_open', 'Check-in öffnen', ButtonStyle.Success),
    button('admin_checkin_close', 'Check-in schließen', ButtonStyle.Danger),
    button('admin_event_reset', 'Event zurücksetzen', ButtonStyle.Secondary),
    button('admin_bye_add', 'Freilos hinzufügen', ButtonStyle.Secondary),
    button('admin_bye_remove', 'Freilos entfernen', ButtonStyle.Secondary)
  );

  const tournamentRow = new ActionRowBuilder().addComponents(
    button('admin_format_lock', 'Format locken', ButtonStyle.Primary),
    button('admin_groups_draw', 'Gruppen ziehen', ButtonStyle.Primary)
  );

  const teamsRow = new ActionRowBuilder().addComponents(
    button('admin_teams_list', 'Teams anzeigen', ButtonStyle.Secondary),
    button('admin_team_details', 'Teamdetails', ButtonStyle.Secondary)
  );

  const testsRow = new ActionRowBuilder().addComponents(
    button('admin_checkin_refresh', 'Check-in Refresh', ButtonStyle.Secondary),
    button('admin_team_overview_refresh', 'Teamübersicht Refresh', ButtonStyle.Secondary),
    button('admin_testdata_create', '🧪 Testdaten erzeugen', ButtonStyle.Secondary),
    button('admin_testdata_remove', '🗑️ Testdaten entfernen', ButtonStyle.Danger),
    button('admin_ceremony_test', 'Ceremony Test', ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [eventRow, tournamentRow, teamsRow, testsRow],
  };
}

module.exports = {
  buildAdminPanelPayload,
};
