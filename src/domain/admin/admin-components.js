'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const ADMIN_CATEGORIES = {
  event: {
    label: 'Event', emoji: '📅', description: 'Check-in, Reset und Freilose',
    actions: [
      ['admin_checkin_open', 'Check-in öffnen', 'Check-in für ein Event starten'],
      ['admin_checkin_close', 'Check-in schließen', 'Check-in für ein Event beenden'],
      ['admin_checkin_manual', 'Check-in verwalten', 'Teams manuell an- oder abmelden'],
      ['admin_event_reset', 'Event zurücksetzen', 'Ein Event kontrolliert zurücksetzen'],
      ['admin_bye_add', 'Freilos hinzufügen', 'Ein Freilos zum Event hinzufügen'],
      ['admin_bye_remove', 'Freilos entfernen', 'Ein Freilos aus dem Event entfernen'],
    ],
  },
  tournament: {
    label: 'Turnier', emoji: '🏆', description: 'Format, Gruppen und K.O.-Phase',
    actions: [
      ['admin_format_lock', 'Format locken', 'Turnierformat verbindlich festlegen'],
      ['admin_groups_draw', 'Gruppen ziehen', 'Gruppen für das Event auslosen'],
      ['admin_group_release_current', 'Aktuellen Spieltag freigeben', 'Nächsten Gruppenspieltag freigeben'],
      ['admin_knockout_create', 'K.O. erstellen', 'K.O.-Phase für das Event erstellen'],
      ['admin_royale_status', 'Royal Status', 'Monatsdatum, Check-in und Turnierstatus anzeigen'],
      ['admin_royale_lock', 'Royal starten', 'Royal-Format locken und Turnierbaum erstellen'],
    ],
  },
  teams: {
    label: 'Teams', emoji: '👥', description: 'Teams anzeigen und verwalten',
    actions: [
      ['admin_teams_list', 'Teams anzeigen', 'Registrierte Teams auflisten'],
      ['admin_team_details', 'Teamdetails', 'Ein Team anzeigen und verwalten'],
      ['admin_team_ban', 'Team sperren', 'Eine Teamsperre einrichten'],
      ['admin_team_unban', 'Sperre entfernen', 'Eine aktive Teamsperre entfernen'],
    ],
  },
  administration: {
    label: 'Verwaltung', emoji: '🛠️', description: 'Serverstruktur, Nicknames und Manager',
    actions: [
      ['admin_server_setup', 'Serverstruktur einrichten', 'Kanäle und Rollen prüfen'],
      ['admin_nickname_sync', 'Nicknames synchronisieren', 'Team-Nicknames neu synchronisieren'],
      ['admin_managers_without_team', 'Manager ohne Team', 'Manager-ohne-Team-Liste aktualisieren'],
      ['admin_teams_without_ea', 'Teams ohne EA-ID', 'Teams ohne verbundenen EA Club posten'],
      ['admin_stream_list_sync', '📺 Streamliste synchronisieren', 'Zentrale Team-Streamliste neu aufbauen'],
    ],
  },
  tests: {
    label: 'Tests', emoji: '🧪', description: 'Refresh, Testdaten und Simulationen',
    actions: [
      ['admin_checkin_refresh', 'Check-in Refresh', 'Alle Check-in-Panels aktualisieren'],
      ['admin_team_overview_refresh', 'Teamübersicht Refresh', 'Teamübersicht aktualisieren'],
      ['admin_testdata_create', 'Testdaten erzeugen', 'Testteams für ein Event erzeugen'],
      ['admin_testdata_remove', 'Testdaten entfernen', 'Alle Testteams entfernen'],
      ['admin_simulate_groups', 'Gruppenphase simulieren', 'Gruppenphase eines Events simulieren'],
      ['admin_schedule_visual_test', 'Spielplan-Grafik testen', 'Alle sechs Grafikzustände in einer Gruppe darstellen'],
      ['admin_league_phase_test', 'Ligaphase testen', '14er-, 18er- oder 20er-Ligaphase testen'],
      ['admin_league_phase_test_stop', 'Ligaphasen-Test beenden', 'Testkanäle und Rollenmitgliedschaften bereinigen'],
      ['admin_ko_images_test', 'K.O.-Bilder testen', 'Eine K.O.-Bildvorlage im Testkanal prüfen'],
      ['admin_simulate_knockout', 'K.O.-Phase simulieren', 'K.O.-Phase eines Events simulieren'],
      ['admin_royale_sync', 'Royal synchronisieren', 'Check-in, Kanäle und aktuelle Runde aktualisieren'],
      ['admin_hof_test', 'Hall of Fame testen', 'Siegerehrung im Testkanal prüfen'],
      ['admin_power_ranking_test', 'Power Ranking testen', 'Wochenranking mit 20 Teams im Testkanal prüfen'],
      ['admin_power_ranking_champion_test', 'Champion der Woche testen', 'Power-Ranking-Champion-Grafik im Testkanal prüfen'],
      ['admin_ea_stats_test', 'EA-Statistik testen', 'EA-Verbindung und letzte Clubspiele prüfen'],
      ['admin_tott_test', 'TOTT-Grafik testen', 'Team-of-the-Tournament-Grafik mit Zufallsdaten posten'],
      ['admin_ceremony_post', 'Siegerehrung posten', 'Echte Siegerehrung für ein Event posten'],
    ],
  },
  achievements: {
    label: 'Erfolge', emoji: '🏅', description: 'Team-Erfolge manuell vergeben',
    actions: [['admin_team_achievement_manual', 'Team-Erfolg vergeben', 'Einem Team einen Erfolg hinzufügen']],
  },
};

function buildCategoryButtons(selectedCategory = null) {
  const buttons = Object.entries(ADMIN_CATEGORIES).map(([key, category]) => (
    new ButtonBuilder().setCustomId(`admin_panel_category:${key}`).setLabel(category.label).setEmoji(category.emoji)
      .setStyle(key === selectedCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ));
  return [new ActionRowBuilder().addComponents(buttons.slice(0, 5)), new ActionRowBuilder().addComponents(buttons.slice(5))];
}

function buildActionSelect(categoryKey) {
  const category = ADMIN_CATEGORIES[categoryKey];
  if (!category) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('admin_panel_action_select').setPlaceholder(`${category.label}: Aktion auswählen`)
      .addOptions(category.actions.map(([value, label, description]) => ({ label, value, description })))
  );
}

function buildAdminPanelPayload(selectedCategory = null) {
  const category = ADMIN_CATEGORIES[selectedCategory] || null;
  const embed = new EmbedBuilder()
    .setTitle('Loco Night Cup Admin Panel')
    .setDescription([
      'Wähle zuerst eine Hauptkategorie und danach die gewünschte Aktion im Menü.', '',
      '**📅 Event:** Check-in öffnen/schließen/verwalten, Event-Reset und Freilose',
      '**🏆 Turnier:** Format, Gruppenauslosung, Spieltag-Freigabe und K.O.-Phase',
      '**👥 Teams:** Teamliste, Teamdetails sowie Sperren',
      '**🛠️ Verwaltung:** Serverstruktur, Nicknames, Manager ohne Team und Teams ohne EA-ID',
      '**🧪 Tests:** Refreshs, Testdaten, Simulationen, EA-Statistik und Siegerehrung',
      '**🏅 Erfolge:** Team-Erfolge manuell vergeben',
    ].join('\n'))
    .setColor(0xff0000)
    .setFooter({ text: 'Alle Aktionen sind weiterhin nur für berechtigte Admins und Cup-Leads nutzbar.' })
    .setTimestamp(new Date());
  const components = buildCategoryButtons(category ? selectedCategory : null);
  const actionSelect = buildActionSelect(selectedCategory);
  if (actionSelect) components.push(actionSelect);
  if (selectedCategory === 'tests') {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin_tott_test').setLabel('TOTT-Grafik testen').setEmoji('⭐').setStyle(ButtonStyle.Danger)
    ));
  }
  return { embeds: [embed], components };
}

module.exports = { ADMIN_CATEGORIES, buildAdminPanelPayload };
