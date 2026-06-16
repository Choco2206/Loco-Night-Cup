'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { refreshCheckinMessages } = require('../checkins/checkin-panel');
const { refreshRegisteredTeamsOverview } = require('../teams/team-overview');
const { listVisibleTeams } = require('../teams/team-service');
const { EVENT_KEYS } = require('../../app/constants');

const EPHEMERAL = 64;
const ADMIN_ACTIONS = new Set([
  'admin_checkin_open',
  'admin_checkin_close',
  'admin_event_reset',
  'admin_format_lock',
  'admin_groups_draw',
  'admin_teams_list',
  'admin_team_details',
  'admin_checkin_refresh',
  'admin_team_overview_refresh',
  'admin_ceremony_test',
]);

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
    const complete = team.registrationStatus === 'complete' ? 'Vollständig' : 'Unvollständig';
    const vm = team.manager?.userId ? `<@${team.manager.userId}>` : 'Kein VM';
    return `${index + 1}. **${team.clubName}**\nStatus: ${team.status} | ${complete}\nVM: ${vm} | Co-VMs: ${team.coManagers.length}`;
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
  return chunks[0] + (chunks.length > 1 ? `\n\n... ${chunks.length - 1} weitere Blöcke gekürzt.` : '');
}

async function handleAdminButton(interaction, client) {
  if (!ADMIN_ACTIONS.has(interaction.customId)) return false;

  const settings = readSettings();

  try {
    await requireAdminAccess(interaction, settings);

    if (interaction.customId === 'admin_checkin_refresh') {
      await interaction.deferReply({ flags: EPHEMERAL });
      await refreshCheckinMessages(EVENT_KEYS, client);
      await interaction.editReply('Alle Check-in Panels wurden aktualisiert.');
      return true;
    }

    if (interaction.customId === 'admin_team_overview_refresh') {
      await interaction.deferReply({ flags: EPHEMERAL });
      await refreshRegisteredTeamsOverview(client);
      await interaction.editReply('Teamübersicht wurde aktualisiert.');
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

    if (interaction.customId === 'admin_ceremony_test') {
      await interaction.reply({ content: 'Ceremony-Test wird in späterer Phase implementiert.', flags: EPHEMERAL });
      return true;
    }

    await interaction.reply({ content: 'Funktion folgt in Phase 5.', flags: EPHEMERAL });
    return true;
  } catch (error) {
    const content = error?.message || 'Admin-Aktion konnte nicht verarbeitet werden.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content).catch(() => {});
    } else {
      await interaction.reply({ content, flags: EPHEMERAL }).catch(() => {});
    }
    return true;
  }
}

module.exports = {
  handleAdminButton,
};
