'use strict';

const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { refreshCheckinMessage, refreshCheckinMessages } = require('../checkins/checkin-panel');
const { recalculateCheckinFormat } = require('../checkins/checkin-format');
const { updateEventData } = require('../checkins/checkin-repository');
const { refreshRegisteredTeamsOverview } = require('../teams/team-overview');
const { listVisibleTeams } = require('../teams/team-service');
const { lockEventFormat, drawGroupsForEvent } = require('../tournament/tournament-service');
const { createTestDataForEvent, removeTestData } = require('../testdata/testdata-service');
const { EVENT_KEYS, EVENT_LABELS } = require('../../app/constants');

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
  'admin_testdata_create',
  'admin_testdata_remove',
]);
const ADMIN_SELECT_IDS = new Set([
  'admin_bye_add_select',
  'admin_bye_remove_select',
  'admin_format_lock_select',
  'admin_groups_draw_select',
  'admin_testdata_create_select',
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
  return chunks[0] + (chunks.length > 1 ? `\n\n... ${chunks.length - 1} weitere Blöcke gekürzt.` : '');
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
    if (event.format?.lockedAt) throw new Error('Nach dem Format-Lock können keine Freilose mehr hinzugefügt werden.');
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
    if (event.format?.lockedAt) throw new Error('Nach dem Format-Lock können keine Freilose mehr entfernt werden.');
    event.byes = Array.isArray(event.byes) ? event.byes : [];
    const index = event.byes.map(bye => bye?.type === 'bye' && bye?.status !== 'removed').lastIndexOf(true);
    if (index === -1) throw new Error('Für dieses Event gibt es kein Freilos.');

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
  const eventKey = interaction.values?.[0];
  if (!EVENT_KEYS.includes(eventKey)) throw new Error('Event nicht gefunden.');

  await interaction.deferReply({ flags: EPHEMERAL });

  if (interaction.customId === 'admin_bye_add_select') {
    addManualBye(eventKey, interaction.user.id, settings);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({ content: `Freilos für ${EVENT_LABELS[eventKey]} wurde hinzugefügt.`, components: [] });
    return true;
  }

  if (interaction.customId === 'admin_bye_remove_select') {
    removeManualBye(eventKey, interaction.user.id, settings);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({ content: `Freilos für ${EVENT_LABELS[eventKey]} wurde entfernt.`, components: [] });
    return true;
  }

  if (interaction.customId === 'admin_format_lock_select') {
    const result = lockEventFormat(eventKey, interaction.user.id);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({
      content: `Format für ${EVENT_LABELS[eventKey]} wurde gelockt: ${result.size}er Turnier mit ${result.participants.length} Teilnehmerplätzen.`,
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
      content: `Gruppen für ${EVENT_LABELS[eventKey]} wurden gezogen: ${Object.keys(result.groups).length} Gruppen erstellt.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_testdata_create_select') {
    const result = createTestDataForEvent({ eventKey, actorUserId: interaction.user.id });
    await refreshRegisteredTeamsOverview(client).catch(() => null);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({
      content: `Testdaten für ${EVENT_LABELS[eventKey]} wurden erzeugt: ${result.allIds.length} Testteams eingecheckt.`,
      components: [],
    });
    return true;
  }

  throw new Error('Unbekannte Admin-Auswahl.');
}

async function handleAdminInteraction(interaction, client) {
  const isAdminButton = interaction.isButton?.() && ADMIN_ACTIONS.has(interaction.customId);
  const isAdminSelect = interaction.isStringSelectMenu?.() && ADMIN_SELECT_IDS.has(interaction.customId);
  if (!isAdminButton && !isAdminSelect) return false;

  const settings = readSettings();

  try {
    await requireAdminAccess(interaction, settings);

    if (isAdminSelect) return await handleAdminSelect(interaction, client, settings);

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

    if (interaction.customId === 'admin_format_lock') {
      await interaction.reply({
        content: 'Für welches Event soll das Format gelockt werden?',
        components: [buildEventSelect('admin_format_lock_select', 'Event auswählen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_groups_draw') {
      await interaction.reply({
        content: 'Für welches Event sollen Gruppen gezogen werden?',
        components: [buildEventSelect('admin_groups_draw_select', 'Event auswählen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_testdata_create') {
      await interaction.reply({
        content: 'Für welches Event sollen Testdaten erzeugt und eingecheckt werden?',
        components: [buildEventSelect('admin_testdata_create_select', 'Event auswählen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_testdata_remove') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = removeTestData();
      await refreshRegisteredTeamsOverview(client).catch(() => null);
      await refreshCheckinMessages(EVENT_KEYS, client);
      await interaction.editReply(`Testdaten wurden entfernt: ${result.removedIds.length} Testteams gelöscht. Echte Teams wurden nicht angerührt.`);
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
