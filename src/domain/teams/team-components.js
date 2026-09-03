'use strict';

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
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
const { getTeamAchievementRank, getTeamHistoryStats, getTeamTitles } = require('./team-achievements');
const { getChampionLevelForGold } = require('./champion-ranks');
const teamRegistrationBannerBase64 = require('./team-registration-banner');
const myTeamBannerBase64 = require('./my-team-banner');

function buildTeamPanelPayload() {
  const bannerName = 'team-registration-banner.jpg';
  const embed = new EmbedBuilder()
    .setImage(`attachment://${bannerName}`)
    .setColor(0xff0000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('team_register_open')
      .setLabel('Team registrieren')
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row],
    files: [new AttachmentBuilder(Buffer.from(teamRegistrationBannerBase64, 'base64'), { name: bannerName })],
  };
}

function buildMyTeamPanelPayload() {
  const bannerName = 'my-team-banner.jpeg';
  const embed = new EmbedBuilder()
    .setImage(`attachment://${bannerName}`)
    .setColor(0xff0000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('team_show_mine')
      .setLabel('Mein Team anzeigen')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
    files: [new AttachmentBuilder(Buffer.from(myTeamBannerBase64, 'base64'), { name: bannerName })],
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

  const twitchInputs = [1, 2, 3].map(index => new TextInputBuilder()
    .setCustomId(`twitch_url_${index}`)
    .setLabel(`Twitch-Kanal oder Link ${index} (optional)`)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(200)
    .setRequired(false));

  modal.addComponents(
    new ActionRowBuilder().addComponents(input),
    ...twitchInputs.map(twitchInput => new ActionRowBuilder().addComponents(twitchInput)),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('ea_club_name')
      .setLabel('EA-FC-Clubname (optional)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(50)
      .setRequired(false))
  );
  return modal;
}

function buildEaClubModal(team) {
  const modal = new ModalBuilder().setCustomId(`team_ea_club_modal:${team.id}`).setTitle('EA-Club verknüpfen');
  const input = new TextInputBuilder()
    .setCustomId('ea_club_name').setLabel('Exakter EA-FC-Clubname')
    .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(50).setRequired(true);
  if (team.eaClub?.name) input.setValue(team.eaClub.name);
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

function buildTwitchModal(team) {
  const modal = new ModalBuilder()
    .setCustomId(`team_twitch_modal:${team.id}`)
    .setTitle('Twitch-Stream bearbeiten');
  const inputs = [1, 2, 3].map((index, offset) => {
    const input = new TextInputBuilder()
      .setCustomId(`twitch_url_${index}`)
      .setLabel(`Twitch-Kanal oder Link ${index} (leer = entfernen)`)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(200)
      .setRequired(false);
    if (team.twitchUrls?.[offset]) input.setValue(team.twitchUrls[offset]);
    return input;
  });
  modal.addComponents(...inputs.map(input => new ActionRowBuilder().addComponents(input)));
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

function formatPercent(value) {
  return `${value.toFixed(1).replace('.', ',')} %`;
}

function buildTeamEmbed(team, logoAttachment) {
  const coManagers = team.coManagers.length
    ? team.coManagers.map(co => `• ${mention(co.userId)}`).join('\n')
    : 'Keine Co-VMs';

  const logoLine = team.logo?.fileName
    ? `Logo: ${team.logo.fileName}${logoAttachment ? '' : ' (Datei nicht gefunden)'}`
    : 'Logo: fehlt';
  const titles = getTeamTitles(team);
  const historyStats = getTeamHistoryStats(team);
  const matchStats = historyStats.matches;
  const winRate = matchStats.played > 0 ? (matchStats.wins / matchStats.played) * 100 : 0;
  const championLevel = getChampionLevelForGold(titles.gold);
  const rank = getTeamAchievementRank(team.id);
  const achievementLines = [
    '🏆 **Team-Erfolge**',
    `🥇 Cup-Siege: ${titles.gold}`,
    `🥈 Platz 2: ${titles.silver}`,
    `🥉 Platz 3: ${titles.bronze}`,
    `🌍 Ranking: ${rank ? `#${rank}` : 'noch keine Platzierung'}`,
    `🎮 Cups gespielt: ${historyStats.cupsPlayed}`,
    `👑 Champion-Rang: ${championLevel?.name || 'noch keiner'}`,
  ];
  const statisticLines = [
    '📊 **Teamstatistik**',
    `🎮 Spiele: ${matchStats.played}`,
    `✅ Siege: ${matchStats.wins}`,
    `➖ Unentschieden: ${matchStats.draws}`,
    `❌ Niederlagen: ${matchStats.losses}`,
    `⚽ Tore: ${matchStats.goalsFor}`,
    `🥅 Gegentore: ${matchStats.goalsAgainst}`,
    `📈 Siegquote: ${formatPercent(winRate)}`,
  ];

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
      `Twitch: ${team.twitchUrls?.length ? team.twitchUrls.join('\n') : 'nicht hinterlegt'}`,
      `EA-Club: ${team.eaClub ? `**${team.eaClub.name}** (ID: ${team.eaClub.clubId})` : 'nicht verknüpft – keine TOTT-Wertung'}`,
      '',
      ...achievementLines,
      '',
      ...statisticLines,
    ].join('\n'))
    .setColor(team.registrationStatus === 'complete' ? 0x00aa55 : 0xffaa00);

  if (logoAttachment) {
    embed.setImage(`attachment://${logoAttachment.name}`);
  }

  return embed;
}

function buildMyTeamPayload(team, viewerUserId = null) {
  const logoAttachment = getLogoAttachment(team);
  const isManager = viewerUserId && team.manager?.userId && String(team.manager.userId) === String(viewerUserId);
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
      .setCustomId(`team_ea_club_open:${team.id}`)
      .setLabel(team.eaClub ? 'EA-Club ändern' : 'EA-Club verknüpfen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`team_twitch_open:${team.id}`)
      .setLabel('📺 Twitch-Links')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`team_remove_covm_open:${team.id}`)
      .setLabel('Co-VM entfernen')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isManager || team.coManagers.length === 0),
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
  buildEaClubModal,
  buildMyTeamPayload,
  buildMyTeamPanelPayload,
  buildRegisterModal,
  buildRemoveCoManagerPayload,
  buildTeamPanelPayload,
  buildTwitchModal,
};
