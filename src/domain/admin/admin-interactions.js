'use strict';

const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { refreshCheckinMessage, refreshCheckinMessages } = require('../checkins/checkin-panel');
const { recalculateCheckinFormat } = require('../checkins/checkin-format');
const { updateEventData } = require('../checkins/checkin-repository');
const { refreshRegisteredTeamsOverview } = require('../teams/team-overview');
const { listVisibleTeams } = require('../teams/team-service');
const { resetEventForTesting } = require('../events/event-cleanup-service');
const { lockEventFormat, drawGroupsForEvent } = require('../events/event-lock-service');
const { forceReleaseNextSlot } = require('../groups/group-releases');
const { createKnockoutPhase } = require('../knockout');
const { CEREMONY_DAY_LABELS, postHallOfFameCeremony, postHallOfFameTest } = require('../ceremony');
const { createTestDataForEvent, removeTestData } = require('../testdata/testdata-service');
const { simulateGroupPhase, simulateKnockoutPhase } = require('../testdata/simulation-service');
const { EVENT_KEYS, EVENT_LABELS } = require('../../app/constants');

const EPHEMERAL = 64;
const ADMIN_ACTIONS = new Set([
  'admin_checkin_open',
  'admin_checkin_close',
  'admin_event_reset',
  'admin_format_lock',
  'admin_groups_draw',
  'admin_group_release_current',
  'admin_knockout_create',
  'admin_teams_list',
  'admin_team_details',
  'admin_checkin_refresh',
  'admin_team_overview_refresh',
  'admin_ceremony_test',
  'admin_ceremony_post',
  'admin_hof_test',
  'admin_bye_add',
  'admin_bye_remove',
  'admin_testdata_create',
  'admin_testdata_remove',
  'admin_simulate_groups',
  'admin_simulate_knockout',
]);
const ADMIN_SELECT_IDS = new Set([
  'admin_bye_add_select',
  'admin_bye_remove_select',
  'admin_format_lock_select',
  'admin_groups_draw_select',
  'admin_group_release_current_select',
  'admin_knockout_create_select',
  'admin_event_reset_select',
  'admin_testdata_create_select',
  'admin_simulate_groups_select',
  'admin_simulate_knockout_select',
  'admin_ceremony_post_select',
]);
const ADMIN_SELECT_PREFIXES = [
  'admin_hof_first_select',
  'admin_hof_second_select:',
  'admin_hof_third_select:',
  'admin_hof_day_select:',
];

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
    const complete = team.registrationStatus === 'complete' ? 'Vollstaendig' : 'Unvollstaendig';
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
  return chunks[0] + (chunks.length > 1 ? `\n\n... ${chunks.length - 1} weitere Bloecke gekuerzt.` : '');
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

function isAdminSelectId(customId) {
  return ADMIN_SELECT_IDS.has(customId) || ADMIN_SELECT_PREFIXES.some(prefix => String(customId).startsWith(prefix));
}

function sortedRegisteredTeams(excludeTeamIds = []) {
  const excluded = new Set(excludeTeamIds.filter(Boolean).map(String));
  return listVisibleTeams()
    .filter(team => !excluded.has(String(team.id)))
    .slice()
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }));
}

function buildTeamSelect(customId, placeholder, excludeTeamIds = []) {
  const teams = sortedRegisteredTeams(excludeTeamIds);
  if (!teams.length) throw new Error('Es gibt keine auswaehlbaren Teams.');

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(teams.slice(0, 25).map(team => ({
      label: team.clubName.slice(0, 100),
      value: String(team.id),
      description: team.logo?.fileName ? `Logo: ${team.logo.fileName}`.slice(0, 100) : 'Logo fehlt',
    })));

  return new ActionRowBuilder().addComponents(select);
}

function buildHallOfFameDaySelect(firstTeamId, secondTeamId, thirdTeamId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`admin_hof_day_select:${firstTeamId}:${secondTeamId}:${thirdTeamId}`)
    .setPlaceholder('Wochentag auswaehlen')
    .addOptions(Object.entries(CEREMONY_DAY_LABELS).map(([value, label]) => ({ label, value })));

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
    if (event.format?.lockedAt) throw new Error('Nach dem Format-Lock koennen keine Freilose mehr hinzugefuegt werden.');
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
    if (event.format?.lockedAt) throw new Error('Nach dem Format-Lock koennen keine Freilose mehr entfernt werden.');
    event.byes = Array.isArray(event.byes) ? event.byes : [];
    const index = event.byes.map(bye => bye?.type === 'bye' && bye?.status !== 'removed').lastIndexOf(true);
    if (index === -1) throw new Error('Fuer dieses Event gibt es kein Freilos.');

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
  if (interaction.customId === 'admin_hof_first_select') {
    const firstTeamId = interaction.values?.[0];
    await interaction.update({
      content: 'Platz 2 auswaehlen.',
      components: [buildTeamSelect(`admin_hof_second_select:${firstTeamId}`, 'Platz 2 auswaehlen', [firstTeamId])],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_hof_second_select:')) {
    const [, firstTeamId] = interaction.customId.split(':');
    const secondTeamId = interaction.values?.[0];
    await interaction.update({
      content: 'Platz 3 auswaehlen.',
      components: [buildTeamSelect(`admin_hof_third_select:${firstTeamId}:${secondTeamId}`, 'Platz 3 auswaehlen', [firstTeamId, secondTeamId])],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_hof_third_select:')) {
    const [, firstTeamId, secondTeamId] = interaction.customId.split(':');
    const thirdTeamId = interaction.values?.[0];
    await interaction.update({
      content: 'Wochentag fuer den Hall-of-Fame-Test auswaehlen.',
      components: [buildHallOfFameDaySelect(firstTeamId, secondTeamId, thirdTeamId)],
    });
    return true;
  }

  if (interaction.customId.startsWith('admin_hof_day_select:')) {
    const [, firstTeamId, secondTeamId, thirdTeamId] = interaction.customId.split(':');
    const dayKey = interaction.values?.[0];
    await interaction.deferUpdate();
    const result = await postHallOfFameTest({
      guild: interaction.guild,
      dayKey,
      firstTeamId,
      secondTeamId,
      thirdTeamId,
    });
    await interaction.editReply({
      content: [
        `Hall-of-Fame-Test wurde in <#${result.channelId}> gepostet.`,
        `Wochentag: ${result.dayLabel}`,
        `1. ${result.teams.first.clubName}`,
        `2. ${result.teams.second.clubName}`,
        `3. ${result.teams.third.clubName}`,
      ].join('\n'),
      components: [],
    });
    return true;
  }

  const eventKey = interaction.values?.[0];
  if (!EVENT_KEYS.includes(eventKey)) throw new Error('Event nicht gefunden.');

  await interaction.deferReply({ flags: EPHEMERAL });

  if (interaction.customId === 'admin_bye_add_select') {
    addManualBye(eventKey, interaction.user.id, settings);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({ content: `Freilos fuer ${EVENT_LABELS[eventKey]} wurde hinzugefuegt.`, components: [] });
    return true;
  }

  if (interaction.customId === 'admin_bye_remove_select') {
    removeManualBye(eventKey, interaction.user.id, settings);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({ content: `Freilos fuer ${EVENT_LABELS[eventKey]} wurde entfernt.`, components: [] });
    return true;
  }

  if (interaction.customId === 'admin_format_lock_select') {
    const result = lockEventFormat(eventKey, interaction.user.id);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({
      content: `Format fuer ${EVENT_LABELS[eventKey]} wurde gelockt: ${result.size}er Turnier mit ${result.participants.length} Teilnehmerplaetzen. Warteliste: ${result.waitlistTeamIds.length} Teams, ${result.waitlistByeCount} Freilose.`,
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
      content: `Gruppen fuer ${EVENT_LABELS[eventKey]} wurden gezogen: ${Object.keys(result.groups).length} Gruppen erstellt.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_group_release_current_select') {
    const result = await forceReleaseNextSlot(client, eventKey);
    await interaction.editReply({
      content: `Spieltag ${result.slot} fuer ${EVENT_LABELS[eventKey]} wurde sofort freigegeben.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_knockout_create_select') {
    const result = await createKnockoutPhase({
      eventKey,
      actorUserId: interaction.user.id,
      client,
      guild: interaction.guild,
    });
    await interaction.editReply({
      content: [
        `K.O.-Phase fuer ${EVENT_LABELS[eventKey]} wurde erstellt.`,
        `Qualifiziert: ${result.knockout.qualifiedTeams.length} Teams`,
        `Erste Runde: ${result.knockout.firstRoundKey}`,
        result.post?.categoryId ? `Kategorie: ${result.post.categoryId}` : null,
        result.post?.overviewChannelId ? `Uebersicht: <#${result.post.overviewChannelId}>` : 'K.O.-Uebersicht konnte nicht erstellt/gepostet werden.',
        result.post?.ceremonyChannelId ? `Siegerehrung: <#${result.post.ceremonyChannelId}>` : null,
        result.post?.roundPosts?.length ? `Rundenkanaele: ${result.post.roundPosts.length}` : null,
      ].filter(Boolean).join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_event_reset_select') {
    const result = await resetEventForTesting({
      eventKey,
      actorUserId: interaction.user.id,
      client,
      guild: interaction.guild,
      settings,
    });
    await interaction.editReply({
      content: [
        `Event-Reset fuer ${EVENT_LABELS[eventKey]} wurde ausgefuehrt.`,
        `Gruppenkanaele geloescht: ${result.deletedGroupChannels.length}`,
        `K.O.-Kanaele geloescht: ${result.deletedKnockoutChannels.length}`,
        `Gruppenrollen geleert: ${result.clearedGroupRoles.length}`,
        `K.O.-Rollen geleert: ${result.clearedKnockoutRoles.length}`,
        `Fehlende Kanaele ignoriert: ${result.missingChannels.length}`,
        `Check-in aktualisiert: ${result.checkinRefreshed ? 'ja' : 'nein'}`,
        'Eventdaten und Message-Refs wurden zurueckgesetzt. Teamregistrierungen wurden nicht geloescht.',
      ].join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_testdata_create_select') {
    const result = createTestDataForEvent({ eventKey, actorUserId: interaction.user.id });
    await refreshRegisteredTeamsOverview(client).catch(() => null);
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply({
      content: `Testdaten fuer ${EVENT_LABELS[eventKey]} wurden erzeugt: ${result.allIds.length} Testteams eingecheckt.`,
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_simulate_groups_select') {
    const result = await simulateGroupPhase({
      eventKey,
      actorUserId: interaction.user.id,
      client,
    });
    await interaction.editReply({
      content: [
        `Gruppenphase fuer ${EVENT_LABELS[eventKey]} wurde simuliert.`,
        `Gruppen: ${result.groups}`,
        `Bestaetigte Spiele: ${result.simulatedMatches}`,
        'Status: Gruppenphase completed. K.O. erstellen kann jetzt getestet werden.',
      ].join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_simulate_knockout_select') {
    const result = await simulateKnockoutPhase({
      eventKey,
      actorUserId: interaction.user.id,
      client,
      guild: interaction.guild,
    });
    await interaction.editReply({
      content: [
        `K.O.-Phase fuer ${EVENT_LABELS[eventKey]} wurde simuliert.`,
        `Bestaetigte K.O.-Spiele: ${result.simulatedMatches}`,
        result.placements?.firstTeamId ? `Platz 1: ${result.placements.first.displayName}` : null,
        result.placements?.secondTeamId ? `Platz 2: ${result.placements.second.displayName}` : null,
        result.placements?.thirdTeamId ? `Platz 3: ${result.placements.third.displayName}` : null,
        result.placements?.fourthTeamId ? `Platz 4: ${result.placements.fourth.displayName}` : null,
        'Status: K.O. completed, Ceremony ist vorbereitet.',
      ].filter(Boolean).join('\n'),
      components: [],
    });
    return true;
  }

  if (interaction.customId === 'admin_ceremony_post_select') {
    const result = await postHallOfFameCeremony({
      guild: interaction.guild,
      eventKey,
    });
    await interaction.editReply({
      content: [
        `Siegerehrung fuer ${EVENT_LABELS[eventKey]} wurde gepostet.`,
        `Kanal: <#${result.channelId}>`,
        `1. ${result.teams.first.clubName}`,
        `2. ${result.teams.second.clubName}`,
        `3. ${result.teams.third.clubName}`,
      ].join('\n'),
      components: [],
    });
    return true;
  }

  throw new Error('Unbekannte Admin-Auswahl.');
}

async function handleAdminInteraction(interaction, client) {
  const isAdminButton = interaction.isButton?.() && ADMIN_ACTIONS.has(interaction.customId);
  const isAdminSelect = interaction.isStringSelectMenu?.() && isAdminSelectId(interaction.customId);
  if (!isAdminButton && !isAdminSelect) return false;

  const settings = readSettings();

  try {
    await requireAdminAccess(interaction, settings);

    if (isAdminSelect) return await handleAdminSelect(interaction, client, settings);

    if (interaction.customId === 'admin_bye_add') {
      await interaction.reply({
        content: 'Fuer welches Event soll ein Freilos hinzugefuegt werden?',
        components: [buildEventSelect('admin_bye_add_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_bye_remove') {
      await interaction.reply({
        content: 'Fuer welches Event soll ein Freilos entfernt werden?',
        components: [buildEventSelect('admin_bye_remove_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_format_lock') {
      await interaction.reply({
        content: 'Fuer welches Event soll das Format gelockt werden?',
        components: [buildEventSelect('admin_format_lock_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_groups_draw') {
      await interaction.reply({
        content: 'Fuer welches Event sollen Gruppen gezogen werden?',
        components: [buildEventSelect('admin_groups_draw_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_group_release_current') {
      await interaction.reply({
        content: 'Fuer welches Event soll der aktuelle Spieltag sofort freigegeben werden?',
        components: [buildEventSelect('admin_group_release_current_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_knockout_create') {
      await interaction.reply({
        content: 'Fuer welches Event soll die K.O.-Phase erstellt werden?',
        components: [buildEventSelect('admin_knockout_create_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_event_reset') {
      await interaction.reply({
        content: 'Fuer welches Event soll der Reset vorbereitet werden?',
        components: [buildEventSelect('admin_event_reset_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_testdata_create') {
      await interaction.reply({
        content: 'Fuer welches Event sollen Testdaten erzeugt und eingecheckt werden?',
        components: [buildEventSelect('admin_testdata_create_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_simulate_groups') {
      await interaction.reply({
        content: 'Fuer welches Event soll die Gruppenphase simuliert werden?',
        components: [buildEventSelect('admin_simulate_groups_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_simulate_knockout') {
      await interaction.reply({
        content: 'Fuer welches Event soll die K.O.-Phase simuliert werden?',
        components: [buildEventSelect('admin_simulate_knockout_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_hof_test') {
      const teams = sortedRegisteredTeams();
      if (teams.length < 3) throw new Error('Fuer den Hall-of-Fame-Test werden mindestens drei registrierte Teams benoetigt.');
      await interaction.reply({
        content: 'Platz 1 auswaehlen.',
        components: [buildTeamSelect('admin_hof_first_select', 'Platz 1 auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_ceremony_post') {
      await interaction.reply({
        content: 'Fuer welches Event soll die Siegerehrung gepostet werden?',
        components: [buildEventSelect('admin_ceremony_post_select', 'Event auswaehlen')],
        flags: EPHEMERAL,
      });
      return true;
    }

    if (interaction.customId === 'admin_testdata_remove') {
      await interaction.deferReply({ flags: EPHEMERAL });
      const result = removeTestData();
      await refreshRegisteredTeamsOverview(client).catch(() => null);
      await refreshCheckinMessages(EVENT_KEYS, client);
      await interaction.editReply(`Testdaten wurden entfernt: ${result.removedIds.length} Testteams geloescht. Echte Teams wurden nicht angeruehrt.`);
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
      await interaction.editReply('Teamuebersicht wurde aktualisiert.');
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
      await interaction.reply({ content: 'Ceremony-Test wird in spaeterer Phase implementiert.', flags: EPHEMERAL });
      return true;
    }

    await interaction.reply({ content: 'Funktion folgt in spaeterer Phase.', flags: EPHEMERAL });
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
