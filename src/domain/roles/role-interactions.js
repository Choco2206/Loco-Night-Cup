'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');

const EPHEMERAL = 64;

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function parseRoleSelect(customId) {
  if (customId === 'role_select_player') return 'player';
  if (customId === 'role_select_manager') return 'manager';
  return null;
}

async function ensureConfiguredRole(guild, roleId, label) {
  if (!roleId) throw new Error(`${label}-Rolle ist nicht konfiguriert.`);
  const role = guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
  if (!role) throw new Error(`${label}-Rolle wurde nicht gefunden.`);
  return role;
}

async function applyExclusiveRole(member, selectedRole, settings) {
  const playerRole = await ensureConfiguredRole(member.guild, settings.roles.playerRoleId, 'Spieler');
  const managerRole = await ensureConfiguredRole(member.guild, settings.roles.managerRoleId, 'Manager');

  if (selectedRole === 'player') {
    if (member.roles.cache.has(managerRole.id)) await member.roles.remove(managerRole.id);
    if (!member.roles.cache.has(playerRole.id)) await member.roles.add(playerRole.id);
    return 'Du bist jetzt als Spieler eingetragen.';
  }

  if (member.roles.cache.has(playerRole.id)) await member.roles.remove(playerRole.id);
  if (!member.roles.cache.has(managerRole.id)) await member.roles.add(managerRole.id);
  return 'Du bist jetzt als Manager eingetragen.';
}

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const selectedRole = parseRoleSelect(interaction.customId);
  if (!selectedRole) return false;

  try {
    if (!interaction.guild) throw new Error('Rollenwahl ist nur auf dem Server möglich.');
    const settings = readSettings();
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) throw new Error('Dein Server-Mitglied konnte nicht geladen werden.');

    const message = await applyExclusiveRole(member, selectedRole, settings);
    await interaction.reply({ content: message, flags: EPHEMERAL });
    return true;
  } catch (error) {
    await interaction.reply({
      content: error?.message || 'Rolle konnte nicht gesetzt werden.',
      flags: EPHEMERAL,
    }).catch(() => {});
    return true;
  }
}

module.exports = {
  applyExclusiveRole,
  handleInteraction,
};
