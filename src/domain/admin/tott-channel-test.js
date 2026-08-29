'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { testLiveTottChannel } = require('../team-of-the-tournament/team-of-the-tournament-post');

const EPHEMERAL = 64;

function selectedAction(interaction) {
  if (interaction?.isStringSelectMenu?.() && interaction.customId === 'admin_panel_action_select') {
    return interaction.values?.[0] || '';
  }
  return interaction?.customId || '';
}

function hasAnyRole(member, roleIds) {
  return roleIds.filter(Boolean).some(roleId => member?.roles?.cache?.has(String(roleId)));
}

async function requireAdmin(interaction) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const adminRoleIds = [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
  ];
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (!member || !hasAnyRole(member, [...new Set(adminRoleIds.map(String))])) {
    throw new Error('Nur Admins dürfen den TOTT-Kanaltest verwenden.');
  }
}

async function handleTottChannelTestInteraction(interaction, client) {
  if (selectedAction(interaction) !== 'admin_tott_channel_test') return false;

  try {
    await requireAdmin(interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await testLiveTottChannel(client);
    await interaction.editReply({
      content: `✅ TOTT-Kanaltest erfolgreich. Testnachricht wurde in <#${result.channelId}> gesendet.\nMessage-ID: ${result.messageId}`,
      components: [],
      embeds: [],
    });
  } catch (error) {
    const details = [
      `❌ TOTT-Kanaltest fehlgeschlagen: ${error.message}`,
      error.code ? `Discord-Code: ${error.code}` : null,
      error.status ? `HTTP-Status: ${error.status}` : null,
    ].filter(Boolean).join('\n');
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: details, components: [], embeds: [] }).catch(() => null);
    } else {
      await interaction.reply({ content: details, flags: EPHEMERAL }).catch(() => null);
    }
  }
  return true;
}

module.exports = { handleTottChannelTestInteraction };
