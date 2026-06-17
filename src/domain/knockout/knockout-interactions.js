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
const { maybePostHallOfFameCeremony } = require('../ceremony');
const { upsertKnockoutPost } = require('./knockout-posts');
const {
  getAdminSelectableMatches,
  getUserSelectableMatches,
  setAdminResult,
  submitTeamResult,
} = require('./knockout-results');

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

function getRoundFromEvent(eventKey, roundKey) {
  const event = readEventData(eventKey);
  const round = event.knockout?.rounds?.[roundKey];
  if (!round) throw new Error('K.O.-Runde wurde nicht gefunden.');
  return { event, round };
}

function labelForParticipant(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'placeholder') return participant.displayName || 'TBD';
  if (participant.type === 'bye') return 'Freilos';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || 'Team';
}

function matchLabel(match) {
  return `${labelForParticipant(match.home)} vs ${labelForParticipant(match.away)}`.slice(0, 100);
}

function matchDescription(match) {
  if (match.result) return `${match.result.homeGoals}:${match.result.awayGoals} | ${match.status}`.slice(0, 100);
  return `Status: ${match.status}`.slice(0, 100);
}

function buildMatchSelect(customId, entries) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('K.O.-Spiel auswaehlen')
      .addOptions(entries.slice(0, 25).map(entry => ({
        label: matchLabel(entry.match),
        value: entry.value,
        description: matchDescription(entry.match),
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

async function handleOpenTeamResult(interaction, eventKey, roundKey) {
  const { round } = getRoundFromEvent(eventKey, roundKey);
  const entries = getUserSelectableMatches(round, interaction.user.id)
    .flatMap(entry => entry.participantKeys.map(key => ({
      match: entry.match,
      value: `${entry.match.id}|${key}`,
    })));

  if (!entries.length) {
    await interaction.reply({
      content: 'Keine meldbaren K.O.-Spiele fuer dich in dieser Runde.',
      flags: EPHEMERAL,
    });
    return true;
  }

  await interaction.reply({
    content: 'Waehle dein K.O.-Spiel aus. Das Endergebnis darf kein Unentschieden sein.',
    components: [buildMatchSelect(`ko_result_select:${eventKey}:${roundKey}`, entries)],
    flags: EPHEMERAL,
  });
  return true;
}

async function handleOpenAdminResult(interaction, eventKey, roundKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein K.O.-Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const { round } = getRoundFromEvent(eventKey, roundKey);
  const entries = getAdminSelectableMatches(round).map(match => ({ match, value: match.id }));
  if (!entries.length) {
    await interaction.reply({ content: 'Keine echten K.O.-Spiele in dieser Runde gefunden.', flags: EPHEMERAL });
    return true;
  }

  await interaction.reply({
    content: 'Waehle das K.O.-Spiel fuer das Admin-Ergebnis aus.',
    components: [buildMatchSelect(`ko_admin_result_select:${eventKey}:${roundKey}`, entries)],
    flags: EPHEMERAL,
  });
  return true;
}

async function handleTeamResultSelect(interaction, eventKey, roundKey) {
  const [matchId, selectedParticipantKey] = String(interaction.values?.[0] || '').split('|');
  const { round } = getRoundFromEvent(eventKey, roundKey);
  const entry = getUserSelectableMatches(round, interaction.user.id)
    .find(item => String(item.match.id) === String(matchId) && item.participantKeys.includes(selectedParticipantKey));
  if (!entry) throw new Error('Dieses K.O.-Spiel ist fuer dich nicht meldbar.');

  await interaction.showModal(createScoreModal({
    customId: `ko_result_modal:${eventKey}:${roundKey}:${matchId}:${encodeURIComponent(selectedParticipantKey)}`,
    title: 'K.O.-Ergebnis eintragen',
    match: entry.match,
  }));
  return true;
}

async function handleAdminResultSelect(interaction, eventKey, roundKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein K.O.-Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const matchId = interaction.values?.[0];
  const { round } = getRoundFromEvent(eventKey, roundKey);
  const match = getAdminSelectableMatches(round).find(entry => String(entry.id) === String(matchId));
  if (!match) throw new Error('K.O.-Spiel wurde nicht gefunden.');

  await interaction.showModal(createScoreModal({
    customId: `ko_admin_result_modal:${eventKey}:${roundKey}:${match.id}`,
    title: 'K.O.-Admin-Ergebnis',
    match,
  }));
  return true;
}

async function notifyAdminDecision(interaction, match) {
  if (match.status !== 'admin_decision_required') return;
  await interaction.channel?.send({
    content: [
      '🛠️ **K.O.-Admin-Entscheidung erforderlich**',
      `${labelForParticipant(match.home)} vs ${labelForParticipant(match.away)}`,
      'Die beiden Teams haben unterschiedliche Ergebnisse gemeldet.',
    ].join('\n'),
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

async function refreshKnockout(client, guild, eventKey, event) {
  await upsertKnockoutPost({ client, guild, eventKey, event });
}

async function postCeremonyIfReady(guild, eventKey) {
  try {
    return await maybePostHallOfFameCeremony({ guild, eventKey });
  } catch (error) {
    console.warn(`Hall of Fame ceremony auto-post failed for ${eventKey}: ${error.message}`);
    return { posted: false, reason: 'error', error };
  }
}

async function handleTeamResultModal(interaction, eventKey, roundKey, matchId, selectedParticipantKey, client) {
  const outcome = submitTeamResult({
    eventKey,
    roundKey,
    matchId,
    participantKeyValue: decodeURIComponent(selectedParticipantKey),
    userId: interaction.user.id,
    homeGoals: interaction.fields.getTextInputValue('home_goals'),
    awayGoals: interaction.fields.getTextInputValue('away_goals'),
  });

  await refreshKnockout(client, interaction.guild, eventKey, outcome.event);
  const ceremony = await postCeremonyIfReady(interaction.guild, eventKey);
  await notifyAdminDecision(interaction, outcome.match);
  const message = outcome.status === 'confirmed'
    ? ceremony.posted
      ? `K.O.-Ergebnis bestaetigt. Sieger und naechste Runde wurden aktualisiert. Siegerehrung wurde in <#${ceremony.result.channelId}> gepostet.`
      : 'K.O.-Ergebnis bestaetigt. Sieger und naechste Runde wurden aktualisiert.'
    : outcome.status === 'admin_decision_required'
      ? 'Ergebnis gespeichert. Es ist eine Admin-Entscheidung erforderlich.'
      : 'Ergebnis gespeichert. Es wartet auf die Meldung des Gegners.';
  await interaction.reply({ content: message, flags: EPHEMERAL });
  return true;
}

async function handleAdminResultModal(interaction, eventKey, roundKey, matchId, client) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein K.O.-Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const outcome = setAdminResult({
    eventKey,
    roundKey,
    matchId,
    adminUserId: interaction.user.id,
    homeGoals: interaction.fields.getTextInputValue('home_goals'),
    awayGoals: interaction.fields.getTextInputValue('away_goals'),
  });

  await refreshKnockout(client, interaction.guild, eventKey, outcome.event);
  const ceremony = await postCeremonyIfReady(interaction.guild, eventKey);
  await interaction.reply({
    content: ceremony.posted
      ? `K.O.-Admin-Ergebnis gesetzt. K.O.-Phase ist abgeschlossen. Siegerehrung wurde in <#${ceremony.result.channelId}> gepostet.`
      : outcome.completed
      ? 'K.O.-Admin-Ergebnis gesetzt. K.O.-Phase ist abgeschlossen und Ceremony ist vorbereitet.'
      : 'K.O.-Admin-Ergebnis gesetzt. Sieger und naechste Runde wurden aktualisiert.',
    flags: EPHEMERAL,
  });
  return true;
}

async function handleKnockoutInteraction(interaction, client) {
  const customId = interaction.customId || '';

  if (interaction.isButton?.()) {
    const [action, eventKey, roundKey] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'ko_result_open') return handleOpenTeamResult(interaction, eventKey, roundKey);
    if (action === 'ko_admin_result_open') return handleOpenAdminResult(interaction, eventKey, roundKey);
  }

  if (interaction.isStringSelectMenu?.()) {
    const [action, eventKey, roundKey] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'ko_result_select') return handleTeamResultSelect(interaction, eventKey, roundKey);
    if (action === 'ko_admin_result_select') return handleAdminResultSelect(interaction, eventKey, roundKey);
  }

  if (interaction.isModalSubmit?.()) {
    const [action, eventKey, roundKey, matchId, selectedParticipantKey] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'ko_result_modal') return handleTeamResultModal(interaction, eventKey, roundKey, matchId, selectedParticipantKey, client);
    if (action === 'ko_admin_result_modal') return handleAdminResultModal(interaction, eventKey, roundKey, matchId, client);
  }

  return false;
}

module.exports = {
  handleKnockoutInteraction,
};
