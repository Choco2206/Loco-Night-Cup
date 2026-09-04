'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const restored = require('./admin-interactions-restored');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { postTeamsWithoutEa } = require('./teams-without-ea');
const { postBomberXLocoGraphicsTest } = require('./bomber-x-loco-graphics-test');
const { listVisibleTeams } = require('../teams/team-service');
const { listActiveBans } = require('../bans');

const EPHEMERAL = 64;
const BAN_PAGE_SIZE = 25;

function selectedAction(interaction) {
  if (interaction?.isStringSelectMenu?.() && interaction.customId === 'admin_panel_action_select') {
    return interaction.values?.[0] || '';
  }
  return interaction?.customId || '';
}

async function requireAdmin(interaction) {
  if (!interaction.guild || !interaction.member) throw new Error('Admin-Panel ist nur auf dem Server nutzbar.');
  const settings = readJson(FILES.settings, createSettingsDefault());
  const roleIds = [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ].filter(Boolean).map(String);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (!roleIds.some(roleId => member?.roles?.cache?.has(roleId))) {
    throw new Error('Du darfst dieses Admin-Panel nicht verwenden.');
  }
}

function teamInitial(value) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const first = normalized.charAt(0);
  return /^[A-Z]$/.test(first) ? first : '#';
}

function compareNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'de', { sensitivity: 'base' });
}

function activeTeamsForBan() {
  return listVisibleTeams()
    .filter(team => team.status === 'active')
    .slice()
    .sort((a, b) => compareNames(a.clubName, b.clubName));
}

function banTeamId(ban) {
  return ban?.teamId || ban?.team?.teamId || ban?.targets?.teamId || null;
}

function banTeamName(ban) {
  return String(ban?.clubName || ban?.team?.clubNameSnapshot || banTeamId(ban) || 'Unbekanntes Team');
}

function activeBansForUnban() {
  return listActiveBans()
    .filter(ban => banTeamId(ban))
    .slice()
    .sort((a, b) => compareNames(banTeamName(a), banTeamName(b)));
}

function availableLetters(items, getName) {
  const counts = new Map();
  for (const item of items) {
    const letter = teamInitial(getName(item));
    counts.set(letter, (counts.get(letter) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b, 'de');
    });
}

function buildLetterRows({ customIdPrefix, items, getName }) {
  const letters = availableLetters(items, getName);
  if (!letters.length) throw new Error('Es gibt keine auswählbaren Teams.');

  const rows = [];
  for (let offset = 0; offset < letters.length; offset += 25) {
    const chunk = letters.slice(offset, offset + 25);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${customIdPrefix}:${Math.floor(offset / 25)}`)
        .setPlaceholder(rows.length ? 'Weitere Buchstaben auswählen' : 'Anfangsbuchstaben auswählen')
        .addOptions(chunk.map(([letter, count]) => ({
          label: letter === '#' ? '# / Zahl / Sonderzeichen' : letter,
          value: letter,
          description: `${count} Team${count === 1 ? '' : 's'}`,
        })))
    ));
  }
  return rows;
}

function buildBanLetterPayload() {
  const teams = activeTeamsForBan();
  if (!teams.length) throw new Error('Es gibt keine auswählbaren Teams.');
  return {
    content: 'Welches Team soll gesperrt werden?\nBitte zuerst den **Anfangsbuchstaben** auswählen.',
    components: buildLetterRows({
      customIdPrefix: 'admin_team_ban_letter_select',
      items: teams,
      getName: team => team.clubName,
    }),
  };
}

function buildUnbanLetterPayload() {
  const bans = activeBansForUnban();
  if (!bans.length) throw new Error('Aktuell gibt es keine aktiven Sperren.');
  return {
    content: 'Welche aktive Sperre soll entfernt werden?\nBitte zuerst den **Anfangsbuchstaben** auswählen.',
    components: buildLetterRows({
      customIdPrefix: 'admin_team_unban_letter_select',
      items: bans,
      getName: banTeamName,
    }),
  };
}

function clampPage(page, totalPages) {
  const value = Number(page);
  if (!Number.isInteger(value)) return 0;
  return Math.min(Math.max(value, 0), Math.max(totalPages - 1, 0));
}

function buildBanTeamsByLetterPayload(letter, page = 0) {
  const normalizedLetter = teamInitial(letter === '#' ? '#' : letter);
  const teams = activeTeamsForBan().filter(team => teamInitial(team.clubName) === normalizedLetter);
  if (!teams.length) throw new Error(`Es gibt keine Teams unter ${normalizedLetter}.`);

  const totalPages = Math.max(1, Math.ceil(teams.length / BAN_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const pageTeams = teams.slice(currentPage * BAN_PAGE_SIZE, (currentPage + 1) * BAN_PAGE_SIZE);

  const components = [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_team_ban_team_select:${normalizedLetter}:${currentPage}`)
      .setPlaceholder(totalPages === 1 ? `Team unter ${normalizedLetter} auswählen` : `Team auswählen (${currentPage + 1}/${totalPages})`)
      .addOptions(pageTeams.map(team => ({
        label: String(team.clubName).slice(0, 100),
        value: String(team.id),
        description: team.logo?.fileName ? `Logo: ${team.logo.fileName}`.slice(0, 100) : 'Logo fehlt',
      })))
  )];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_team_ban_letter_page:${normalizedLetter}:${currentPage - 1}`)
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`admin_team_ban_letter_page:${normalizedLetter}:${currentPage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_team_ban_letters_back')
      .setLabel('Anderen Buchstaben wählen')
      .setStyle(ButtonStyle.Secondary)
  ));

  return {
    content: `Teams mit **${normalizedLetter}**.\nSeite ${currentPage + 1}/${totalPages} · ${teams.length} Team${teams.length === 1 ? '' : 's'}`,
    components,
  };
}

function buildUnbanTeamsByLetterPayload(letter, page = 0) {
  const normalizedLetter = teamInitial(letter === '#' ? '#' : letter);
  const bans = activeBansForUnban().filter(ban => teamInitial(banTeamName(ban)) === normalizedLetter);
  if (!bans.length) throw new Error(`Es gibt keine aktiven Sperren unter ${normalizedLetter}.`);

  const totalPages = Math.max(1, Math.ceil(bans.length / BAN_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const pageBans = bans.slice(currentPage * BAN_PAGE_SIZE, (currentPage + 1) * BAN_PAGE_SIZE);

  const components = [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_team_unban_select')
      .setPlaceholder(totalPages === 1 ? `Sperre unter ${normalizedLetter} auswählen` : `Sperre auswählen (${currentPage + 1}/${totalPages})`)
      .addOptions(pageBans.map(ban => ({
        label: banTeamName(ban).slice(0, 100),
        value: String(banTeamId(ban)),
        description: String(ban.customReason || ban.reason || 'Sperre').slice(0, 100),
      })))
  )];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_team_unban_letter_page:${normalizedLetter}:${currentPage - 1}`)
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`admin_team_unban_letter_page:${normalizedLetter}:${currentPage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_team_unban_letters_back')
      .setLabel('Anderen Buchstaben wählen')
      .setStyle(ButtonStyle.Secondary)
  ));

  return {
    content: `Aktive Sperren mit **${normalizedLetter}**.\nSeite ${currentPage + 1}/${totalPages} · ${bans.length} Team${bans.length === 1 ? '' : 's'}`,
    components,
  };
}

async function handleBanNavigation(interaction) {
  const action = selectedAction(interaction);
  const customId = interaction.customId || '';

  const isNavigation = [
    'admin_team_ban',
    'admin_team_unban',
    'admin_team_ban_letters_back',
    'admin_team_unban_letters_back',
  ].includes(action)
    || customId.startsWith('admin_team_ban_letter_select:')
    || customId.startsWith('admin_team_unban_letter_select:')
    || customId.startsWith('admin_team_ban_letter_page:')
    || customId.startsWith('admin_team_unban_letter_page:');

  if (!isNavigation) return false;

  try {
    await requireAdmin(interaction);

    if (action === 'admin_team_ban' || customId === 'admin_team_ban_letters_back') {
      const payload = buildBanLetterPayload();
      if (interaction.isStringSelectMenu?.() && interaction.customId === 'admin_panel_action_select') {
        await interaction.reply({ ...payload, flags: EPHEMERAL });
      } else {
        await interaction.update(payload);
      }
      return true;
    }

    if (action === 'admin_team_unban' || customId === 'admin_team_unban_letters_back') {
      const payload = buildUnbanLetterPayload();
      if (interaction.isStringSelectMenu?.() && interaction.customId === 'admin_panel_action_select') {
        await interaction.reply({ ...payload, flags: EPHEMERAL });
      } else {
        await interaction.update(payload);
      }
      return true;
    }

    if (customId.startsWith('admin_team_ban_letter_select:')) {
      await interaction.update(buildBanTeamsByLetterPayload(interaction.values?.[0], 0));
      return true;
    }

    if (customId.startsWith('admin_team_unban_letter_select:')) {
      await interaction.update(buildUnbanTeamsByLetterPayload(interaction.values?.[0], 0));
      return true;
    }

    if (customId.startsWith('admin_team_ban_letter_page:')) {
      const [, letter, page] = customId.split(':');
      await interaction.update(buildBanTeamsByLetterPayload(letter, page));
      return true;
    }

    if (customId.startsWith('admin_team_unban_letter_page:')) {
      const [, letter, page] = customId.split(':');
      await interaction.update(buildUnbanTeamsByLetterPayload(letter, page));
      return true;
    }
  } catch (error) {
    const content = `❌ Auswahl konnte nicht geladen werden: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] }).catch(() => null);
    else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => null);
    return true;
  }

  return false;
}

async function handleTeamsWithoutEa(interaction, client) {
  if (selectedAction(interaction) !== 'admin_teams_without_ea') return false;
  try {
    await requireAdmin(interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await postTeamsWithoutEa({ client, guild: interaction.guild });
    await interaction.editReply({
      content: result.affectedCount
        ? `✅ Liste aktualisiert. **${result.affectedCount} Team${result.affectedCount === 1 ? '' : 's'} ohne EA-ID** wurden in <#${result.channelId}> gepostet.`
        : `✅ Prüfung abgeschlossen. Aktuell haben alle aktiven Teams eine EA Club-ID hinterlegt. Hinweis wurde in <#${result.channelId}> gepostet.`,
      components: [],
      embeds: [],
    });
  } catch (error) {
    const content = `❌ Teams-ohne-EA-ID-Prüfung fehlgeschlagen: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] }).catch(() => null);
    else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => null);
  }
  return true;
}

async function handleBomberXLocoGraphicsTest(interaction) {
  if (selectedAction(interaction) !== 'admin_bxl_graphics_test') return false;
  try {
    await requireAdmin(interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await postBomberXLocoGraphicsTest({ guild: interaction.guild });
    await interaction.editReply({
      content: [
        `✅ Bomber-X-Loco-Grafiktest wurde vollständig in <#${result.channelId}> gepostet.`,
        `Verwendete aktive Teams: ${result.teamCount}`,
        `Testposts: ${result.messageIds.length}`,
        'Es wurden keine Turnierdaten, Siege, Statistiken oder Rollen verändert.',
      ].join('\n'),
      components: [],
      embeds: [],
    });
  } catch (error) {
    const content = `❌ Bomber-X-Loco-Grafiktest fehlgeschlagen: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] }).catch(() => null);
    else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => null);
  }
  return true;
}

async function handleAdminInteraction(interaction, client) {
  if (await handleBanNavigation(interaction)) return true;
  if (await handleBomberXLocoGraphicsTest(interaction)) return true;
  if (await handleTeamsWithoutEa(interaction, client)) return true;
  return restored.handleAdminInteraction(interaction, client);
}

async function handleInteraction(interaction, client) {
  return handleAdminInteraction(interaction, client);
}

module.exports = {
  ...restored,
  handleAdminButton: handleAdminInteraction,
  handleAdminInteraction,
  handleInteraction,
};
