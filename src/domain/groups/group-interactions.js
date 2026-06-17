'use strict';

const {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { refreshGroupPosts } = require('./group-posts');
const {
  getAdminSelectableMatches,
  getCurrentReleasedSlot,
  getUserSelectableMatches,
  setAdminResult,
  submitTeamResult,
} = require('./group-results');

const EPHEMERAL = 64;

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function hasAnyRole(member, roleIds) {
  return roleIds.filter(Boolean).some(roleId => member.roles.cache.has(String(roleId)));
}

async function isAdminAllowed(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  const settings = readSettings();
  const adminRoleIds = [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ];
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member);
  return hasAnyRole(member, [...new Set(adminRoleIds.map(String))]);
}

function getGroupFromEvent(eventKey, groupKey) {
  const event = readEventData(eventKey);
  const group = event.groups?.groups?.[groupKey];
  if (!group) throw new Error('Gruppe wurde nicht gefunden.');
  return { event, group };
}

function labelForParticipant(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'Freilos';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || 'Team';
}

function matchLabel(match) {
  return `${labelForParticipant(match.home)} vs ${labelForParticipant(match.away)}`.slice(0, 100);
}

function matchDescription(match) {
  if (match.result) return `${match.result.homeGoals}:${match.result.awayGoals} | ${match.status}`;
  return `Status: ${match.status}`;
}

function buildMatchSelect(customId, entries) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Spiel auswaehlen')
      .addOptions(entries.slice(0, 25).map(entry => ({
        label: matchLabel(entry.match),
        value: entry.value,
        description: matchDescription(entry.match).slice(0, 100),
      })))
  );
}

function createScoreModal({ customId, title, match }) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('home_goals')
          .setLabel(`${labelForParticipant(match.home)} Tore`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('away_goals')
          .setLabel(`${labelForParticipant(match.away)} Tore`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

async function handleOpenTeamResult(interaction, eventKey, groupKey) {
  const { group } = getGroupFromEvent(eventKey, groupKey);
  const entries = getUserSelectableMatches(group, interaction.user.id)
    .flatMap(entry => entry.participantKeys.map(key => ({
      match: entry.match,
      value: `${entry.match.id}|${key}`,
    })));

  if (!entries.length) {
    const slot = getCurrentReleasedSlot(group);
    await interaction.reply({
      content: `Keine meldbaren Spiele fuer dich im aktuell freigegebenen Slot ${slot}.`,
      flags: EPHEMERAL,
    });
    return true;
  }

  await interaction.reply({
    content: `Waehle dein Spiel aus. Aktuell freigegebener Slot: ${getCurrentReleasedSlot(group)}.`,
    components: [buildMatchSelect(`group_result_select:${eventKey}:${groupKey}`, entries)],
    flags: EPHEMERAL,
  });
  return true;
}

async function handleOpenAdminResult(interaction, eventKey, groupKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const { group } = getGroupFromEvent(eventKey, groupKey);
  const entries = getAdminSelectableMatches(group).map(match => ({
    match,
    value: match.id,
  }));

  if (!entries.length) {
    await interaction.reply({ content: 'Keine echten Gruppenspiele gefunden.', flags: EPHEMERAL });
    return true;
  }

  await interaction.reply({
    content: 'Waehle das Spiel fuer das Admin-Ergebnis aus.',
    components: [buildMatchSelect(`group_admin_result_select:${eventKey}:${groupKey}`, entries)],
    flags: EPHEMERAL,
  });
  return true;
}

async function handleReplacementPlaceholder(interaction) {
  await interaction.reply({ content: 'Diese Funktion kommt in einer spaeteren Phase.', flags: EPHEMERAL });
  return true;
}

async function handleTeamResultSelect(interaction, eventKey, groupKey) {
  const [matchId, selectedParticipantKey] = String(interaction.values?.[0] || '').split('|');
  const { group } = getGroupFromEvent(eventKey, groupKey);
  const entry = getUserSelectableMatches(group, interaction.user.id)
    .find(item => String(item.match.id) === String(matchId) && item.participantKeys.includes(selectedParticipantKey));
  if (!entry) throw new Error('Dieses Spiel ist fuer dich nicht meldbar.');

  await interaction.showModal(createScoreModal({
    customId: `group_result_modal:${eventKey}:${groupKey}:${matchId}:${encodeURIComponent(selectedParticipantKey)}`,
    title: 'Ergebnis eintragen',
    match: entry.match,
  }));
  return true;
}

async function handleAdminResultSelect(interaction, eventKey, groupKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const matchId = interaction.values?.[0];
  const { group } = getGroupFromEvent(eventKey, groupKey);
  const match = getAdminSelectableMatches(group).find(entry => String(entry.id) === String(matchId));
  if (!match) throw new Error('Spiel wurde nicht gefunden.');

  await interaction.showModal(createScoreModal({
    customId: `group_admin_result_modal:${eventKey}:${groupKey}:${match.id}`,
    title: 'Admin-Ergebnis',
    match,
  }));
  return true;
}

async function notifyAdminDecision(interaction, match) {
  if (match.status !== 'admin_decision_required') return;
  await interaction.channel?.send({
    content: [
      '\ud83d\udee0\ufe0f **Admin-Entscheidung erforderlich**',
      `${labelForParticipant(match.home)} vs ${labelForParticipant(match.away)}`,
      'Die beiden Teams haben unterschiedliche Ergebnisse gemeldet.',
    ].join('\n'),
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

async function handleTeamResultModal(interaction, eventKey, groupKey, matchId, selectedParticipantKey, client) {
  const decodedParticipantKey = decodeURIComponent(selectedParticipantKey);
  const outcome = submitTeamResult({
    eventKey,
    groupKey,
    matchId,
    participantKeyValue: decodedParticipantKey,
    userId: interaction.user.id,
    homeGoals: interaction.fields.getTextInputValue('home_goals'),
    awayGoals: interaction.fields.getTextInputValue('away_goals'),
  });

  await refreshGroupPosts({ client, eventKey, event: outcome.event, group: outcome.group });
  await notifyAdminDecision(interaction, outcome.match);

  const message = outcome.status === 'confirmed'
    ? 'Ergebnis bestaetigt. Tabelle und Spielplan wurden aktualisiert.'
    : outcome.status === 'admin_decision_required'
      ? 'Ergebnis gespeichert. Es ist eine Admin-Entscheidung erforderlich.'
      : 'Ergebnis gespeichert. Es wartet auf die Meldung des Gegners.';
  await interaction.reply({ content: message, flags: EPHEMERAL });
  return true;
}

async function handleAdminResultModal(interaction, eventKey, groupKey, matchId, client) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const outcome = setAdminResult({
    eventKey,
    groupKey,
    matchId,
    adminUserId: interaction.user.id,
    homeGoals: interaction.fields.getTextInputValue('home_goals'),
    awayGoals: interaction.fields.getTextInputValue('away_goals'),
  });

  await refreshGroupPosts({ client, eventKey, event: outcome.event, group: outcome.group });
  await interaction.reply({
    content: 'Admin-Ergebnis gesetzt. Tabelle und Spielplan wurden aktualisiert.',
    flags: EPHEMERAL,
  });
  return true;
}

async function handleGroupInteraction(interaction, client) {
  const customId = interaction.customId || '';

  if (interaction.isButton?.()) {
    const [action, eventKey, groupKey] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'group_result_open') return handleOpenTeamResult(interaction, eventKey, groupKey);
    if (action === 'group_admin_result_open') return handleOpenAdminResult(interaction, eventKey, groupKey);
    if (action === 'group_replacement_open') return handleReplacementPlaceholder(interaction);
  }

  if (interaction.isStringSelectMenu?.()) {
    const [action, eventKey, groupKey] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'group_result_select') return handleTeamResultSelect(interaction, eventKey, groupKey);
    if (action === 'group_admin_result_select') return handleAdminResultSelect(interaction, eventKey, groupKey);
  }

  if (interaction.isModalSubmit?.()) {
    const [action, eventKey, groupKey, matchId, selectedParticipantKey] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'group_result_modal') {
      return handleTeamResultModal(interaction, eventKey, groupKey, matchId, selectedParticipantKey, client);
    }
    if (action === 'group_admin_result_modal') {
      return handleAdminResultModal(interaction, eventKey, groupKey, matchId, client);
    }
  }

  return false;
}

module.exports = {
  handleGroupInteraction,
};
