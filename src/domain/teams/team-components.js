'use strict';

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const { TEAM_LOGOS_DIR } = require('../../storage');

function buildTeamPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('Team-Verwaltung')
    .setDescription('Registriere dein Team oder öffne deine Teamübersicht.')
    .setColor(0xff0000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('team_register_open')
      .setLabel('Team registrieren')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('team_show_mine')
      .setLabel('Mein Team')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

function buildRegisterModal(settings) {
  const modal = new ModalBuilder()
    .setCustomId('team_register_modal')
    .setTitle('Team registrieren');

  const input = new TextInputBuilder()
    .setCustomId('club_name')
    .setLabel('Teamname')
    .setStyle(TextInputStyle.Short)
    .setMinLength(settings.teams.clubNameMinLength)
    .setMaxLength(settings.teams.clubNameMaxLength)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildEditNameModal(team, settings) {
  const modal = new ModalBuilder()
    .setCustomId(`team_edit_name_modal:${team.id}`)
    .setTitle('Teamname bearbeiten');

  const input = new TextInputBuilder()
    .setCustomId('new_club_name')
    .setLabel('Neuer Teamname')
    .setStyle(TextInputStyle.Short)
    .setMinLength(settings.teams.clubNameMinLength)
    .setMaxLength(settings.teams.clubNameMaxLength)
    .setRequired(true)
    .setValue(team.clubName);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function mention(userId) {
  return userId ? `<@${userId}>` : 'Kein VM';
}

function getLogoAttachment(team) {
  if (!team.logo?.fileName) return null;

  const fileName = path.basename(team.logo.fileName);
  const filePath = path.join(TEAM_LOGOS_DIR, fileName);
  if (!fs.existsSync(filePath)) return null;

  return {
    attachment: filePath,
    name: fileName,
  };
}

function buildTeamEmbed(team, logoAttachment) {
  const coManagers = team.coManagers.length
    ? team.coManagers.map(co => `• ${mention(co.userId)}`).join('\n')
    : 'Keine Co-VMs';

  const logoLine = team.logo?.fileName
    ? `Logo: ${team.logo.fileName}${logoAttachment ? '' : ' (Datei nicht gefunden)'}`
    : 'Logo: fehlt';

  const embed = new EmbedBuilder()
    .setTitle(team.clubName)
    .setDescription([
      `Status: **${team.status}**`,
      `Registrierung: **${team.registrationStatus}**`,
      '',
      `VM: ${mention(team.manager?.userId)}`,
      '',
      `Co-VMs (${team.coManagers.length}/5)`,
      coManagers,
      '',
      logoLine,
    ].join('\n'))
    .setColor(team.registrationStatus === 'complete' ? 0x00aa55 : 0xffaa00);

  if (logoAttachment) {
    embed.setImage(`attachment://${logoAttachment.name}`);
  }

  return embed;
}

function buildMyTeamPayload(team) {
  const logoAttachment = getLogoAttachment(team);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_edit_name_open:${team.id}`)
      .setLabel('Name ändern')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`team_logo_update_open:${team.id}`)
      .setLabel('Logo hochladen')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`team_add_covm_open:${team.id}`)
      .setLabel('Co-VM hinzufügen')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_remove_covm_open:${team.id}`)
      .setLabel('Co-VM entfernen')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(team.coManagers.length === 0),
    new ButtonBuilder()
      .setCustomId(`team_leave_open:${team.id}`)
      .setLabel('Team verlassen')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`team_delete_open:${team.id}`)
      .setLabel('Team löschen')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!team.manager?.userId)
  );

  return {
    embeds: [buildTeamEmbed(team, logoAttachment)],
    components: [row1, row2],
    files: logoAttachment ? [logoAttachment] : [],
    allowedMentions: { parse: ['users'] },
  };
}

function buildAddCoManagerPayload(team) {
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`team_add_covm_select:${team.id}`)
      .setPlaceholder('Co-VM auswählen')
      .setMinValues(1)
      .setMaxValues(1)
  );

  return {
    content: `Wähle einen Co-VM für **${team.clubName}** aus.`,
    components: [row],
  };
}

function buildRemoveCoManagerPayload(team) {
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`team_remove_covm_select:${team.id}`)
      .setPlaceholder('Co-VM entfernen')
      .addOptions(team.coManagers.slice(0, 25).map(co => ({
        label: `User ${co.userId}`,
        value: String(co.userId),
      })))
  );

  return {
    content: `Wähle einen Co-VM aus **${team.clubName}** aus.`,
    components: [row],
  };
}

function buildConfirmPayload(kind, team) {
  const isDelete = kind === 'delete';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_${kind}_confirm:${team.id}`)
      .setLabel(isDelete ? 'Ja, löschen' : 'Ja, verlassen')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`team_${kind}_cancel:${team.id}`)
      .setLabel('Abbrechen')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: isDelete
      ? `Team **${team.clubName}** wirklich löschen? Die Statistiken bleiben erhalten.`
      : `Team **${team.clubName}** wirklich verlassen?`,
    components: [row],
  };
}

module.exports = {
  buildAddCoManagerPayload,
  buildConfirmPayload,
  buildEditNameModal,
  buildMyTeamPayload,
  buildRegisterModal,
  buildRemoveCoManagerPayload,
  buildTeamPanelPayload,
};
