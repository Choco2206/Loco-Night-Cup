'use strict';

const { ensureAdminPanel } = require('./admin-panel');
const { handleAdminInteraction } = require('./admin-interactions');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { syncAllTeamNicknames } = require('../nicknames');

const EPHEMERAL = 64;

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

async function init(client) {
  await ensureAdminPanel(client);
}

async function handleInteraction(interaction, client) {
  if (interaction.isButton() && interaction.customId === 'admin_nickname_sync') {
    const settings = readJson(FILES.settings, createSettingsDefault());
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => interaction.member);
    if (!member || !isAdminAllowed(member, settings)) {
      await interaction.reply({ content: 'Du darfst dieses Admin-Panel nicht verwenden.', flags: EPHEMERAL }).catch(() => {});
      return true;
    }

    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await syncAllTeamNicknames(interaction.guild);
    await interaction.editReply(summarizeNicknameSync(result.summary));
    return true;
  }

  if (
    !interaction.isButton()
    && !interaction.isStringSelectMenu()
    && !interaction.isUserSelectMenu()
    && !interaction.isModalSubmit()
  ) {
    return false;
  }
  return handleAdminInteraction(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
};
