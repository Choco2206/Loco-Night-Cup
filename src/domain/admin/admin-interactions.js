'use strict';

const restored = require('./admin-interactions-restored');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { postTeamsWithoutEa } = require('./teams-without-ea');
const { postBomberXLocoGraphicsTest } = require('./bomber-x-loco-graphics-test');

const EPHEMERAL = 64;

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
