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
    buttons: [
      ['admin_checkin_open', 'Check-in oeffnen', ButtonStyle.Success],
      ['admin_checkin_close', 'Check-in schliessen', ButtonStyle.Danger],
      ['admin_checkin_manual', 'Check-in verwalten', ButtonStyle.Secondary],
      ['admin_event_reset', 'Event zuruecksetzen', ButtonStyle.Secondary, '🧹'],
      ['admin_bye_add', 'Freilos hinzufuegen', ButtonStyle.Secondary],
      ['admin_bye_remove', 'Freilos entfernen', ButtonStyle.Secondary],
    ],
  },
  tournament: {
    label: 'Turnier',
    emoji: '🏆',
    description: 'Format, Gruppen und K.O.-Phase',
    buttons: [
      ['admin_format_lock', 'Format locken', ButtonStyle.Primary],
      ['admin_groups_draw', 'Gruppen ziehen', ButtonStyle.Primary],
      ['admin_group_release_current', 'Aktuellen Spieltag freigeben', ButtonStyle.Success],
      ['admin_knockout_create', 'K.O. erstellen', ButtonStyle.Primary, '🏆'],
    ],
  },
  teams: {
    label: 'Teams',
    emoji: '👥',
    description: 'Teams anzeigen und verwalten',
    buttons: [
      ['admin_teams_list', 'Teams anzeigen', ButtonStyle.Secondary],
      ['admin_team_details', 'Teamdetails', ButtonStyle.Secondary],
      ['admin_team_ban', 'Team sperren', ButtonStyle.Danger, '🚫'],
      ['admin_team_unban', 'Sperre entfernen', ButtonStyle.Success, '✅'],
    ],
  },
  administration: {
    label: 'Verwaltung',
    emoji: '🛠️',
    description: 'Serverstruktur, Nicknames und Manager',
    buttons: [
      ['admin_server_setup', 'Serverstruktur einrichten', ButtonStyle.Primary, '🛠️'],
      ['admin_nickname_sync', 'Nicknames synchronisieren', ButtonStyle.Secondary, '🏷️'],
      ['admin_managers_without_team', 'Manager ohne Team', ButtonStyle.Secondary],
    ],
  },
  tests: {
    label: 'Tests',
    emoji: '🧪',
    description: 'Refresh, Testdaten und Simulationen',
    buttons: [
      ['admin_checkin_refresh', 'Check-in Refresh', ButtonStyle.Secondary],
      ['admin_team_overview_refresh', 'Teamuebersicht Refresh', ButtonStyle.Secondary],
      ['admin_testdata_create', 'Testdaten erzeugen', ButtonStyle.Secondary],
      ['admin_testdata_remove', 'Testdaten entfernen', ButtonStyle.Danger],
      ['admin_simulate_groups', 'Gruppenphase simulieren', ButtonStyle.Danger, '🧪'],
      ['admin_simulate_knockout', 'K.O.-Phase simulieren', ButtonStyle.Danger, '🧪'],
      ['admin_hof_test', 'Hall of Fame testen', ButtonStyle.Secondary, '🏆'],
      ['admin_ceremony_post', 'Siegerehrung posten', ButtonStyle.Success, '🏆'],
    ],
  },
  achievements: {
    label: 'Erfolge',
    emoji: '🏅',
    description: 'Team-Erfolge manuell vergeben',
    buttons: [
      ['admin_team_achievement_manual', 'Team-Erfolg vergeben', ButtonStyle.Secondary, '🏆'],
    ],
  },
};

function button(customId, label, style = ButtonStyle.Secondary, emoji = null) {
  const component = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);
  if (emoji) component.setEmoji(emoji);
  return component;
}

function buildCategorySelect(selectedCategory = null) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_panel_category_select')
      .setPlaceholder('Kategorie auswaehlen')
      .addOptions(Object.entries(ADMIN_CATEGORIES).map(([value, category]) => ({
        label: category.label,
        value,
        emoji: category.emoji,
        description: category.description,
        default: value === selectedCategory,
      })))
  );
}

function buildCategoryRows(categoryKey) {
  const category = ADMIN_CATEGORIES[categoryKey];
  if (!category) return [];

  const rows = [];
  for (let index = 0; index < category.buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      category.buttons
        .slice(index, index + 5)
        .map(([customId, label, style, emoji]) => button(customId, label, style, emoji))
    ));
  }
  return rows;
}

function buildAdminPanelPayload(selectedCategory = null) {
  const category = ADMIN_CATEGORIES[selectedCategory] || null;
  const embed = new EmbedBuilder()
    .setTitle('Loco Night Cup Admin Panel')
    .setDescription(category
      ? `${category.emoji} **${category.label}**\nWaehle unten die gewuenschte Aktion oder wechsle die Kategorie.`
      : 'Waehle im Menue eine Kategorie aus. Anschliessend werden nur die dazugehoerigen Aktionen angezeigt.')
    .setColor(0xff0000)
    .setFooter({ text: 'Alle Aktionen sind weiterhin nur fuer berechtigte Admins und Cup-Leads nutzbar.' })
    .setTimestamp(new Date());

  return {
    embeds: [embed],
    components: [
      buildCategorySelect(category ? selectedCategory : null),
      ...buildCategoryRows(selectedCategory),
    ],
  };
}

module.exports = {
  ADMIN_CATEGORIES,
  buildAdminPanelPayload,
};
