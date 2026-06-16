'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { userHasActiveTeamRole } = require('../teams/team-roles');

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
    if (userHasActiveTeamRole(member.id)) {
      throw new Error('Du bist aktuell VM oder Co-VM eines Teams. Verlasse zuerst dein Team oder entferne deine Teamrolle.');
    }

    if (member.roles.cache.has(managerRole.id)) await member.roles.remove(managerRole.id);
    if (!member.roles.cache.has(playerRole.id)) await member.roles.add(playerRole.id);
    return 'Du bist jetzt als Spieler eingetragen.';
  }

  if (member.roles.cache.has(playerRole.id)) await member.roles.remove(playerRole.id);
  if (!member.roles.cache.has(managerRole.id)) await member.roles.add(managerRole.id);
  return 'Du kannst jetzt im Team-Anmeldungskanal ein Team registrieren.';
}

async function replySafely(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content }).catch(() => {});
    return;
  }

  await interaction.reply({ content, flags: EPHEMERAL }).catch(() => {});
}

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const selectedRole = parseRoleSelect(interaction.customId);
  if (!selectedRole) return false;

  try {
    if (!interaction.guild) throw new Error('Rollenwahl ist nur auf dem Server moeglich.');
    const settings = readSettings();
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) throw new Error('Dein Server-Mitglied konnte nicht geladen werden.');

    const message = await applyExclusiveRole(member, selectedRole, settings);
    await replySafely(interaction, message);
    return true;
  } catch (error) {
    await replySafely(interaction, error?.message || 'Rolle konnte nicht gesetzt werden.');
    return true;
  }
}

module.exports = {
  applyExclusiveRole,
  handleInteraction,
};
