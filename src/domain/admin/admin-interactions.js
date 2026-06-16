'use strict';

const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { refreshCheckinMessage, refreshCheckinMessages } = require('../checkins/checkin-panel');
const { recalculateCheckinFormat } = require('../checkins/checkin-format');
const { updateEventData } = require('../checkins/checkin-repository');
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
  'admin_bye_add',
  'admin_bye_remove',
]);
const BYE_SELECT_IDS = new Set(['admin_bye_add_select', 'admin_bye_remove_select']);

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

function buildEventSelect(customId, placeholder) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(EVENT_KEYS.map(eventKey => ({
      label: eventKey,
      value: eventKey,
    })));

  return new ActionRowBuilder().addComponents(select);
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
    event.byes = Array.isArray(event.byes) ? event.byes : [];
    const number = nextByeNumber(eventKey, event.byes);
    event.byes.push({
      type: 'bye',
      id: `bye_${eventKey}_${number}`,
      displayName: 'Freilos',
      addedAt: new Date().toISOString(),
      addedByUserId: String(actorUserId),
    });
    recalculateCheckinFormat(event, settings);
    return event;
  });
}

function removeManualBye(eventKey, settings) {
  let removed = false;
  updateEventData(eventKey, event => {
    event.byes = Array.isArray(event.byes) ? event.byes : [];
    const index = event.byes.map(bye => bye?.type).lastIndexOf('bye');
    if (index === -1) throw new Error('Für dieses Event gibt es kein Freilos.');

    event.byes.splice(index, 1);
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

async function handleByeSelect(interaction, client, settings) {
  const eventKey = interaction.values?.[0];
  if (!EVENT_KEYS.includes(eventKey)) throw new Error('Event nicht gefunden.');

  await interaction.deferReply({ flags: EPHEMERAL });

  if (interaction.customId === 'admin_bye_add_select') {
    addManualBye(eventKey, interaction.user.id, settings);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({ content: `Freilos für ${eventKey} wurde hinzugefügt.`, components: [] });
    return true;
  }

  removeManualBye(eventKey, settings);
  await refreshCheckinMessage(eventKey, client);
  await interaction.editReply({ content: `Freilos für ${eventKey} wurde entfernt.`, components: [] });
  return true;
}

async function handleAdminInteraction(interaction, client) {
  const isAdminButton = interaction.isButton?.() && ADMIN_ACTIONS.has(interaction.customId);
  const isByeSelect = interaction.isStringSelectMenu?.() && BYE_SELECT_IDS.has(interaction.customId);
  if (!isAdminButton && !isByeSelect) return false;

  const settings = readSettings();

  try {
    await requireAdminAccess(interaction, settings);

    if (isByeSelect) return await handleByeSelect(interaction, client, settings);

    if (interaction.customId === 'admin_bye_add') {
      await interaction.reply({
        content: 'Für welches Event soll ein Freilos hinzugefügt werden?',
        components: [buildEventSelect('admin_bye_add_select', 'Event auswählen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_bye_remove') {
      await interaction.reply({
        content: 'Für welches Event soll ein Freilos entfernt werden?',
        components: [buildEventSelect('admin_bye_remove_select', 'Event auswählen')],
        flags: EPHEMERAL,
      });
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
    await replyInteraction(interaction, error?.message || 'Admin-Aktion konnte nicht verarbeitet werden.', { components: [] });
    return true;
  }
}

module.exports = {
  handleAdminButton: handleAdminInteraction,
  handleAdminInteraction,
};
