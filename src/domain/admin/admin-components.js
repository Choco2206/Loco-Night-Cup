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
    label: 'Event',
    emoji: '📅',
    description: 'Check-in, Reset und Freilose',
    actions: [
      ['admin_checkin_open', 'Check-in oeffnen', 'Check-in fuer ein Event starten'],
      ['admin_checkin_close', 'Check-in schliessen', 'Check-in fuer ein Event beenden'],
      ['admin_checkin_manual', 'Check-in verwalten', 'Teams manuell an- oder abmelden'],
      ['admin_event_reset', 'Event zuruecksetzen', 'Ein Event kontrolliert zuruecksetzen'],
      ['admin_bye_add', 'Freilos hinzufuegen', 'Ein Freilos zum Event hinzufuegen'],
      ['admin_bye_remove', 'Freilos entfernen', 'Ein Freilos aus dem Event entfernen'],
    ],
  },
  tournament: {
    label: 'Turnier',
    emoji: '🏆',
    description: 'Format, Gruppen und K.O.-Phase',
    actions: [
      ['admin_format_lock', 'Format locken', 'Turnierformat verbindlich festlegen'],
      ['admin_groups_draw', 'Gruppen ziehen', 'Gruppen fuer das Event auslosen'],
      ['admin_group_release_current', 'Aktuellen Spieltag freigeben', 'Naechsten Gruppenspieltag freigeben'],
      ['admin_knockout_create', 'K.O. erstellen', 'K.O.-Phase fuer das Event erstellen'],
    ],
  },
  teams: {
    label: 'Teams',
    emoji: '👥',
    description: 'Teams anzeigen und verwalten',
    actions: [
      ['admin_teams_list', 'Teams anzeigen', 'Registrierte Teams auflisten'],
      ['admin_team_details', 'Teamdetails', 'Ein Team anzeigen und verwalten'],
      ['admin_team_ban', 'Team sperren', 'Eine Teamsperre einrichten'],
      ['admin_team_unban', 'Sperre entfernen', 'Eine aktive Teamsperre entfernen'],
    ],
  },
  administration: {
    label: 'Verwaltung',
    emoji: '🛠️',
    description: 'Serverstruktur, Nicknames und Manager',
    actions: [
      ['admin_server_setup', 'Serverstruktur einrichten', 'Kanaele und Rollen pruefen'],
      ['admin_nickname_sync', 'Nicknames synchronisieren', 'Team-Nicknames neu synchronisieren'],
      ['admin_managers_without_team', 'Manager ohne Team', 'Manager-ohne-Team-Liste aktualisieren'],
    ],
  },
  tests: {
    label: 'Tests',
    emoji: '🧪',
    description: 'Refresh, Testdaten und Simulationen',
    actions: [
      ['admin_checkin_refresh', 'Check-in Refresh', 'Alle Check-in-Panels aktualisieren'],
      ['admin_team_overview_refresh', 'Teamuebersicht Refresh', 'Teamuebersicht aktualisieren'],
      ['admin_testdata_create', 'Testdaten erzeugen', 'Testteams fuer ein Event erzeugen'],
      ['admin_testdata_remove', 'Testdaten entfernen', 'Alle Testteams entfernen'],
      ['admin_simulate_groups', 'Gruppenphase simulieren', 'Gruppenphase eines Events simulieren'],
      ['admin_simulate_knockout', 'K.O.-Phase simulieren', 'K.O.-Phase eines Events simulieren'],
      ['admin_hof_test', 'Hall of Fame testen', 'Siegerehrung im Testkanal pruefen'],
      ['admin_ceremony_post', 'Siegerehrung posten', 'Echte Siegerehrung fuer ein Event posten'],
    ],
  },
  achievements: {
    label: 'Erfolge',
    emoji: '🏅',
    description: 'Team-Erfolge manuell vergeben',
    actions: [
      ['admin_team_achievement_manual', 'Team-Erfolg vergeben', 'Einem Team einen Erfolg hinzufuegen'],
    ],
  },
};

function buildCategoryButtons(selectedCategory = null) {
  const buttons = Object.entries(ADMIN_CATEGORIES).map(([key, category]) => (
    new ButtonBuilder()
      .setCustomId(`admin_panel_category:${key}`)
      .setLabel(category.label)
      .setEmoji(category.emoji)
      .setStyle(key === selectedCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ));

  return [
    new ActionRowBuilder().addComponents(buttons.slice(0, 5)),
    new ActionRowBuilder().addComponents(buttons.slice(5)),
  ];
}

function buildActionSelect(categoryKey) {
  const category = ADMIN_CATEGORIES[categoryKey];
  if (!category) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_panel_action_select')
      .setPlaceholder(`${category.label}: Aktion auswaehlen`)
      .addOptions(category.actions.map(([value, label, description]) => ({
        label,
        value,
        description,
      })))
  );
}

function buildAdminPanelPayload(selectedCategory = null) {
  const category = ADMIN_CATEGORIES[selectedCategory] || null;
  const embed = new EmbedBuilder()
    .setTitle('Loco Night Cup Admin Panel')
    .setDescription(category
      ? `${category.emoji} **${category.label}**\nWaehle die gewuenschte Aktion im Menue unter den Kategorien.`
      : 'Waehle zuerst eine der Hauptkategorien. Danach erscheint darunter das passende Aktionsmenue.')
    .setColor(0xff0000)
    .setFooter({ text: 'Alle Aktionen sind weiterhin nur fuer berechtigte Admins und Cup-Leads nutzbar.' })
    .setTimestamp(new Date());

  const components = buildCategoryButtons(category ? selectedCategory : null);
  const actionSelect = buildActionSelect(selectedCategory);
  if (actionSelect) components.push(actionSelect);

  return {
    embeds: [embed],
    components,
  };
}

module.exports = {
  ADMIN_CATEGORIES,
  buildAdminPanelPayload,
};
