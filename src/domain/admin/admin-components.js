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
    .setTitle('Loco Night Cup Admin Panel')
    .setDescription('Zentrale Steuerung des Turniersystems.')
    .setColor(0xff0000)
    .addFields(
      { name: 'EVENT', value: 'Check-in oeffnen\nCheck-in schliessen\nCheck-in verwalten\nEvent zuruecksetzen\nFreilos hinzufuegen\nFreilos entfernen', inline: true },
      { name: 'TURNIER', value: 'Format locken\nGruppen ziehen\nAktuellen Spieltag freigeben\nK.O. erstellen', inline: true },
      { name: 'TEAMS / SETUP', value: 'Teams anzeigen\nTeamdetails\nManager ohne Team\nTeam sperren\nSperre entfernen\nServerstruktur einrichten\nNicknames synchronisieren', inline: true },
      { name: 'TESTS', value: 'Check-in Refresh\nTeamuebersicht Refresh\nTestdaten erzeugen\nTestdaten entfernen\nGruppenphase simulieren\nK.O.-Phase simulieren\nHall of Fame testen\nSiegerehrung posten', inline: true }
    )
    .setTimestamp(new Date());

  const eventRow = new ActionRowBuilder().addComponents(
    button('admin_checkin_open', 'Check-in oeffnen', ButtonStyle.Success),
    button('admin_checkin_close', 'Check-in schliessen', ButtonStyle.Danger),
    button('admin_event_reset', 'Event zuruecksetzen', ButtonStyle.Secondary).setEmoji('🧹'),
    button('admin_bye_add', 'Freilos hinzufuegen', ButtonStyle.Secondary),
    button('admin_bye_remove', 'Freilos entfernen', ButtonStyle.Secondary)
  );

  const tournamentRow = new ActionRowBuilder().addComponents(
    button('admin_format_lock', 'Format locken', ButtonStyle.Primary),
    button('admin_groups_draw', 'Gruppen ziehen', ButtonStyle.Primary),
    button('admin_group_release_current', 'Aktuellen Spieltag freigeben', ButtonStyle.Success),
    button('admin_knockout_create', 'K.O. erstellen', ButtonStyle.Primary).setEmoji('🏆')
  );

  tournamentRow.addComponents(button('admin_checkin_manual', 'Check-in verwalten', ButtonStyle.Secondary));

  const teamsRow = new ActionRowBuilder().addComponents(
    button('admin_teams_list', 'Teams anzeigen', ButtonStyle.Secondary),
    button('admin_team_details', 'Teamdetails', ButtonStyle.Secondary),
    button('admin_team_ban', 'Team sperren', ButtonStyle.Danger).setEmoji('🚫'),
    button('admin_team_unban', 'Sperre entfernen', ButtonStyle.Success).setEmoji('✅'),
    button('admin_server_setup', 'Serverstruktur einrichten', ButtonStyle.Primary).setEmoji('🛠️')
  );

  const testsRow = new ActionRowBuilder().addComponents(
    button('admin_checkin_refresh', 'Check-in Refresh', ButtonStyle.Secondary),
    button('admin_team_achievement_manual', 'Team-Erfolg vergeben', ButtonStyle.Secondary).setEmoji('🏆'),
    button('admin_testdata_create', 'Testdaten erzeugen', ButtonStyle.Secondary),
    button('admin_testdata_remove', 'Testdaten entfernen', ButtonStyle.Danger),
    button('admin_nickname_sync', 'Nicknames synchronisieren', ButtonStyle.Secondary).setEmoji('🏷️')
  );

  const simulationRow = new ActionRowBuilder().addComponents(
    button('admin_simulate_groups', 'Gruppenphase simulieren', ButtonStyle.Danger).setEmoji('🧪'),
    button('admin_simulate_knockout', 'K.O.-Phase simulieren', ButtonStyle.Danger).setEmoji('🧪'),
    button('admin_hof_test', 'Hall of Fame testen', ButtonStyle.Secondary).setEmoji('🏆'),
    button('admin_ceremony_post', 'Siegerehrung posten', ButtonStyle.Success).setEmoji('🏆')
  );

  simulationRow.addComponents(button('admin_managers_without_team', 'Manager ohne Team', ButtonStyle.Secondary));

  return {
    embeds: [embed],
    components: [eventRow, tournamentRow, teamsRow, testsRow, simulationRow],
  };
}

module.exports = {
  buildAdminPanelPayload,
};
