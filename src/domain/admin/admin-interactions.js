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
const { removeTeamFromAllEvents } = require('../checkins/checkin-service');
const { readAllEvents, updateEventData } = require('../checkins/checkin-repository');
const { refreshRegisteredTeamsOverview } = require('../teams/team-overview');
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
const { clearTeamNickname, setTeamCoManagerNickname, setTeamManagerNickname } = require('../nicknames');
const { ensureUserIsNotBot } = require('../teams/team-validation');
const { addTeamBan, isTeamOrUserBanned, listActiveBans, removeTeamBan } = require('../bans');
const { resetEventForTesting } = require('../events/event-cleanup-service');
const { lockEventFormat, drawGroupsForEvent } = require('../events/event-lock-service');
const { forceReleaseNextSlot } = require('../groups/group-releases');
const { createKnockoutPhase } = require('../knockout');
const { CEREMONY_DAY_LABELS, postHallOfFameCeremony, postHallOfFameTest } = require('../ceremony');
const { ensureServerStructure } = require('../setup');
const { createTestDataForEvent, removeTestData } = require('../testdata/testdata-service');
const { simulateGroupPhase, simulateKnockoutPhase } = require('../testdata/simulation-service');
const { EVENT_KEYS, EVENT_LABELS } = require('../../app/constants');

const EPHEMERAL = 64;
const ADMIN_ACTIONS = new Set([
  'admin_checkin_open',
  'admin_checkin_close',
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
  'admin_ceremony_test',
  'admin_ceremony_post',
  'admin_hof_test',
  'admin_bye_add',
  'admin_bye_remove',
  'admin_testdata_create',
  'admin_testdata_remove',
  'admin_simulate_groups',
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
  'admin_simulate_knockout_select',
  'admin_ceremony_post_select',
  'admin_team_ban_team_select',
  'admin_team_unban_select',
]);
const ADMIN_SELECT_PREFIXES = [
  'admin_hof_first_select',
  'admin_hof_second_select:',
  'admin_hof_third_select:',
  'admin_hof_day_select:',
  'admin_team_details_select:',
  'admin_team_remove_covm_select:',
  'admin_team_ban_team_select:',
  'admin_team_ban_reason_select:',
  'admin_team_ban_duration_select:',
];
const ADMIN_USER_SELECT_PREFIXES = [
  'admin_team_add_covm_user:',
  'admin_team_change_vm_user:',
];
const ADMIN_BUTTON_PREFIXES = [
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
];
const ADMIN_MODAL_PREFIXES = [
  'admin_team_edit_name_modal:',
  'admin_team_add_covm_manual_modal:',
  'admin_team_change_vm_manual_modal:',
  'admin_team_ban_manual_modal:',
];
const TEAM_BAN_PAGE_SIZE = 25;
const TEAM_DETAILS_PAGE_SIZE = 25;

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

function formatDate(value) {
  if (!value) return 'Nicht vorhanden';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
}

function mentionWithId(userId) {
  return userId ? `<@${userId}> (${userId})` : 'Nicht eingetragen';
}

function formatTeamBanStatus(team) {
  const ban = isTeamOrUserBanned(team);
  if (!ban) return 'Keine aktive Sperre';
  const reason = ban.customReason || ban.reason || 'Nicht angegeben';
  return [`Aktiv`, `Grund: ${reason}`, `Bis: ${formatDate(ban.bannedUntilDate || ban.expiresAt)}`].join('\n');
}

function formatLogoStatus(team) {
  if (team.logo?.fileName) return `Vorhanden: ${team.logo.fileName}`;
  if (team.logoUpload?.expiresAt) return `Upload offen bis ${formatDate(team.logoUpload.expiresAt)}`;
  return 'Fehlt';
}

function formatCheckinStatuses(teamId) {
  const events = readAllEvents();
  const lines = [];
  for (const eventKey of EVENT_KEYS) {
    const event = events[eventKey];
    const entry = (event.checkin?.entries || []).find(item => String(item.teamId) === String(teamId));
    const active = (event.checkin?.activeTeamIds || []).map(String).includes(String(teamId));
    const waitlist = (event.checkin?.waitlistTeamIds || []).map(String).includes(String(teamId));
    let status = 'Nicht eingecheckt';
    if (active) status = 'Aktiv';
    else if (waitlist) status = 'Warteliste';
    else if (entry) status = 'Eingecheckt';
    lines.push(`${EVENT_LABELS[eventKey] || eventKey}: ${status}${entry?.checkedInAt ? ` (${formatDate(entry.checkedInAt)})` : ''}`);
  }
  return lines.join('\n') || 'Keine Check-in-Daten';
}

function buildTeamDetailsEmbed(team) {
  const coManagers = (team.coManagers || []).length
    ? team.coManagers.map(co => mentionWithId(co.userId)).join('\n')
    : 'Keine Co-VMs';

  return new EmbedBuilder()
    .setTitle(`Team verwalten: ${team.clubName}`)
    .setColor(team.status === 'active' ? 0x00aa55 : 0xffaa00)
    .addFields(
      { name: 'Teamname', value: team.clubName || '-', inline: true },
      { name: 'Team-ID', value: String(team.id), inline: true },
      { name: 'Status', value: `${team.status || '-'} / ${team.registrationStatus || '-'}`, inline: true },
      { name: 'VM', value: mentionWithId(team.manager?.userId), inline: false },
      { name: `Co-VMs (${(team.coManagers || []).length})`, value: coManagers.slice(0, 1024), inline: false },
      { name: 'Registrierung', value: formatDate(team.meta?.createdAt), inline: true },
      { name: 'Sperrstatus', value: formatTeamBanStatus(team).slice(0, 1024), inline: true },
      { name: 'Logo', value: formatLogoStatus(team).slice(0, 1024), inline: true },
      { name: 'Check-ins', value: formatCheckinStatuses(team.id).slice(0, 1024), inline: false }
    )
    .setFooter({ text: `Admin-Aktionen laufen eindeutig ueber Team-ID ${team.id}` })
    .setTimestamp(new Date());
}

function buildTeamDetailsButtons(team) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin_team_edit_name_open:${team.id}`).setLabel('Team bearbeiten').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`admin_team_add_covm_open:${team.id}`).setLabel('Co-VM hinzufuegen').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`admin_team_remove_covm_open:${team.id}`).setLabel('Co-VM entfernen').setStyle(ButtonStyle.Secondary).setDisabled(!(team.coManagers || []).length),
      new ButtonBuilder().setCustomId(`admin_team_change_vm_open:${team.id}`).setLabel('VM aendern').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin_team_ban_confirm:${team.id}`).setLabel('Team sperren').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_team_unban_confirm:${team.id}`).setLabel('Sperre entfernen').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`admin_team_delete_open:${team.id}`).setLabel('Team loeschen').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('admin_team_details_back:0').setLabel('Zurueck zur Team-Auswahl').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildTeamDetailsPayload(team) {
  return {
    content: null,
    embeds: [buildTeamDetailsEmbed(team)],
    components: buildTeamDetailsButtons(team),
    allowedMentions: { parse: ['users'] },
  };
}

function buildAdminTeamNameModal(team, settings) {
  const modal = new ModalBuilder()
    .setCustomId(`admin_team_edit_name_modal:${team.id}`)
    .setTitle('Team bearbeiten');

  const input = new TextInputBuilder()
    .setCustomId('new_club_name')
    .setLabel('Teamname')
    .setStyle(TextInputStyle.Short)
    .setMinLength(settings.teams.clubNameMinLength)
    .setMaxLength(settings.teams.clubNameMaxLength)
    .setRequired(true)
    .setValue(team.clubName);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildManualUserModal(customId, title) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  const input = new TextInputBuilder()
    .setCustomId('user_id')
    .setLabel('Discord User-ID')
    .setStyle(TextInputStyle.Short)
    .setMinLength(17)
    .setMaxLength(25)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildAdminAddCoManagerPayload(team) {
  return {
    content: `Neuen Co-VM fuer **${team.clubName}** auswaehlen oder per User-ID eingeben.`,
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`admin_team_add_covm_user:${team.id}`)
          .setPlaceholder('Discord User auswaehlen')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`admin_team_add_covm_manual_open:${team.id}`)
          .setLabel('User-ID eingeben')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildAdminChangeManagerPayload(team) {
  return {
    content: `Neuen VM fuer **${team.clubName}** auswaehlen oder per User-ID eingeben. Der alte VM wird entfernt.`,
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`admin_team_change_vm_user:${team.id}`)
          .setPlaceholder('Neuen VM auswaehlen')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`admin_team_change_vm_manual_open:${team.id}`)
          .setLabel('User-ID eingeben')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildAdminRemoveCoManagerPayload(team) {
  if (!(team.coManagers || []).length) throw new Error('Dieses Team hat keine Co-VMs.');
  return {
    content: `Co-VM aus **${team.clubName}** entfernen.`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`admin_team_remove_covm_select:${team.id}`)
          .setPlaceholder('Co-VM auswaehlen')
          .addOptions(team.coManagers.slice(0, 25).map(co => ({
            label: String(co.userId).slice(0, 100),
            value: String(co.userId),
            description: `User-ID: ${String(co.userId).slice(0, 90)}`,
          })))
      ),
    ],
  };
}

function buildAdminDeleteConfirmPayload(team) {
  return {
    content: `Team **${team.clubName}** wirklich loeschen? Check-ins werden entfernt, Rollen und Nicknames werden bereinigt.`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_team_delete_confirm:${team.id}`).setLabel('Ja, Team loeschen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_team_delete_cancel:${team.id}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

async function resolveAdminSelectedMember(guild, userId) {
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) throw new Error('User nicht gefunden oder nicht auf dem Server.');
  ensureUserIsNotBot(member.user);
  return member;
}

function assertUserCanJoinTeam(userId, teamId) {
  const existingTeam = findNonDeletedTeamByUserId(userId);
  if (existingTeam && String(existingTeam.id) !== String(teamId)) {
    throw new Error(`Dieser User ist bereits bei ${existingTeam.clubName} eingetragen.`);
  }
  if (isTeamOrUserBanned(String(userId))) {
    throw new Error('Dieser User ist aktuell gesperrt.');
  }
}

async function syncTeamNicknames(guild, team) {
  const results = [];
  if (team?.manager?.userId) results.push(await setTeamManagerNickname(guild, team.manager.userId, team));
  for (const coManager of team?.coManagers || []) {
    if (coManager?.userId) results.push(await setTeamCoManagerNickname(guild, coManager.userId, team));
  }
  return results;
}

function assertNicknameResults(results) {
  const failed = (results || []).find(result => result && !result.ok && (
    result.status === 'missing_permissions' || result.status === 'missing_access'
  ));
  if (failed) throw new Error('Daten gespeichert, aber Nickname konnte wegen fehlender Discord-Rechte nicht gesetzt/bereinigt werden.');
}

async function refreshTeamAdminSurfaces({ client, settings, affectedEventKeys = [] }) {
  await refreshRegisteredTeamsOverview(client);
  if (affectedEventKeys.length) await refreshCheckinMessages([...new Set(affectedEventKeys)], client);
}

function teamAppearsInCollection(value, teamId) {
  const id = String(teamId);
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some(entry => teamAppearsInCollection(entry, id));
  }
  if (typeof value === 'object') {
    if (value.teamId && String(value.teamId) === id) return true;
    if (value.id && String(value.id) === id) return true;
    if (value.homeTeamId && String(value.homeTeamId) === id) return true;
    if (value.awayTeamId && String(value.awayTeamId) === id) return true;
    return Object.values(value).some(entry => teamAppearsInCollection(entry, id));
  }
  return String(value) === id;
}

function findRunningEventParticipation(teamId) {
  const events = readAllEvents();
  for (const eventKey of EVENT_KEYS) {
    const event = events[eventKey];
    const hasGroup = event.groups?.status && !['not_created', 'completed', 'reset'].includes(event.groups.status);
    const hasKnockout = event.knockout?.status && !['not_created', 'completed', 'reset'].includes(event.knockout.status);
    if ((hasGroup && teamAppearsInCollection(event.groups, teamId)) || (hasKnockout && teamAppearsInCollection(event.knockout, teamId))) {
      return EVENT_LABELS[eventKey] || eventKey;
    }
  }
  return null;
}

async function handleAdminAddCoManager({ interaction, client, settings, teamId, userId }) {
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  await resolveAdminSelectedMember(interaction.guild, userId);
  assertUserCanJoinTeam(userId, team.id);

  const updatedTeam = adminAddCoManager({ teamId: team.id, userId, actorUserId: interaction.user.id, settings });
  await syncTeamFunctionRolesForUser(interaction.guild, userId, settings);
  const nicknameResults = [await setTeamCoManagerNickname(interaction.guild, userId, updatedTeam)];
  assertNicknameResults(nicknameResults);
  await refreshTeamAdminSurfaces({ client, settings });
  return updatedTeam;
}

async function handleAdminRemoveCoManager({ interaction, client, settings, teamId, userId }) {
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  const updatedTeam = adminRemoveCoManager({ teamId: team.id, userId, actorUserId: interaction.user.id });
  await syncTeamFunctionRolesForUser(interaction.guild, userId, settings);
  const nicknameResults = [await clearTeamNickname(interaction.guild, userId)];
  assertNicknameResults(nicknameResults);
  await refreshTeamAdminSurfaces({ client, settings });
  return updatedTeam;
}

async function handleAdminChangeManager({ interaction, client, settings, teamId, userId }) {
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  await resolveAdminSelectedMember(interaction.guild, userId);
  assertUserCanJoinTeam(userId, team.id);

  const result = adminChangeManager({ teamId: team.id, newManagerUserId: userId, actorUserId: interaction.user.id });
  await syncTeamFunctionRolesForUser(interaction.guild, userId, settings);
  if (result.oldManagerUserId) await syncTeamFunctionRolesForUser(interaction.guild, result.oldManagerUserId, settings);
  const nicknameResults = [
    await setTeamManagerNickname(interaction.guild, userId, result.team),
    result.oldManagerUserId ? await clearTeamNickname(interaction.guild, result.oldManagerUserId) : null,
  ].filter(Boolean);
  assertNicknameResults(nicknameResults);
  await refreshTeamAdminSurfaces({ client, settings });
  return result;
}

async function handleAdminDeleteTeam({ interaction, client, settings, teamId }) {
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  const runningEventLabel = findRunningEventParticipation(team.id);
  if (runningEventLabel) {
    throw new Error(`Team ist noch in einem laufenden Event (${runningEventLabel}) eingetragen. Bitte zuerst im Event sauber ersetzen/entfernen.`);
  }

  const userIds = [team.manager?.userId, ...(team.coManagers || []).map(co => co.userId)].filter(Boolean).map(String);
  adminDeleteTeam({ teamId: team.id, actorUserId: interaction.user.id });
  const affectedEventKeys = removeTeamFromAllEvents({ teamId: team.id, settings });
  for (const userId of userIds) {
    await syncTeamFunctionRolesForUser(interaction.guild, userId, settings);
    await clearTeamNickname(interaction.guild, userId);
  }
  await refreshTeamAdminSurfaces({ client, settings, affectedEventKeys });
  return { team, affectedEventKeys };
}

const BAN_REASON_OPTIONS = [
  { label: 'Abmeldung nach Anmeldeschluss', value: 'late_withdrawal' },
  { label: 'Nicht erschienen', value: 'no_show' },
  { label: 'Turnier verlassen', value: 'left_tournament' },
  { label: 'Ohne Abmeldung verlassen', value: 'left_tournament_no_notice' },
  { label: 'Beleidigung/Respektlosigkeit', value: 'disrespect' },
  { label: 'Sonstiger Regelverstoss', value: 'admin_other' },
  { label: 'Manueller Grund', value: 'manual_reason' },
];

function buildBanReasonSelect(teamId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_team_ban_reason_select:${teamId}`)
      .setPlaceholder('Sperrgrund auswaehlen')
      .addOptions(BAN_REASON_OPTIONS)
  );
}

function buildBanDurationSelect(teamId, reason) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_team_ban_duration_select:${teamId}:${reason}`)
      .setPlaceholder('Dauer auswaehlen')
      .addOptions([
        { label: '7 Tage', value: '7' },
        { label: '14 Tage', value: '14' },
        { label: '30 Tage', value: '30' },
        { label: 'Manuell', value: 'manual' },
      ])
  );
}

function buildBanManualModal(teamId, reason, durationValue) {
  const modal = new ModalBuilder()
    .setCustomId(`admin_team_ban_manual_modal:${teamId}:${reason}:${durationValue}`)
    .setTitle('Team sperren');

  const reasonInput = new TextInputBuilder()
    .setCustomId('ban_reason')
    .setLabel('Manueller Grund')
    .setStyle(TextInputStyle.Short)
    .setRequired(reason === 'manual_reason')
    .setMaxLength(120);

  const daysInput = new TextInputBuilder()
    .setCustomId('ban_days')
    .setLabel('Dauer in Tagen')
    .setStyle(TextInputStyle.Short)
    .setRequired(durationValue === 'manual')
    .setMaxLength(3);

  if (durationValue !== 'manual') daysInput.setValue(String(durationValue));

  modal.addComponents(
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(daysInput)
  );
  return modal;
}

function buildActiveBanSelect() {
  const activeBans = listActiveBans().filter(ban => ban.teamId || ban.team?.teamId || ban.targets?.teamId);
  if (!activeBans.length) throw new Error('Aktuell gibt es keine aktiven Sperren.');

  const select = new StringSelectMenuBuilder()
    .setCustomId('admin_team_unban_select')
    .setPlaceholder('Sperre auswaehlen')
    .addOptions(activeBans.slice(0, 25).map(ban => ({
      label: String(ban.clubName || ban.team?.clubNameSnapshot || ban.teamId || 'Unbekanntes Team').slice(0, 100),
      value: String(ban.teamId || ban.team?.teamId || ban.targets?.teamId),
      description: String(ban.customReason || ban.reason || 'Sperre').slice(0, 100),
    })));

  return new ActionRowBuilder().addComponents(select);
}

function buildHallOfFameDaySelect(firstTeamId, secondTeamId, thirdTeamId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`admin_hof_day_select:${firstTeamId}:${secondTeamId}:${thirdTeamId}`)
    .setPlaceholder('Wochentag auswaehlen')
    .addOptions(Object.entries(CEREMONY_DAY_LABELS).map(([value, label]) => ({ label, value })));

  return new ActionRowBuilder().addComponents(select);
}

function summarizeSetupItems(items, label) {
  if (!items.length) return `${label}: 0`;
  const shown = items.slice(0, 8).map(item => item.name).join(', ');
  const suffix = items.length > 8 ? `, +${items.length - 8} weitere` : '';
  return `${label}: ${items.length} (${shown}${suffix})`;
}

function nextByeNumber(eventKey, byes) {
  let max = 0;
  for (const bye of byes || []) {
    const match = String(bye?.id || '').match(new RegExp(`^bye_${eventKey}_(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function addManualBye(eventKey, actorUserId, settings) {
  updateEventData(eventKey, event => {
    if (event.format?.lockedAt) throw new Error('Nach dem Format-Lock koennen keine Freilose mehr hinzugefuegt werden.');
    event.byes = Array.isArray(event.byes) ? event.byes : [];
    const number = nextByeNumber(eventKey, event.byes);
    event.byes.push({
      type: 'bye',
      status: 'active',
      id: `bye_${eventKey}_${number}`,
      displayName: 'Freilos',
      addedAt: new Date().toISOString(),
      addedByUserId: String(actorUserId),
    });
    recalculateCheckinFormat(event, settings);
    return event;
  });
}

function removeManualBye(eventKey, actorUserId, settings) {
  let removed = false;
  updateEventData(eventKey, event => {
    if (event.format?.lockedAt) throw new Error('Nach dem Format-Lock koennen keine Freilose mehr entfernt werden.');
    event.byes = Array.isArray(event.byes) ? event.byes : [];
    const index = event.byes.map(bye => bye?.type === 'bye' && bye?.status !== 'removed').lastIndexOf(true);
    if (index === -1) throw new Error('Fuer dieses Event gibt es kein Freilos.');

    event.byes[index] = {
      ...event.byes[index],
      status: 'removed',
      removedAt: new Date().toISOString(),
      removedByUserId: String(actorUserId),
    };
    removed = true;
    recalculateCheckinFormat(event, settings);
    return event;
  });
  return removed;
}

async function replyInteraction(interaction, content, extra = {}) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, ...extra }).catch(() => {});
  } else {
    await interaction.reply({ content, flags: EPHEMERAL, ...extra }).catch(() => {});
  }
}

async function handleAdminSelect(interaction, client, settings) {
  if (interaction.customId.startsWith('admin_team_details_select:')) {
    const teamId = interaction.values?.[0];
    const team = findTeamById(teamId);
    if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
    await interaction.update(buildTeamDetailsPayload(team));
    return true;
  }

  if (interaction.customId.startsWith('admin_team_remove_covm_select:')) {
    const [, teamId] = interaction.customId.split(':');
    const userId = interaction.values?.[0];
    await interaction.deferUpdate();
    const updatedTeam = await handleAdminRemoveCoManager({ interaction, client, settings, teamId, userId });
    await interaction.editReply({
      content: `<@${userId}> wurde als Co-VM bei **${updatedTeam.clubName}** entfernt.`,
      embeds: [],
      components: [],
      allowedMentions: { parse: ['users'] },
    });
    return true;
  }

  if (interaction.customId === 'admin_hof_first_select') {
    const firstTeamId = interaction.values?.[0];
    await interaction.update({
      content: 'Platz 2 auswaehlen.',
      components: [buildTeamSelect(`admin_hof_second_select:${firstTeamId}`, 'Platz 2 auswaehlen', [firstTeamId])],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_hof_second_select:')) {
    const [, firstTeamId] = interaction.customId.split(':');
    const secondTeamId = interaction.values?.[0];
    await interaction.update({
      content: 'Platz 3 auswaehlen.',
      components: [buildTeamSelect(`admin_hof_third_select:${firstTeamId}:${secondTeamId}`, 'Platz 3 auswaehlen', [firstTeamId, secondTeamId])],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_hof_third_select:')) {
    const [, firstTeamId, secondTeamId] = interaction.customId.split(':');
    const thirdTeamId = interaction.values?.[0];
    await interaction.update({
      content: 'Wochentag fuer den Hall-of-Fame-Test auswaehlen.',
      components: [buildHallOfFameDaySelect(firstTeamId, secondTeamId, thirdTeamId)],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_hof_day_select:')) {
    const [, firstTeamId, secondTeamId, thirdTeamId] = interaction.customId.split(':');
    const dayKey = interaction.values?.[0];
    await interaction.deferUpdate();
    const result = await postHallOfFameTest({
      guild: interaction.guild,
      dayKey,
      firstTeamId,
      secondTeamId,
      thirdTeamId,
    });
    await interaction.editReply({
      content: [
        `Hall-of-Fame-Test wurde in <#${result.channelId}> gepostet.`,
        `Wochentag: ${result.dayLabel}`,
        `1. ${result.teams.first.clubName}`,
        `2. ${result.teams.second.clubName}`,
        `3. ${result.teams.third.clubName}`,
      ].join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_team_ban_team_select' || interaction.customId.startsWith('admin_team_ban_team_select:')) {
    const teamId = interaction.values?.[0];
    const team = findTeamById(teamId);
    if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
    await interaction.update({
      content: `Sperrgrund fuer **${team.clubName}** auswaehlen.`,
      components: [buildBanReasonSelect(team.id)],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_team_ban_reason_select:')) {
    const [, teamId] = interaction.customId.split(':');
    const reason = interaction.values?.[0];
    const team = findTeamById(teamId);
    if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
    await interaction.update({
      content: `Sperrdauer fuer **${team.clubName}** auswaehlen.`,
      components: [buildBanDurationSelect(team.id, reason)],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_team_ban_duration_select:')) {
    const [, teamId, reason] = interaction.customId.split(':');
    const durationValue = interaction.values?.[0];
    const team = findTeamById(teamId);
    if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');

    if (durationValue === 'manual' || reason === 'manual_reason') {
      await interaction.showModal(buildBanManualModal(team.id, reason, durationValue));
      return true;
    }

    await interaction.deferUpdate();
    const ban = addTeamBan(team, reason, interaction.user.id, Number(durationValue));
    await interaction.editReply({
      content: `Team **${team.clubName}** wurde bis ${new Date(ban.bannedUntilDate || ban.expiresAt).toLocaleString('de-DE')} gesperrt.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_team_unban_select') {
    const teamId = interaction.values?.[0];
    await interaction.deferUpdate();
    const removed = removeTeamBan(teamId, interaction.user.id, 'admin_removed');
    if (!removed) throw new Error('Fuer dieses Team wurde keine aktive Sperre gefunden.');
    await interaction.editReply({
      content: `Sperre fuer **${removed.clubName || removed.team?.clubNameSnapshot || teamId}** wurde entfernt.`,
      components: [],
    });
    return true;
  }

  const eventKey = interaction.values?.[0];
  if (!EVENT_KEYS.includes(eventKey)) throw new Error('Event nicht gefunden.');

  await interaction.deferReply({ flags: EPHEMERAL });

  if (interaction.customId === 'admin_bye_add_select') {
    addManualBye(eventKey, interaction.user.id, settings);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({ content: `Freilos fuer ${EVENT_LABELS[eventKey]} wurde hinzugefuegt.`, components: [] });
    return true;
  }

  if (interaction.customId === 'admin_bye_remove_select') {
    removeManualBye(eventKey, interaction.user.id, settings);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({ content: `Freilos fuer ${EVENT_LABELS[eventKey]} wurde entfernt.`, components: [] });
    return true;
  }

  if (interaction.customId === 'admin_format_lock_select') {
    const result = lockEventFormat(eventKey, interaction.user.id);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({
      content: `Format fuer ${EVENT_LABELS[eventKey]} wurde gelockt: ${result.size}er Turnier mit ${result.participants.length} Teilnehmerplaetzen. Warteliste: ${result.waitlistTeamIds.length} Teams, ${result.waitlistByeCount} Freilose.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_groups_draw_select') {
    const result = await drawGroupsForEvent({
      eventKey,
      actorUserId: interaction.user.id,
      client,
      guild: interaction.guild,
    });
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({
      content: `Gruppen fuer ${EVENT_LABELS[eventKey]} wurden gezogen: ${Object.keys(result.groups).length} Gruppen erstellt.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_group_release_current_select') {
    const result = await forceReleaseNextSlot(client, eventKey);
    await interaction.editReply({
      content: `Spieltag ${result.slot} fuer ${EVENT_LABELS[eventKey]} wurde sofort freigegeben.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_knockout_create_select') {
    const result = await createKnockoutPhase({
      eventKey,
      actorUserId: interaction.user.id,
      client,
      guild: interaction.guild,
    });
    await interaction.editReply({
      content: [
        `K.O.-Phase fuer ${EVENT_LABELS[eventKey]} wurde erstellt.`,
        `Qualifiziert: ${result.knockout.qualifiedTeams.length} Teams`,
        `Erste Runde: ${result.knockout.firstRoundKey}`,
        result.post?.categoryId ? `Kategorie: ${result.post.categoryId}` : null,
        result.post?.overviewChannelId ? `Uebersicht: <#${result.post.overviewChannelId}>` : 'K.O.-Uebersicht konnte nicht erstellt/gepostet werden.',
        result.post?.roundPosts?.length ? `Rundenkanaele: ${result.post.roundPosts.length}` : null,
      ].filter(Boolean).join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_event_reset_select') {
    const result = await resetEventForTesting({
      eventKey,
      actorUserId: interaction.user.id,
      client,
      guild: interaction.guild,
      settings,
    });
    await interaction.editReply({
      content: [
        `Event-Reset fuer ${EVENT_LABELS[eventKey]} wurde ausgefuehrt.`,
        `Gruppenkanaele geloescht: ${result.deletedGroupChannels.length}`,
        `K.O.-Kanaele geloescht: ${result.deletedKnockoutChannels.length}`,
        `Gruppenrollen geleert: ${result.clearedGroupRoles.length}`,
        `K.O.-Rollen geleert: ${result.clearedKnockoutRoles.length}`,
        `Fehlende Kanaele ignoriert: ${result.missingChannels.length}`,
        `Check-in aktualisiert: ${result.checkinRefreshed ? 'ja' : 'nein'}`,
        'Eventdaten und Message-Refs wurden zurueckgesetzt. Teamregistrierungen wurden nicht geloescht.',
      ].join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_testdata_create_select') {
    const result = createTestDataForEvent({ eventKey, actorUserId: interaction.user.id });
    await refreshRegisteredTeamsOverview(client).catch(() => null);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({
      content: `Testdaten fuer ${EVENT_LABELS[eventKey]} wurden erzeugt: ${result.allIds.length} Testteams eingecheckt.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_simulate_groups_select') {
    const result = await simulateGroupPhase({
      eventKey,
      actorUserId: interaction.user.id,
      client,
    });
    await interaction.editReply({
      content: [
        `Gruppenphase fuer ${EVENT_LABELS[eventKey]} wurde simuliert.`,
        `Gruppen: ${result.groups}`,
        `Bestaetigte Spiele: ${result.simulatedMatches}`,
        'Status: Gruppenphase completed. K.O. erstellen kann jetzt getestet werden.',
      ].join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_simulate_knockout_select') {
    const result = await simulateKnockoutPhase({
      eventKey,
      actorUserId: interaction.user.id,
      client,
      guild: interaction.guild,
    });
    await interaction.editReply({
      content: [
        `K.O.-Phase fuer ${EVENT_LABELS[eventKey]} wurde simuliert.`,
        `Bestaetigte K.O.-Spiele: ${result.simulatedMatches}`,
        result.placements?.firstTeamId ? `Platz 1: ${result.placements.first.displayName}` : null,
        result.placements?.secondTeamId ? `Platz 2: ${result.placements.second.displayName}` : null,
        result.placements?.thirdTeamId ? `Platz 3: ${result.placements.third.displayName}` : null,
        result.placements?.fourthTeamId ? `Platz 4: ${result.placements.fourth.displayName}` : null,
        result.ceremony?.posted
          ? `Hall of Fame wurde automatisch in <#${result.ceremony.result.channelId}> gepostet.`
          : 'Status: K.O. completed, Ceremony ist vorbereitet. Button Siegerehrung posten kann genutzt werden.',
      ].filter(Boolean).join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_ceremony_post_select') {
    const result = await postHallOfFameCeremony({
      guild: interaction.guild,
      eventKey,
    });
    await interaction.editReply({
      content: [
        `Siegerehrung fuer ${EVENT_LABELS[eventKey]} wurde gepostet.`,
        `Kanal: <#${result.channelId}>`,
        `1. ${result.teams.first.clubName}`,
        `2. ${result.teams.second.clubName}`,
        `3. ${result.teams.third.clubName}`,
      ].join('\n'),
      components: [],
    });
    return true;
  }

  throw new Error('Unbekannte Admin-Auswahl.');
}

async function handleAdminUserSelect(interaction, client, settings) {
  if (interaction.customId.startsWith('admin_team_add_covm_user:')) {
    const [, teamId] = interaction.customId.split(':');
    const userId = interaction.values?.[0];
    await interaction.deferUpdate();
    const team = await handleAdminAddCoManager({ interaction, client, settings, teamId, userId });
    await interaction.editReply({
      content: `<@${userId}> wurde als Co-VM bei **${team.clubName}** hinzugefuegt.`,
      embeds: [],
      components: [],
      allowedMentions: { parse: ['users'] },
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_team_change_vm_user:')) {
    const [, teamId] = interaction.customId.split(':');
    const userId = interaction.values?.[0];
    await interaction.deferUpdate();
    const result = await handleAdminChangeManager({ interaction, client, settings, teamId, userId });
    await interaction.editReply({
      content: `<@${userId}> ist jetzt VM von **${result.team.clubName}**. Alter VM wurde entfernt.`,
      embeds: [],
      components: [],
      allowedMentions: { parse: ['users'] },
    });
    return true;
  }

  throw new Error('Unbekannte Admin-User-Auswahl.');
}

async function handleAdminModal(interaction, client, settings) {
  if (interaction.customId.startsWith('admin_team_edit_name_modal:')) {
    const [, teamId] = interaction.customId.split(':');
    const newClubName = interaction.fields.getTextInputValue('new_club_name');
    const team = adminUpdateTeamName({ teamId, newClubName, actorUserId: interaction.user.id, settings });
    const nicknameResults = await syncTeamNicknames(interaction.guild, team);
    assertNicknameResults(nicknameResults);
    await refreshTeamAdminSurfaces({ client, settings });
    await interaction.reply({
      content: `Teamname wurde auf **${team.clubName}** geaendert.`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_team_add_covm_manual_modal:')) {
    const [, teamId] = interaction.customId.split(':');
    const userId = interaction.fields.getTextInputValue('user_id').trim();
    const team = await handleAdminAddCoManager({ interaction, client, settings, teamId, userId });
    await interaction.reply({
      content: `<@${userId}> wurde als Co-VM bei **${team.clubName}** hinzugefuegt.`,
      flags: EPHEMERAL,
      allowedMentions: { parse: ['users'] },
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_team_change_vm_manual_modal:')) {
    const [, teamId] = interaction.customId.split(':');
    const userId = interaction.fields.getTextInputValue('user_id').trim();
    const result = await handleAdminChangeManager({ interaction, client, settings, teamId, userId });
    await interaction.reply({
      content: `<@${userId}> ist jetzt VM von **${result.team.clubName}**. Alter VM wurde entfernt.`,
      flags: EPHEMERAL,
      allowedMentions: { parse: ['users'] },
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_team_ban_manual_modal:')) {
    const [, teamId, selectedReason, durationValue] = interaction.customId.split(':');
    const team = findTeamById(teamId);
    if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');

    const customReason = interaction.fields.getTextInputValue('ban_reason')?.trim();
    const rawDays = interaction.fields.getTextInputValue('ban_days')?.trim();
    const durationDays = Number(rawDays || durationValue || 14);
    if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 365) {
      throw new Error('Die Sperrdauer muss zwischen 1 und 365 Tagen liegen.');
    }

    const reason = selectedReason === 'manual_reason'
      ? customReason
      : (customReason || selectedReason);
    const ban = addTeamBan(team, reason, interaction.user.id, durationDays);

    await interaction.reply({
      content: `Team **${team.clubName}** wurde bis ${new Date(ban.bannedUntilDate || ban.expiresAt).toLocaleString('de-DE')} gesperrt.`,
      flags: EPHEMERAL,
    });
    return true;
  }

  return false;
}

async function handleAdminInteraction(interaction, client) {
  const isAdminButton = interaction.isButton?.()
    && (ADMIN_ACTIONS.has(interaction.customId) || ADMIN_BUTTON_PREFIXES.some(prefix => interaction.customId.startsWith(prefix)));
  const isAdminSelect = interaction.isStringSelectMenu?.() && isAdminSelectId(interaction.customId);
  const isAdminUserSelect = interaction.isUserSelectMenu?.() && ADMIN_USER_SELECT_PREFIXES.some(prefix => interaction.customId.startsWith(prefix));
  const isAdminModal = interaction.isModalSubmit?.() && ADMIN_MODAL_PREFIXES.some(prefix => interaction.customId.startsWith(prefix));
  if (!isAdminButton && !isAdminSelect && !isAdminUserSelect && !isAdminModal) return false;

  const settings = readSettings();

  try {
    await requireAdminAccess(interaction, settings);

    if (isAdminModal) return await handleAdminModal(interaction, client, settings);
    if (isAdminUserSelect) return await handleAdminUserSelect(interaction, client, settings);
    if (isAdminSelect) return await handleAdminSelect(interaction, client, settings);

    if (interaction.customId.startsWith('admin_team_details_page:')) {
      const [, page] = interaction.customId.split(':');
      await interaction.update(buildTeamDetailsSelectPayload(page));
      return true;
    }

    if (interaction.customId.startsWith('admin_team_details_back:')) {
      const [, page] = interaction.customId.split(':');
      await interaction.update({ ...buildTeamDetailsSelectPayload(page), embeds: [] });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_edit_name_open:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.showModal(buildAdminTeamNameModal(team, settings));
      return true;
    }

    if (interaction.customId.startsWith('admin_team_add_covm_open:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      if ((team.coManagers || []).length >= settings.teams.coManagerLimit) throw new Error('Dieses Team hat bereits das Co-VM-Limit erreicht.');
      await interaction.reply({ ...buildAdminAddCoManagerPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_add_covm_manual_open:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.showModal(buildManualUserModal(`admin_team_add_covm_manual_modal:${team.id}`, 'Co-VM per User-ID'));
      return true;
    }

    if (interaction.customId.startsWith('admin_team_remove_covm_open:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.reply({ ...buildAdminRemoveCoManagerPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_change_vm_open:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.reply({ ...buildAdminChangeManagerPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_change_vm_manual_open:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      await interaction.showModal(buildManualUserModal(`admin_team_change_vm_manual_modal:${team.id}`, 'VM per User-ID'));
      return true;
    }

    if (interaction.customId.startsWith('admin_team_ban_confirm:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      const ban = addTeamBan(team, 'admin_other', interaction.user.id, 14);
      await interaction.reply({
        content: `Team **${team.clubName}** wurde gesperrt bis ${formatDate(ban.bannedUntilDate || ban.expiresAt)}.`,
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_unban_confirm:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      const removed = removeTeamBan(teamId, interaction.user.id, 'admin_removed');
      if (!removed) throw new Error('Fuer dieses Team wurde keine aktive Sperre gefunden.');
      await interaction.reply({
        content: `Sperre fuer **${team?.clubName || removed.clubName || teamId}** wurde entfernt.`,
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_delete_open:')) {
      const [, teamId] = interaction.customId.split(':');
      const team = findTeamById(teamId);
      if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
      const runningEventLabel = findRunningEventParticipation(team.id);
      if (runningEventLabel) {
        throw new Error(`Team ist noch in einem laufenden Event (${runningEventLabel}) eingetragen. Bitte zuerst im Event sauber ersetzen/entfernen.`);
      }
      await interaction.reply({ ...buildAdminDeleteConfirmPayload(team), flags: EPHEMERAL });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_delete_confirm:')) {
      const [, teamId] = interaction.customId.split(':');
      await interaction.deferUpdate();
      const result = await handleAdminDeleteTeam({ interaction, client, settings, teamId });
      await interaction.editReply({
        content: `Team **${result.team.clubName}** wurde geloescht. Entfernte Check-ins: ${result.affectedEventKeys.length ? result.affectedEventKeys.map(key => EVENT_LABELS[key] || key).join(', ') : 'keine'}.`,
        embeds: [],
        components: [],
      });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_delete_cancel:')) {
      await interaction.update({ content: 'Team-Loeschung abgebrochen.', embeds: [], components: [] });
      return true;
    }

    if (interaction.customId.startsWith('admin_team_ban_page:')) {
      const [, page] = interaction.customId.split(':');
      await interaction.update(buildTeamBanSelectPayload(page));
      return true;
    }

    if (interaction.customId === 'admin_bye_add') {
      await interaction.reply({
        content: 'Fuer welches Event soll ein Freilos hinzugefuegt werden?',
        components: [buildEventSelect('admin_bye_add_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_bye_remove') {
      await interaction.reply({
        content: 'Fuer welches Event soll ein Freilos entfernt werden?',
        components: [buildEventSelect('admin_bye_remove_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_format_lock') {
      await interaction.reply({
        content: 'Fuer welches Event soll das Format gelockt werden?',
        components: [buildEventSelect('admin_format_lock_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_groups_draw') {
      await interaction.reply({
        content: 'Fuer welches Event sollen Gruppen gezogen werden?',
        components: [buildEventSelect('admin_groups_draw_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_group_release_current') {
      await interaction.reply({
        content: 'Fuer welches Event soll der aktuelle Spieltag sofort freigegeben werden?',
        components: [buildEventSelect('admin_group_release_current_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_knockout_create') {
      await interaction.reply({
        content: 'Fuer welches Event soll die K.O.-Phase erstellt werden?',
        components: [buildEventSelect('admin_knockout_create_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_event_reset') {
      await interaction.reply({
        content: 'Fuer welches Event soll der Reset vorbereitet werden?',
        components: [buildEventSelect('admin_event_reset_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_testdata_create') {
      await interaction.reply({
        content: 'Fuer welches Event sollen Testdaten erzeugt und eingecheckt werden?',
        components: [buildEventSelect('admin_testdata_create_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_simulate_groups') {
      await interaction.reply({
        content: 'Fuer welches Event soll die Gruppenphase simuliert werden?',
        components: [buildEventSelect('admin_simulate_groups_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_simulate_knockout') {
      await interaction.reply({
        content: 'Fuer welches Event soll die K.O.-Phase simuliert werden?',
        components: [buildEventSelect('admin_simulate_knockout_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_hof_test') {
      const teams = sortedRegisteredTeams();
      if (teams.length < 3) throw new Error('Fuer den Hall-of-Fame-Test werden mindestens drei registrierte Teams benoetigt.');
      await interaction.reply({
        content: 'Platz 1 auswaehlen.',
        components: [buildTeamSelect('admin_hof_first_select', 'Platz 1 auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_ceremony_post') {
      await interaction.reply({
        content: 'Fuer welches Event soll die Siegerehrung gepostet werden?',
        components: [buildEventSelect('admin_ceremony_post_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_server_setup') {
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

    if (interaction.customId === 'admin_team_ban') {
      await interaction.reply({
        ...buildTeamBanSelectPayload(0),
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_team_unban') {
      await interaction.reply({
        content: 'Welche aktive Sperre soll entfernt werden?',
        components: [buildActiveBanSelect()],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_testdata_remove') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = removeTestData();
      await refreshRegisteredTeamsOverview(client).catch(() => null);
      await refreshCheckinMessages(EVENT_KEYS, client);
      await interaction.editReply(`Testdaten wurden entfernt: ${result.removedIds.length} Testteams geloescht. Echte Teams wurden nicht angeruehrt.`);
      return true;
    }

    if (interaction.customId === 'admin_checkin_refresh') {
      await interaction.deferReply({ flags: EPHEMERAL });
      await refreshCheckinMessages(EVENT_KEYS, client);
      await interaction.editReply('Alle Check-in Panels wurden aktualisiert.');
      return true;
    }

    if (interaction.customId === 'admin_team_overview_refresh') {
      await interaction.deferReply({ flags: EPHEMERAL });
      await refreshRegisteredTeamsOverview(client);
      await interaction.editReply('Teamuebersicht wurde aktualisiert.');
      return true;
    }

    if (interaction.customId === 'admin_teams_list') {
      await interaction.reply({
        content: formatTeamsList(),
        flags: EPHEMERAL,
        allowedMentions: { parse: ['users'] },
      });
      return true;
    }

    if (interaction.customId === 'admin_team_details') {
      await interaction.reply({
        ...buildTeamDetailsSelectPayload(0),
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_ceremony_test') {
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
