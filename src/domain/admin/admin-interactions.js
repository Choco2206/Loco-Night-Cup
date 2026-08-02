'use strict';

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
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { refreshCheckinMessage, refreshCheckinMessages } = require('../checkins/checkin-panel');
const { recalculateCheckinFormat } = require('../checkins/checkin-format');
const { adminCheckInTeam, adminWithdrawTeam, removeTeamFromAllEvents } = require('../checkins/checkin-service');
const { readAllEvents, updateEventData } = require('../checkins/checkin-repository');
const { refreshRegisteredTeamsOverview } = require('../teams/team-overview');
const { refreshTeamStreamList } = require('../teams/team-stream-list');
const {
  incrementTeamAchievement,
  refreshTeamAchievementsRankingMessage,
} = require('../teams/team-achievements');
const {
  adminAddCoManager,
  adminChangeManager,
  adminDeleteTeam,
  adminRemoveCoManager,
  adminUpdateTeamName,
  findNonDeletedTeamByUserId,
  findTeamById,
  listVisibleTeams,
} = require('../teams/team-service');
const { syncTeamFunctionRolesForUser } = require('../teams/team-roles');
const { syncChampionRolesForTeam, syncChampionRolesForUser, syncChampionRolesForUsers } = require('../teams/team-champion-roles');
const { clearTeamNickname, setTeamCoManagerNickname, setTeamManagerNickname, syncAllTeamNicknames } = require('../nicknames');
const { ensureUserIsNotBot } = require('../teams/team-validation');
const { addTeamBan, isTeamOrUserBanned, listActiveBans, removeTeamBan } = require('../bans');
const { resetEventForTesting } = require('../events/event-cleanup-service');
const { lockEventFormat, drawGroupsForEvent } = require('../events/event-lock-service');
const { syncTeamGroupAccess } = require('../groups/group-access-sync');
const { forceReleaseNextSlot } = require('../groups/group-releases');
const { createKnockoutPhase } = require('../knockout');
const { CEREMONY_DAY_LABELS, postHallOfFameCeremony, postHallOfFameTest } = require('../ceremony');
const { ensureServerStructure } = require('../setup');
const { createTestDataForEvent, removeTestData } = require('../testdata/testdata-service');
const { prepareGroupScheduleVisualTest, simulateGroupPhase, simulateKnockoutPhase } = require('../testdata/simulation-service');
const { EVENT_KEYS, EVENT_LABELS, LEAGUE_PHASE_FORMATS } = require('../../app/constants');
const {
  refreshManagersWithoutTeamMessage,
  refreshManagersWithoutTeamMessageIfTracked,
} = require('./managers-without-team');
const { buildAdminPanelPayload } = require('./admin-components');
const { refreshGroupPostsForTeam } = require('../groups/group-posts');
const { TEST_VARIANTS, postKoImageTest } = require('../knockout/knockout-image-test');
const { startLeaguePhaseIntegrationTest, stopLeaguePhaseIntegrationTest } = require('../league-phase/league-phase-test');
const { postTeamOfTheTournamentTest } = require('../team-of-the-tournament');

const EPHEMERAL = 64;
const ADMIN_ACTIONS = new Set([
  'admin_nickname_sync',
  'admin_stream_list_sync',
  'admin_checkin_open',
  'admin_checkin_close',
  'admin_checkin_manual',
  'admin_event_reset',
  'admin_format_lock',
  'admin_groups_draw',
  'admin_group_release_current',
  'admin_knockout_create',
  'admin_teams_list',
  'admin_team_details',
  'admin_team_ban',
  'admin_team_unban',
  'admin_checkin_refresh',
  'admin_team_overview_refresh',
  'admin_team_achievement_manual',
  'admin_managers_without_team',
  'admin_ceremony_test',
  'admin_ceremony_post',
  'admin_hof_test',
  'admin_tott_test',
  'admin_bye_add',
  'admin_bye_remove',
  'admin_testdata_create',
  'admin_testdata_remove',
  'admin_simulate_groups',
  'admin_schedule_visual_test',
  'admin_league_phase_test',
  'admin_league_phase_test_stop',
  'admin_ko_images_test',
  'admin_simulate_knockout',
  'admin_server_setup',
]);
const ADMIN_SELECT_IDS = new Set([
  'admin_bye_add_select',
  'admin_bye_remove_select',
  'admin_format_lock_select',
  'admin_groups_draw_select',
  'admin_group_release_current_select',
  'admin_knockout_create_select',
  'admin_event_reset_select',
  'admin_testdata_create_select',
  'admin_simulate_groups_select',
  'admin_schedule_visual_test_select',
  'admin_ko_image_test_select',
  'admin_league_phase_test_select',
  'admin_simulate_knockout_select',
  'admin_ceremony_post_select',
  'admin_team_ban_team_select',
  'admin_team_unban_select',
  'admin_checkin_manual_action_select',
]);
const ADMIN_SELECT_PREFIXES = [
  'admin_checkin_manual_event_select:',
  'admin_checkin_manual_team_select:',
  'admin_hof_first_select',
  'admin_hof_second_select:',
  'admin_hof_third_select:',
  'admin_hof_day_select:',
  'admin_team_details_select:',
  'admin_team_remove_covm_select:',
  'admin_team_ban_team_select:',
  'admin_team_ban_reason_select:',
  'admin_team_ban_duration_select:',
  'admin_team_achievement_team_select:',
  'admin_team_achievement_title_select:',
];
const ADMIN_USER_SELECT_PREFIXES = [
  'admin_team_add_covm_user:',
  'admin_team_change_vm_user:',
];
const ADMIN_BUTTON_PREFIXES = [
  'admin_panel_category:',
  'admin_team_details_page:',
  'admin_team_details_back:',
  'admin_team_edit_name_open:',
  'admin_team_add_covm_open:',
  'admin_team_add_covm_manual_open:',
  'admin_team_remove_covm_open:',
  'admin_team_change_vm_open:',
  'admin_team_change_vm_manual_open:',
  'admin_team_ban_confirm:',
  'admin_team_unban_confirm:',
  'admin_team_delete_open:',
  'admin_team_delete_confirm:',
  'admin_team_delete_cancel:',
  'admin_team_ban_page:',
  'admin_checkin_manual_page:',
  'admin_team_achievement_page:',
  'admin_team_achievement_confirm:',
  'admin_team_achievement_cancel:',
  'admin_hof_first_page:',
  'admin_hof_second_page:',
  'admin_hof_third_page:',
];
const ADMIN_MODAL_PREFIXES = [
  'admin_team_edit_name_modal:',
  'admin_team_add_covm_manual_modal:',
  'admin_team_change_vm_manual_modal:',
  'admin_team_ban_manual_modal:',
];
const TEAM_BAN_PAGE_SIZE = 25;
const TEAM_DETAILS_PAGE_SIZE = 25;
const MANUAL_CHECKIN_PAGE_SIZE = 25;
const TEAM_ACHIEVEMENT_PAGE_SIZE = 25;
const HALL_OF_FAME_TEAM_PAGE_SIZE = 25;
const TEAM_ACHIEVEMENT_TITLES = {
  gold: { label: 'Cup-Sieg', emoji: '🥇' },
  silver: { label: 'Platz 2', emoji: '🥈' },
  bronze: { label: 'Platz 3', emoji: '🥉' },
};

function summarizeNicknameSync(summary) {
  return [
    'Nicknames wurden synchronisiert.',
    `Erfolgreich geaendert: ${summary.changed}`,
    `Bereits korrekt: ${summary.alreadyCorrect}`,
    `Uebersprungen: ${summary.skipped}`,
    `Fehlende Rechte/Hierarchie: ${summary.missingPermissions}`,
    `User nicht mehr auf Server: ${summary.notOnServer}`,
    `Andere Fehler: ${summary.errors}`,
  ].join('\n');
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function hasAnyRole(member, roleIds) {
  return roleIds.filter(Boolean).some(roleId => member.roles.cache.has(String(roleId)));
}

function isAdminAllowed(member, settings) {
  const adminRoleIds = [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ];
  return hasAnyRole(member, [...new Set(adminRoleIds.map(String))]);
}

async function requireAdminAccess(interaction, settings) {
  if (!interaction.guild || !interaction.member) throw new Error('Admin-Panel ist nur auf dem Server nutzbar.');
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (!isAdminAllowed(member, settings)) {
    throw new Error('Du darfst dieses Admin-Panel nicht verwenden.');
  }
}

function formatTeamsList() {
  const teams = listVisibleTeams()
    .slice()
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }));

  if (!teams.length) return 'Noch keine Teams registriert.';

  const lines = teams.map((team, index) => {
    const complete = team.registrationStatus === 'complete' ? 'Vollstaendig' : 'Unvollstaendig';
    const vm = team.manager?.userId ? `<@${team.manager.userId}>` : 'Kein VM';
    const marker = team.isTestTeam ? ' | Testteam' : '';
    return `${index + 1}. **${team.clubName}**${marker}\nStatus: ${team.status} | ${complete}\nVM: ${vm} | Co-VMs: ${team.coManagers.length}`;
  });

  const chunks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;
    if (next.length > 1900) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks[0] + (chunks.length > 1 ? `\n\n... ${chunks.length - 1} weitere Bloecke gekuerzt.` : '');
}

function buildEventSelect(customId, placeholder) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(EVENT_KEYS.map(eventKey => ({
      label: EVENT_LABELS[eventKey] || eventKey,
      value: eventKey,
    })));

  return new ActionRowBuilder().addComponents(select);
}

function isAdminSelectId(customId) {
  return ADMIN_SELECT_IDS.has(customId) || ADMIN_SELECT_PREFIXES.some(prefix => String(customId).startsWith(prefix));
}

function sortedRegisteredTeams(excludeTeamIds = []) {
  const excluded = new Set(excludeTeamIds.filter(Boolean).map(String));
  return listVisibleTeams()
    .filter(team => team.status === 'active')
    .filter(team => !excluded.has(String(team.id)))
    .slice()
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }));
}

function buildTeamSelect(customId, placeholder, excludeTeamIds = []) {
  const teams = sortedRegisteredTeams(excludeTeamIds);
  if (!teams.length) throw new Error('Es gibt keine auswaehlbaren Teams.');

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(teams.slice(0, 25).map(team => ({
      label: team.clubName.slice(0, 100),
      value: String(team.id),
      description: team.logo?.fileName ? `Logo: ${team.logo.fileName}`.slice(0, 100) : 'Logo fehlt',
    })));

  return new ActionRowBuilder().addComponents(select);
}

function clampPage(page, totalPages) {
  const parsed = Number(page);
  if (!Number.isInteger(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), Math.max(totalPages - 1, 0));
}

function buildHallOfFameTeamSelectPayload({
  placement,
  firstTeamId = null,
  secondTeamId = null,
  page = 0,
}) {
  const placementLabels = { first: 'Platz 1', second: 'Platz 2', third: 'Platz 3' };
  const placementLabel = placementLabels[placement];
  if (!placementLabel) throw new Error('Unbekannte Hall-of-Fame-Platzierung.');

  const excludeTeamIds = [firstTeamId, secondTeamId].filter(Boolean);
  const teams = sortedRegisteredTeams(excludeTeamIds);
  if (!teams.length) throw new Error('Es gibt keine auswaehlbaren Teams.');

  const totalPages = Math.max(1, Math.ceil(teams.length / HALL_OF_FAME_TEAM_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const pageTeams = teams.slice(
    currentPage * HALL_OF_FAME_TEAM_PAGE_SIZE,
    (currentPage + 1) * HALL_OF_FAME_TEAM_PAGE_SIZE
  );

  let selectCustomId;
  let previousPageCustomId;
  let nextPageCustomId;
  if (placement === 'first') {
    selectCustomId = `admin_hof_first_select:${currentPage}`;
    previousPageCustomId = `admin_hof_first_page:${currentPage - 1}`;
    nextPageCustomId = `admin_hof_first_page:${currentPage + 1}`;
  } else if (placement === 'second') {
    selectCustomId = `admin_hof_second_select:${firstTeamId}:${currentPage}`;
    previousPageCustomId = `admin_hof_second_page:${firstTeamId}:${currentPage - 1}`;
    nextPageCustomId = `admin_hof_second_page:${firstTeamId}:${currentPage + 1}`;
  } else {
    selectCustomId = `admin_hof_third_select:${firstTeamId}:${secondTeamId}:${currentPage}`;
    previousPageCustomId = `admin_hof_third_page:${firstTeamId}:${secondTeamId}:${currentPage - 1}`;
    nextPageCustomId = `admin_hof_third_page:${firstTeamId}:${secondTeamId}:${currentPage + 1}`;
  }

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(selectCustomId)
        .setPlaceholder(totalPages === 1 ? `${placementLabel} auswaehlen` : `${placementLabel} auswaehlen (${currentPage + 1}/${totalPages})`)
        .addOptions(pageTeams.map(team => ({
          label: team.clubName.slice(0, 100),
          value: String(team.id),
          description: team.logo?.fileName ? `Logo: ${team.logo.fileName}`.slice(0, 100) : 'Logo fehlt',
        })))
    ),
  ];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(previousPageCustomId)
        .setLabel('Zurueck')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(nextPageCustomId)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    ));
  }

  return {
    content: totalPages === 1
      ? `${placementLabel} auswaehlen.`
      : `${placementLabel} auswaehlen.\nSeite ${currentPage + 1}/${totalPages} (${teams.length} Teams)`,
    components,
  };
}

function buildTeamBanSelectPayload(page = 0) {
  const teams = sortedRegisteredTeams();
  if (!teams.length) throw new Error('Es gibt keine auswaehlbaren Teams.');

  const totalPages = Math.max(1, Math.ceil(teams.length / TEAM_BAN_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const pageTeams = teams.slice(currentPage * TEAM_BAN_PAGE_SIZE, (currentPage + 1) * TEAM_BAN_PAGE_SIZE);
  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_team_ban_team_select:${currentPage}`)
        .setPlaceholder(totalPages === 1 ? 'Team auswaehlen' : `Team auswaehlen (${currentPage + 1}/${totalPages})`)
        .addOptions(pageTeams.map(team => ({
          label: team.clubName.slice(0, 100),
          value: String(team.id),
          description: team.logo?.fileName ? `Logo: ${team.logo.fileName}`.slice(0, 100) : 'Logo fehlt',
        })))
    ),
  ];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_team_ban_page:${currentPage - 1}`)
        .setLabel('Zurueck')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`admin_team_ban_page:${currentPage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    ));
  }

  return {
    content: totalPages === 1
      ? 'Welches Team soll gesperrt werden?'
      : `Welches Team soll gesperrt werden?\nSeite ${currentPage + 1}/${totalPages} (${teams.length} Teams)`,
    components,
  };
}

function buildTeamDetailsSelectPayload(page = 0) {
  const teams = sortedRegisteredTeams();
  if (!teams.length) throw new Error('Es gibt keine aktiven/registrierten Teams.');

  const totalPages = Math.max(1, Math.ceil(teams.length / TEAM_DETAILS_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const pageTeams = teams.slice(currentPage * TEAM_DETAILS_PAGE_SIZE, (currentPage + 1) * TEAM_DETAILS_PAGE_SIZE);
  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_team_details_select:${currentPage}`)
        .setPlaceholder(totalPages === 1 ? 'Team auswaehlen' : `Team auswaehlen (${currentPage + 1}/${totalPages})`)
        .addOptions(pageTeams.map(team => ({
          label: team.clubName.slice(0, 100),
          value: String(team.id),
          description: `ID: ${String(team.id).slice(0, 80)}`,
        })))
    ),
  ];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_team_details_page:${currentPage - 1}`)
        .setLabel('Zurueck')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`admin_team_details_page:${currentPage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    ));
  }

  return {
    content: totalPages === 1
      ? 'Team fuer Details/Verwaltung auswaehlen.'
      : `Team fuer Details/Verwaltung auswaehlen.\nSeite ${currentPage + 1}/${totalPages} (${teams.length} Teams)`,
    components,
  };
}

function buildTeamAchievementSelectPayload(page = 0) {
  const teams = sortedRegisteredTeams();
  if (!teams.length) throw new Error('Es gibt keine aktiven Teams.');

  const totalPages = Math.max(1, Math.ceil(teams.length / TEAM_ACHIEVEMENT_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const pageTeams = teams.slice(currentPage * TEAM_ACHIEVEMENT_PAGE_SIZE, (currentPage + 1) * TEAM_ACHIEVEMENT_PAGE_SIZE);
  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_team_achievement_team_select:${currentPage}`)
        .setPlaceholder(totalPages === 1 ? 'Team auswaehlen' : `Team auswaehlen (${currentPage + 1}/${totalPages})`)
        .addOptions(pageTeams.map(team => ({
          label: team.clubName.slice(0, 100),
          value: String(team.id),
          description: `ID: ${String(team.id).slice(0, 80)}`,
        })))
    ),
  ];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_team_achievement_page:${currentPage - 1}`)
        .setLabel('Zurueck')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`admin_team_achievement_page:${currentPage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    ));
  }

  return {
    content: totalPages === 1
      ? 'Welchem Team soll ein Erfolg vergeben werden?'
      : `Welchem Team soll ein Erfolg vergeben werden?\nSeite ${currentPage + 1}/${totalPages} (${teams.length} Teams)`,
    components,
  };
}

function buildTeamAchievementTitleSelect(team) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_team_achievement_title_select:${team.id}`)
      .setPlaceholder('Erfolg auswaehlen')
      .addOptions(Object.entries(TEAM_ACHIEVEMENT_TITLES).map(([key, definition]) => ({
        label: `${definition.emoji} ${definition.label}`,
        value: key,
      })))
  );
}

function buildTeamAchievementConfirmPayload(team, titleKey) {
  const definition = TEAM_ACHIEVEMENT_TITLES[titleKey];
  if (!definition) throw new Error('Dieser Team-Erfolg ist nicht bekannt.');

  return {
    content: `Wirklich **${team.clubName}** +1 ${definition.emoji} **${definition.label}** geben?`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`admin_team_achievement_confirm:${team.id}:${titleKey}`)
          .setLabel('Bestaetigen')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`admin_team_achievement_cancel:${team.id}:${titleKey}`)
          .setLabel('Abbrechen')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function normalizeManualCheckinAction(action) {
  if (action === 'join' || action === 'leave') return action;
  throw new Error('Che…12203 tokens truncated…gs: EPHEMERAL });
      const result = await syncAllTeamNicknames(interaction.guild);
      await interaction.editReply(summarizeNicknameSync(result.summary));
      return true;
    }

    if (actionCustomId === 'admin_stream_list_sync') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = await refreshTeamStreamList(client);
      await interaction.editReply(`📺 Streamliste synchronisiert: ${result.teamCount} Teams in ${result.messageCount} Nachricht(en).`);
      return true;
    }

    if (actionCustomId.startsWith('admin_team_details_page:')) {
      const [, page] = actionCustomId.split(':');
      await interaction.update(buildTeamDetailsSelectPayload(page));
      return true;
    }

    if (actionCustomId.startsWith('admin_team_details_back:')) {
      const [, page] = actionCustomId.split(':');
      await interaction.update({ ...buildTeamDetailsSelectPayload(page), embeds: [] });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_achievement_page:')) {
      const [, page] = actionCustomId.split(':');
      await interaction.update(buildTeamAchievementSelectPayload(page));
      return true;
    }

    if (actionCustomId.startsWith('admin_team_achievement_confirm:')) {
      const [, teamId, titleKey] = actionCustomId.split(':');
      const definition = TEAM_ACHIEVEMENT_TITLES[titleKey];
      if (!definition) throw new Error('Dieser Team-Erfolg ist nicht bekannt.');

      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');

      await interaction.deferUpdate();
      const updatedTeam = incrementTeamAchievement({
        teamId,
        titleKey,
        actorUserId: interaction.user.id,
      });

      await refreshTeamAchievementsRankingMessage({ client, guild: interaction.guild, force: true });
      if (titleKey === 'gold') {
        await syncChampionRolesForTeam(interaction.guild, updatedTeam, settings);
      }

      await postAdminLogMessage(
        client,
        settings,
        `Admin <@${interaction.user.id}> hat ${updatedTeam.clubName} manuell +1 ${definition.emoji} ${definition.label} vergeben.`
      );

      await interaction.editReply({
        content: `✅ **${updatedTeam.clubName}** hat +1 ${definition.emoji} **${definition.label}** erhalten. Team-Erfolge wurden aktualisiert.`,
        embeds: [],
        components: [],
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_achievement_cancel:')) {
      await interaction.update({ content: '❌ Vorgang abgebrochen.', embeds: [], components: [] });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_edit_name_open:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.showModal(buildAdminTeamNameModal(team, settings));
      return true;
    }

    if (actionCustomId.startsWith('admin_team_add_covm_open:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      if ((team.coManagers || []).length >= settings.teams.coManagerLimit) throw new Error('Dieses Team hat bereits das Co-VM-Limit erreicht.');
      await interaction.reply({ ...buildAdminAddCoManagerPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_add_covm_manual_open:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.showModal(buildManualUserModal(`admin_team_add_covm_manual_modal:${team.id}`, 'Co-VM per User-ID'));
      return true;
    }

    if (actionCustomId.startsWith('admin_team_remove_covm_open:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.reply({ ...buildAdminRemoveCoManagerPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_change_vm_open:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.reply({ ...buildAdminChangeManagerPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_change_vm_manual_open:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.showModal(buildManualUserModal(`admin_team_change_vm_manual_modal:${team.id}`, 'VM per User-ID'));
      return true;
    }

    if (actionCustomId.startsWith('admin_team_ban_confirm:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      const ban = addTeamBan(team, 'admin_other', interaction.user.id, 14);
      await interaction.reply({
        content: `Team **${team.clubName}** wurde gesperrt bis ${formatDate(ban.bannedUntilDate || ban.expiresAt)}.`,
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_unban_confirm:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      const removed = removeTeamBan(teamId, interaction.user.id, 'admin_removed');
      if (!removed) throw new Error('Fuer dieses Team wurde keine aktive Sperre gefunden.');
      await interaction.reply({
        content: `Sperre fuer **${team?.clubName || removed.clubName || teamId}** wurde entfernt.`,
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_delete_open:')) {
      const [, teamId] = actionCustomId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      const runningEventLabel = findRunningEventParticipation(team.id);
      if (runningEventLabel) {
        throw new Error(`Team ist noch in einem laufenden Event (${runningEventLabel}) eingetragen. Bitte zuerst im Event sauber ersetzen/entfernen.`);
      }
      await interaction.reply({ ...buildAdminDeleteConfirmPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_delete_confirm:')) {
      const [, teamId] = actionCustomId.split(':');
      await interaction.deferUpdate();
      const result = await handleAdminDeleteTeam({ interaction, client, settings, teamId });
      await interaction.editReply({
        content: `Team **${result.team.clubName}** wurde geloescht. Entfernte Check-ins: ${result.affectedEventKeys.length ? result.affectedEventKeys.map(key => EVENT_LABELS[key] || key).join(', ') : 'keine'}.`,
        embeds: [],
        components: [],
      });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_delete_cancel:')) {
      await interaction.update({ content: 'Team-Loeschung abgebrochen.', embeds: [], components: [] });
      return true;
    }

    if (actionCustomId.startsWith('admin_team_ban_page:')) {
      const [, page] = actionCustomId.split(':');
      await interaction.update(buildTeamBanSelectPayload(page));
      return true;
    }

    if (actionCustomId.startsWith('admin_checkin_manual_page:')) {
      const [, action, eventKey, page] = actionCustomId.split(':');
      await interaction.update(buildManualCheckinTeamSelectPayload(action, eventKey, page));
      return true;
    }

    if (actionCustomId === 'admin_checkin_manual') {
      await interaction.reply({
        content: 'Soll ein Team manuell an- oder abgemeldet werden?',
        components: [buildManualCheckinActionSelect()],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_bye_add') {
      await interaction.reply({
        content: 'Fuer welches Event soll ein Freilos hinzugefuegt werden?',
        components: [buildEventSelect('admin_bye_add_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_bye_remove') {
      await interaction.reply({
        content: 'Fuer welches Event soll ein Freilos entfernt werden?',
        components: [buildEventSelect('admin_bye_remove_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_format_lock') {
      await interaction.reply({
        content: 'Fuer welches Event soll das Format gelockt werden?',
        components: [buildEventSelect('admin_format_lock_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_groups_draw') {
      await interaction.reply({
        content: 'Fuer welches Event sollen Gruppen gezogen werden?',
        components: [buildEventSelect('admin_groups_draw_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_group_release_current') {
      await interaction.reply({
        content: 'Fuer welches Event soll der aktuelle Spieltag sofort freigegeben werden?',
        components: [buildEventSelect('admin_group_release_current_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_knockout_create') {
      await interaction.reply({
        content: 'Fuer welches Event soll die K.O.-Phase erstellt werden?',
        components: [buildEventSelect('admin_knockout_create_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_event_reset') {
      await interaction.reply({
        content: 'Fuer welches Event soll der Reset vorbereitet werden?',
        components: [buildEventSelect('admin_event_reset_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_testdata_create') {
      await interaction.reply({
        content: 'Fuer welches Event sollen Testdaten erzeugt und eingecheckt werden?',
        components: [buildEventSelect('admin_testdata_create_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_simulate_groups') {
      await interaction.reply({
        content: 'Fuer welches Event soll die Gruppenphase simuliert werden?',
        components: [buildEventSelect('admin_simulate_groups_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_simulate_knockout') {
      await interaction.reply({
        content: 'Fuer welches Event soll die K.O.-Phase simuliert werden?',
        components: [buildEventSelect('admin_simulate_knockout_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId.startsWith('admin_hof_first_page:')) {
      const [, page] = actionCustomId.split(':');
      await interaction.update(buildHallOfFameTeamSelectPayload({ placement: 'first', page }));
      return true;
    }

    if (actionCustomId === 'admin_schedule_visual_test') {
      await interaction.reply({
        content: 'Fuer welches Event soll die Spielplan-Grafik mit allen sechs Zustaenden vorbereitet werden?',
        components: [buildEventSelect('admin_schedule_visual_test_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_league_phase_test') {
      await interaction.reply({
        content: 'Welches Ligaphasenformat soll vollständig getestet werden?',
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('admin_league_phase_test_select').setPlaceholder('Ligaphasentest auswaehlen').addOptions([
            { value: '14', label: '14er-Liga', description: '14 Teams, 7 Spiele je Spieltag, 28 insgesamt' },
            { value: '18', label: '18er-Liga', description: '18 Teams, 9 Spiele je Spieltag, 36 insgesamt' },
            { value: '20', label: '20er-Liga', description: '20 Teams, 10 Spiele je Spieltag, 40 insgesamt' },
          ])
        )],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_league_phase_test_stop') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = await stopLeaguePhaseIntegrationTest({ guild: interaction.guild });
      await interaction.editReply({ content: `${result.size}er-Ligaphasentest wurde vollständig bereinigt.` });
      return true;
    }

    if (actionCustomId === 'admin_ko_images_test') {
      await interaction.reply({
        content: 'Welche K.O.-Bildvorlage soll getestet werden?',
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('admin_ko_image_test_select')
            .setPlaceholder('K.O.-Bild auswaehlen')
            .addOptions(Object.entries(TEST_VARIANTS).map(([value, variant]) => ({
              value,
              label: variant.label,
              description: `${variant.label} im Bild-Testkanal rendern`,
            })))
        )],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId.startsWith('admin_hof_second_page:')) {
      const [, firstTeamId, page] = actionCustomId.split(':');
      await interaction.update(buildHallOfFameTeamSelectPayload({ placement: 'second', firstTeamId, page }));
      return true;
    }

    if (actionCustomId.startsWith('admin_hof_third_page:')) {
      const [, firstTeamId, secondTeamId, page] = actionCustomId.split(':');
      await interaction.update(buildHallOfFameTeamSelectPayload({
        placement: 'third',
        firstTeamId,
        secondTeamId,
        page,
      }));
      return true;
    }

    if (actionCustomId === 'admin_hof_test') {
      const teams = sortedRegisteredTeams();
      if (teams.length < 3) throw new Error('Fuer den Hall-of-Fame-Test werden mindestens drei registrierte Teams benoetigt.');
      await interaction.reply({
        ...buildHallOfFameTeamSelectPayload({ placement: 'first' }),
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_ceremony_post') {
      await interaction.reply({
        content: 'Fuer welches Event soll die Siegerehrung gepostet werden?',
        components: [buildEventSelect('admin_ceremony_post_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_server_setup') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = await ensureServerStructure({
        guild: interaction.guild,
        actorUserId: interaction.user.id,
      });
      await interaction.editReply({
        content: [
          'Serverstruktur wurde geprueft und eingerichtet.',
          summarizeSetupItems(result.roles.created, 'Rollen erstellt'),
          summarizeSetupItems(result.roles.reused, 'Rollen wiederverwendet'),
          summarizeSetupItems(result.categories.created, 'Kategorien erstellt'),
          summarizeSetupItems(result.categories.reused, 'Kategorien wiederverwendet'),
          summarizeSetupItems(result.channels.created, 'Kanaele erstellt'),
          summarizeSetupItems(result.channels.reused, 'Kanaele wiederverwendet'),
          result.roles.assigned.length ? 'Admin-Rolle wurde dir fuer dieses Setup zugewiesen.' : null,
          'IDs wurden in settings.json gespeichert. Teams, Logos, Events und Check-ins wurden nicht geloescht oder zurueckgesetzt.',
        ].filter(Boolean).join('\n'),
      });
      return true;
    }

    if (actionCustomId === 'admin_team_ban') {
      await interaction.reply({
        ...buildTeamBanSelectPayload(0),
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_team_unban') {
      await interaction.reply({
        content: 'Welche aktive Sperre soll entfernt werden?',
        components: [buildActiveBanSelect()],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_testdata_remove') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = removeTestData();
      await refreshRegisteredTeamsOverview(client).catch(() => null);
      await refreshCheckinMessages(EVENT_KEYS, client);
      await interaction.editReply(`Testdaten wurden entfernt: ${result.removedCheckins || 0} temporaere Check-ins entfernt und ${result.removedIds.length} alte synthetische Testteams bereinigt. Echte Teams wurden nicht geloescht.`);
      return true;
    }

    if (actionCustomId === 'admin_checkin_refresh') {
      await interaction.deferReply({ flags: EPHEMERAL });
      await refreshCheckinMessages(EVENT_KEYS, client);
      await interaction.editReply('Alle Check-in Panels wurden aktualisiert.');
      return true;
    }

    if (actionCustomId === 'admin_team_overview_refresh') {
      await interaction.deferReply({ flags: EPHEMERAL });
      await refreshRegisteredTeamsOverview(client);
      await interaction.editReply('Teamuebersicht wurde aktualisiert.');
      return true;
    }

    if (actionCustomId === 'admin_tott_test') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = await postTeamOfTheTournamentTest(client);
      await interaction.editReply(`TOTT-Grafiktest wurde in <#${result.channelId}> gepostet (Testausgabe #${result.serialNumber}).`);
      return true;
    }

    if (actionCustomId === 'admin_managers_without_team') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = await refreshManagersWithoutTeamMessage({ client, guild: interaction.guild, force: true });
      await interaction.editReply([
        'Manager-ohne-Team-Liste wurde aktualisiert.',
        `Betroffene Manager: ${result.affectedCount}`,
        `Nachrichten: ${result.messageIds.length}`,
      ].join('\n'));
      return true;
    }

    if (actionCustomId === 'admin_team_achievement_manual') {
      await interaction.reply({
        ...buildTeamAchievementSelectPayload(0),
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_teams_list') {
      await interaction.reply({
        content: formatTeamsList(),
        flags: EPHEMERAL,
        allowedMentions: { parse: ['users'] },
      });
      return true;
    }

    if (actionCustomId === 'admin_team_details') {
      await interaction.reply({
        ...buildTeamDetailsSelectPayload(0),
        flags: EPHEMERAL,
      });
      return true;
    }

    if (actionCustomId === 'admin_ceremony_test') {
      await interaction.reply({ content: 'Ceremony-Test wird in spaeterer Phase implementiert.', flags: EPHEMERAL });
      return true;
    }

    await interaction.reply({ content: 'Funktion folgt in spaeterer Phase.', flags: EPHEMERAL });
    return true;
  } catch (error) {
    await replyInteraction(interaction, error?.message || 'Admin-Aktion konnte nicht verarbeitet werden.', { components: [] });
    return true;
  }
}

module.exports = {
  handleAdminButton: handleAdminInteraction,
  handleAdminInteraction,
};

