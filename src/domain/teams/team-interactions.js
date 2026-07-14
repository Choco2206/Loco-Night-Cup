'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { removeTeamFromAllEvents } = require('../checkins/checkin-service');
const { refreshCheckinMessages } = require('../checkins/checkin-panel');
const { setTeamCoManagerNickname, setTeamManagerNickname } = require('../nicknames');
const {
  buildAddCoManagerPayload,
  buildConfirmPayload,
  buildEditNameModal,
  buildMyTeamPayload,
  buildRegisterModal,
  buildRemoveCoManagerPayload,
} = require('./team-components');
const {
  addCoManager,
  clearExpiredLogoUploads,
  createTeam,
  deleteTeam,
  findNonDeletedTeamByUserId,
  findTeamById,
  isTeamMember,
  isValidTournamentTeam,
  leaveTeam,
  removeCoManager,
  requestLogoUpload,
  setLogoUploadInstructionMessage,
  updateTeamName,
} = require('./team-service');
const { syncManagerRoleForUser, syncManagerRolesForTeam } = require('./team-roles');
const { syncChampionRolesForUser, syncChampionRolesForUsers } = require('./team-champion-roles');
const { refreshRegisteredTeamsOverview } = require('./team-overview');
const { MY_TEAM_PANEL_CHANNEL_ID } = require('./team-panel');
const { ensureUserIsNotBot, requireGuild } = require('./team-validation');
const { refreshManagersWithoutTeamMessageIfTracked } = require('../admin/managers-without-team');
const { syncTeamGroupAccess } = require('../groups/group-access-sync');

const EPHEMERAL = 64;
const LOGO_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function getSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function teamRegistrationChannelLabel(settings) {
  const channelId = settings.channels?.teamRegistrationChannelId;
  return channelId ? `<#${channelId}>` : 'Teamregistrierungskanal';
}

function strictManagerRoleRequiredMessage(settings) {
  const prefix = '❌ Du brauchst zuerst die Manager-Rolle, um ein Team zu registrieren.';
  const channelId = settings.channels?.roleSelectChannelId;
  if (channelId) return `${prefix}\nBitte waehle zuerst im <#${channelId}> die Manager-Rolle aus.`;
  return `${prefix}\nBitte waehle zuerst in der Rollenauswahl die Manager-Rolle aus.`;
}

function shouldLogInteractionError(error) {
  if (!error) return false;
  return error.name && error.name !== 'Error';
}

async function replyError(interaction, error) {
  if (shouldLogInteractionError(error)) {
    console.error('Team interaction failed:', error);
  }

  const payload = {
    content: error?.message || 'Aktion konnte nicht verarbeitet werden.',
    flags: EPHEMERAL,
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: payload.content, components: [], embeds: [] }).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }

  return true;
}

async function getConfiguredRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
}

async function requireStrictManagerRegistrationRole(interaction, settings) {
  requireGuild(interaction);

  const managerRoleId = settings.roles?.managerRoleId ? String(settings.roles.managerRoleId) : null;
  const playerRoleId = settings.roles?.playerRoleId ? String(settings.roles.playerRoleId) : null;
  if (!managerRoleId) throw new Error('Manager-Rolle ist nicht konfiguriert.');
  if (playerRoleId && playerRoleId === managerRoleId) {
    throw new Error('Manager- und Spieler-Rolle sind gleich konfiguriert. Bitte Settings pruefen.');
  }

  const managerRole = await getConfiguredRole(interaction.guild, managerRoleId);
  if (!managerRole) throw new Error('Manager-Rolle ist nicht konfiguriert oder wurde nicht gefunden.');

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !member.roles.cache.has(managerRole.id)) {
    throw new Error(strictManagerRoleRequiredMessage(settings));
  }

  return member;
}

function requireTeamAccess(team, userId) {
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  if (!isTeamMember(team, userId)) throw new Error('Du darfst dieses Team nicht bearbeiten.');
}

function requireTeamManager(team, userId) {
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  if (!team.manager?.userId || String(team.manager.userId) !== String(userId)) {
    throw new Error('Nur der VM darf diese Aktion ausfuehren.');
  }
}

async function removeTeamCheckinsAndRefresh({ teamId, settings, client }) {
  const affectedEventKeys = removeTeamFromAllEvents({ teamId, settings });
  if (affectedEventKeys.length) await refreshCheckinMessages(affectedEventKeys, client);
  return affectedEventKeys;
}

async function cleanupInvalidTeamCheckins({ team, settings, client }) {
  if (isValidTournamentTeam(team)) return [];
  return removeTeamCheckinsAndRefresh({ teamId: team.id, settings, client });
}

async function syncTeamNicknames(guild, team) {
  if (!team || team.status !== 'active') return [];
  const results = [];
  if (team.manager?.userId) {
    results.push(await setTeamManagerNickname(guild, team.manager.userId, team));
  }
  for (const coManager of team.coManagers || []) {
    if (coManager?.userId) {
      results.push(await setTeamCoManagerNickname(guild, coManager.userId, team));
    }
  }
  return results;
}

async function showMyTeam(interaction) {
  requireGuild(interaction);
  const team = findNonDeletedTeamByUserId(interaction.user.id);
  if (!team) throw new Error('Du bist aktuell keinem Team zugeordnet.');
  await interaction.reply({ ...buildMyTeamPayload(team, interaction.user.id), flags: EPHEMERAL });
  return true;
}

async function deleteInstructionMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) await message.delete().catch(() => {});
}

async function deleteInstructionMessages(client, uploads) {
  for (const upload of uploads) {
    await deleteInstructionMessage(client, upload.channelId, upload.instructionMessageId);
  }
}

function buildLogoInstructionContent(userId, team, settings) {
  const maxMb = settings.teams.maxLogoFileSizeMb;
  return `<@${userId}> Bitte lade dein Logo innerhalb von 10 Minuten hier im Kanal hoch. Erlaubt: PNG/JPG/WEBP, max. ${maxMb} MB. Team: **${team.clubName}**`;
}

function scheduleExpiredLogoCleanup(client) {
  const timeout = setTimeout(async () => {
    const expiredUploads = clearExpiredLogoUploads(new Date());
    await deleteInstructionMessages(client, expiredUploads);
  }, LOGO_UPLOAD_TIMEOUT_MS + 1000);

  if (typeof timeout.unref === 'function') timeout.unref();
}

async function openLogoUpload({ interaction, client, team, settings, channelId }) {
  if (!channelId) throw new Error('Logo-Upload-Kanal ist nicht konfiguriert.');

  const expiredUploads = clearExpiredLogoUploads(new Date());
  await deleteInstructionMessages(client, expiredUploads);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Logo-Upload-Kanal wurde nicht gefunden.');

  const expiresAt = new Date(Date.now() + LOGO_UPLOAD_TIMEOUT_MS).toISOString();
  const { replacedInstructionMessageId } = requestLogoUpload({
    teamId: team.id,
    requestedByUserId: interaction.user.id,
    channelId,
    expiresAt,
    instructionMessageId: null,
  });

  await deleteInstructionMessage(client, channelId, replacedInstructionMessageId);

  const instruction = await channel.send({
    content: buildLogoInstructionContent(interaction.user.id, team, settings),
    allowedMentions: { users: [interaction.user.id] },
  });

  setLogoUploadInstructionMessage({
    teamId: team.id,
    requestedByUserId: interaction.user.id,
    instructionMessageId: instruction.id,
  });

  scheduleExpiredLogoCleanup(client);

  return { instruction, expiresAt };
}

async function handleButton(interaction, client) {
  const settings = getSettings();

  if (interaction.customId === 'team_register_open') {
    await requireStrictManagerRegistrationRole(interaction, settings);
    await interaction.showModal(buildRegisterModal(settings));
    return true;
  }

  if (interaction.customId === 'team_show_mine') {
    return showMyTeam(interaction);
  }

  const [action, teamId] = interaction.customId.split(':');
  if (!action || !teamId) return false;

  const team = findTeamById(teamId);

  if (action === 'team_edit_name_open') {
    requireTeamAccess(team, interaction.user.id);
    await interaction.showModal(buildEditNameModal(team, settings));
    return true;
  }

  if (action === 'team_logo_update_open') {
    requireTeamAccess(team, interaction.user.id);
    await interaction.deferReply({ flags: EPHEMERAL });
    await openLogoUpload({ interaction, client, team, settings, channelId: MY_TEAM_PANEL_CHANNEL_ID });
    await interaction.editReply({
      content: `Logo-Upload fuer **${team.clubName}** gestartet. Bitte lade dein Logo innerhalb von 10 Minuten im <#${MY_TEAM_PANEL_CHANNEL_ID}> hoch.`,
      components: [],
      embeds: [],
    });
    return true;
  }

  if (action === 'team_add_covm_open') {
    requireTeamAccess(team, interaction.user.id);
    await interaction.reply({ ...buildAddCoManagerPayload(team), flags: EPHEMERAL });
    return true;
  }

  if (action === 'team_remove_covm_open') {
    requireTeamManager(team, interaction.user.id);
    if (!team.coManagers.length) throw new Error('Dieses Team hat keine Co-VMs.');
    await interaction.reply({ ...buildRemoveCoManagerPayload(team), flags: EPHEMERAL });
    return true;
  }

  if (action === 'team_leave_open') {
    requireTeamAccess(team, interaction.user.id);
    await interaction.reply({ ...buildConfirmPayload('leave', team), flags: EPHEMERAL });
    return true;
  }

  if (action === 'team_delete_open') {
    requireTeamAccess(team, interaction.user.id);
    if (!team.manager?.userId || String(team.manager.userId) !== String(interaction.user.id)) {
      throw new Error('Nur der VM kann das Team loeschen.');
    }
    await interaction.reply({ ...buildConfirmPayload('delete', team), flags: EPHEMERAL });
    return true;
  }

  if (action === 'team_leave_confirm') {
    requireTeamAccess(team, interaction.user.id);
    const beforeUserId = interaction.user.id;
    const updated = leaveTeam({ teamId, userId: beforeUserId });
    await syncManagerRoleForUser(interaction.guild, beforeUserId, settings);
    await syncManagerRolesForTeam(interaction.guild, updated, settings);
    await syncChampionRolesForUsers(interaction.guild, [beforeUserId, ...(updated?.coManagers || []).map(co => co.userId), updated?.manager?.userId], settings);
    await cleanupInvalidTeamCheckins({ team: updated, settings, client });
    await refreshRegisteredTeamsOverview(client);
    await refreshManagersWithoutTeamMessageIfTracked({ client, guild: interaction.guild });
    await interaction.update({ content: 'Team verlassen.', components: [], embeds: [] });
    return true;
  }

  if (action === 'team_delete_confirm') {
    requireTeamAccess(team, interaction.user.id);
    const userIds = [team.manager?.userId, ...team.coManagers.map(co => co.userId)].filter(Boolean);
    deleteTeam({ teamId, actorUserId: interaction.user.id });
    await removeTeamCheckinsAndRefresh({ teamId, settings, client });
    for (const userId of userIds) await syncManagerRoleForUser(interaction.guild, userId, settings);
    await syncChampionRolesForUsers(interaction.guild, userIds, settings);
    await refreshRegisteredTeamsOverview(client);
    await refreshManagersWithoutTeamMessageIfTracked({ client, guild: interaction.guild });
    await interaction.update({ content: 'Team wurde geloescht. Statistiken bleiben erhalten.', components: [], embeds: [] });
    return true;
  }

  if (action === 'team_leave_cancel' || action === 'team_delete_cancel') {
    await interaction.update({ content: 'Abgebrochen.', components: [], embeds: [] });
    return true;
  }

  return false;
}

async function handleModal(interaction, client) {
  const settings = getSettings();

  if (interaction.customId === 'team_register_modal') {
    await requireStrictManagerRegistrationRole(interaction, settings);
    await interaction.deferReply({ flags: EPHEMERAL });
    const clubName = interaction.fields.getTextInputValue('club_name');
    const team = createTeam({ clubName, managerUserId: interaction.user.id, settings });
    await syncManagerRoleForUser(interaction.guild, interaction.user.id, settings);
    await openLogoUpload({ interaction, client, team, settings, channelId: settings.channels.teamRegistrationChannelId });
    await refreshRegisteredTeamsOverview(client);
    await refreshManagersWithoutTeamMessageIfTracked({ client, guild: interaction.guild });
    await interaction.editReply({
      content: `Team **${team.clubName}** wurde angelegt. Bitte lade dein Logo innerhalb von 10 Minuten im ${teamRegistrationChannelLabel(settings)} hoch. Erlaubt: PNG/JPG/WEBP, max. ${settings.teams.maxLogoFileSizeMb} MB.`,
      components: [],
      embeds: [],
    });
    return true;
  }

  if (interaction.customId.startsWith('team_edit_name_modal:')) {
    requireGuild(interaction);
    const [, teamId] = interaction.customId.split(':');
    const newClubName = interaction.fields.getTextInputValue('new_club_name');
    const team = updateTeamName({ teamId, newClubName, actorUserId: interaction.user.id, settings });
    await syncTeamNicknames(interaction.guild, team);
    await refreshRegisteredTeamsOverview(client);
    await interaction.reply({ content: `Teamname wurde auf **${team.clubName}** geaendert.`, flags: EPHEMERAL });
    return true;
  }

  return false;
}

async function handleUserSelect(interaction, client) {
  if (!interaction.customId.startsWith('team_add_covm_select:')) return false;

  requireGuild(interaction);
  const settings = getSettings();
  const [, teamId] = interaction.customId.split(':');
  const userId = interaction.values?.[0];
  await interaction.deferUpdate();
  const selectedMember = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!selectedMember) throw new Error('Dieser User ist nicht auf dem Server.');
  ensureUserIsNotBot(selectedMember.user);

  const team = addCoManager({ teamId, userId, actorUserId: interaction.user.id, settings });
  await syncManagerRoleForUser(interaction.guild, userId, settings);
  await syncChampionRolesForUser(interaction.guild, userId, settings);
  await setTeamCoManagerNickname(interaction.guild, userId, team).catch(() => null);
  await syncTeamGroupAccess({ client, guild: interaction.guild, teamId: team.id, settings });
  await refreshRegisteredTeamsOverview(client);
  await refreshManagersWithoutTeamMessageIfTracked({ client, guild: interaction.guild });
  await interaction.editReply({ content: `<@${userId}> wurde als Co-VM hinzugefuegt.`, components: [], allowedMentions: { parse: ['users'] } });
  return true;
}

async function handleStringSelect(interaction, client) {
  if (!interaction.customId.startsWith('team_remove_covm_select:')) return false;

  requireGuild(interaction);
  const settings = getSettings();
  const [, teamId] = interaction.customId.split(':');
  const userId = interaction.values?.[0];
  await interaction.deferUpdate();
  removeCoManager({ teamId, userId, actorUserId: interaction.user.id });
  await syncManagerRoleForUser(interaction.guild, userId, settings);
  await syncChampionRolesForUser(interaction.guild, userId, settings);
  await refreshRegisteredTeamsOverview(client);
  await refreshManagersWithoutTeamMessageIfTracked({ client, guild: interaction.guild });
  await interaction.editReply({ content: `<@${userId}> wurde als Co-VM entfernt.`, components: [], allowedMentions: { parse: ['users'] } });
  return true;
}

async function handleInteraction(interaction, client) {
  try {
    if (interaction.isButton()) return await handleButton(interaction, client);
    if (interaction.isModalSubmit()) return await handleModal(interaction, client);
    if (interaction.isUserSelectMenu()) return await handleUserSelect(interaction, client);
    if (interaction.isStringSelectMenu()) return await handleStringSelect(interaction, client);
    return false;
  } catch (error) {
    return replyError(interaction, error);
  }
}

module.exports = {
  handleInteraction,
};
