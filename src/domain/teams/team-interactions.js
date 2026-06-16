'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
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
  createTeam,
  deleteTeam,
  findNonDeletedTeamByUserId,
  findTeamById,
  isTeamMember,
  leaveTeam,
  removeCoManager,
  updateTeamName,
} = require('./team-service');
const { setPendingLogoUpload } = require('./team-logos');
const { syncManagerRoleForUser, syncManagerRolesForTeam } = require('./team-roles');
const { refreshRegisteredTeamsOverview } = require('./team-overview');
const { ensureUserIsNotBot, requireGuild } = require('./team-validation');

const EPHEMERAL = 64;

function getSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

async function replyError(interaction, error) {
  const payload = {
    content: `Fehler: ${error.message}`,
    flags: EPHEMERAL,
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: payload.content, components: [], embeds: [] }).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }

  return true;
}

function requireTeamAccess(team, userId) {
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  if (!isTeamMember(team, userId)) throw new Error('Du darfst dieses Team nicht bearbeiten.');
}

async function handleButton(interaction, client) {
  const settings = getSettings();

  if (interaction.customId === 'team_register_open') {
    requireGuild(interaction);
    await interaction.showModal(buildRegisterModal(settings));
    return true;
  }

  if (interaction.customId === 'team_show_mine') {
    requireGuild(interaction);
    const team = findNonDeletedTeamByUserId(interaction.user.id);
    if (!team) throw new Error('Du bist aktuell keinem Team zugeordnet.');
    await interaction.reply({ ...buildMyTeamPayload(team), flags: EPHEMERAL });
    return true;
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
    setPendingLogoUpload(interaction.user.id, team.id, settings.channels.teamRegistrationChannelId);
    await interaction.reply({
      content: `Lade jetzt das Logo für **${team.clubName}** im Teamregistrierungskanal hoch. Das Team bleibt bis dahin unvollständig.`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (action === 'team_add_covm_open') {
    requireTeamAccess(team, interaction.user.id);
    await interaction.reply({ ...buildAddCoManagerPayload(team), flags: EPHEMERAL });
    return true;
  }

  if (action === 'team_remove_covm_open') {
    requireTeamAccess(team, interaction.user.id);
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
      throw new Error('Nur der VM kann das Team löschen.');
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
    await refreshRegisteredTeamsOverview(client);
    await interaction.update({ content: 'Team verlassen.', components: [], embeds: [] });
    return true;
  }

  if (action === 'team_delete_confirm') {
    requireTeamAccess(team, interaction.user.id);
    const userIds = [team.manager?.userId, ...team.coManagers.map(co => co.userId)].filter(Boolean);
    deleteTeam({ teamId, actorUserId: interaction.user.id });
    for (const userId of userIds) await syncManagerRoleForUser(interaction.guild, userId, settings);
    await refreshRegisteredTeamsOverview(client);
    await interaction.update({ content: 'Team wurde gelöscht. Statistiken bleiben erhalten.', components: [], embeds: [] });
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
    requireGuild(interaction);
    const clubName = interaction.fields.getTextInputValue('club_name');
    const team = createTeam({ clubName, managerUserId: interaction.user.id, settings });
    await syncManagerRoleForUser(interaction.guild, interaction.user.id, settings);
    setPendingLogoUpload(interaction.user.id, team.id, settings.channels.teamRegistrationChannelId);
    await refreshRegisteredTeamsOverview(client);
    await interaction.reply({
      content: `Team **${team.clubName}** wurde angelegt. Bitte lade jetzt ein Logo im Teamregistrierungskanal hoch, damit die Registrierung vollständig wird.`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (interaction.customId.startsWith('team_edit_name_modal:')) {
    requireGuild(interaction);
    const [, teamId] = interaction.customId.split(':');
    const newClubName = interaction.fields.getTextInputValue('new_club_name');
    const team = updateTeamName({ teamId, newClubName, actorUserId: interaction.user.id, settings });
    await refreshRegisteredTeamsOverview(client);
    await interaction.reply({ content: `Teamname wurde auf **${team.clubName}** geändert.`, flags: EPHEMERAL });
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
  const selectedMember = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!selectedMember) throw new Error('Dieser User ist nicht auf dem Server.');
  ensureUserIsNotBot(selectedMember.user);

  addCoManager({ teamId, userId, actorUserId: interaction.user.id, settings });
  await syncManagerRoleForUser(interaction.guild, userId, settings);
  await refreshRegisteredTeamsOverview(client);
  await interaction.update({ content: `<@${userId}> wurde als Co-VM hinzugefügt.`, components: [], allowedMentions: { parse: ['users'] } });
  return true;
}

async function handleStringSelect(interaction, client) {
  if (!interaction.customId.startsWith('team_remove_covm_select:')) return false;

  requireGuild(interaction);
  const settings = getSettings();
  const [, teamId] = interaction.customId.split(':');
  const userId = interaction.values?.[0];
  removeCoManager({ teamId, userId, actorUserId: interaction.user.id });
  await syncManagerRoleForUser(interaction.guild, userId, settings);
  await refreshRegisteredTeamsOverview(client);
  await interaction.update({ content: `<@${userId}> wurde als Co-VM entfernt.`, components: [], allowedMentions: { parse: ['users'] } });
  return true;
}

async function handleInteraction(interaction, client) {
  try {
    if (interaction.isButton()) return handleButton(interaction, client);
    if (interaction.isModalSubmit()) return handleModal(interaction, client);
    if (interaction.isUserSelectMenu()) return handleUserSelect(interaction, client);
    if (interaction.isStringSelectMenu()) return handleStringSelect(interaction, client);
    return false;
  } catch (error) {
    return replyError(interaction, error);
  }
}

module.exports = {
  handleInteraction,
};
