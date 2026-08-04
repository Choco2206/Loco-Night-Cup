'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData } = require('../events/event-repository');
const { refreshLiveSchedule } = require('../live-schedule');
const { findTeamById } = require('../teams/team-service');
const {
  applyTeamAchievementsForEvent,
  refreshTeamAchievementsRankingMessage,
} = require('../teams/team-achievements');
const { applyTeamStatsForEvent } = require('../teams/team-statistics');
const { syncChampionRolesForTeam } = require('../teams/team-champion-roles');
const { maybePostHallOfFameCeremony } = require('../ceremony');
const { upsertKnockoutPost } = require('./knockout-posts');
const { getConfiguredGuild } = require('../groups/group-roles');
const { handleResultOutcome } = require('../results/result-confirmation-service');
const { scheduleRatingCapture, scheduleTeamOfTheTournamentPost } = require('../team-of-the-tournament');
const { enqueueCoalesced } = require('../../app/async-coalescer');
const {
  getReplacementCandidates,
  getReplaceableMatches,
  participantLabel,
  replaceKnockoutTeam,
} = require('./knockout-replacements');
const {
  getAdminSelectableMatches,
  getUserSelectableMatches,
  setAdminResult,
  submitTeamResult,
} = require('./knockout-results');

const EPHEMERAL = 64;
const REPLACEMENT_PAGE_SIZE = 25;

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
      .setPlaceholder('K.O.-Spiel auswählen')
      .addOptions(entries.slice(0, 25).map(entry => ({
        label: matchLabel(entry.match),
        value: entry.value,
        description: matchDescription(entry.match),
      })))
  );
}

function clampPage(page, totalPages) {
  const parsed = Number(page);
  if (!Number.isInteger(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), Math.max(totalPages - 1, 0));
}

function buildReplacementMatchSelect(eventKey, roundKey, entries) {
  return buildMatchSelect(`ko_replace_match_select:${eventKey}:${roundKey}`, entries.map(entry => ({
    match: entry.match,
    value: entry.value,
  })));
}

function buildReplacementSideSelect(eventKey, roundKey, match) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ko_replace_side_select:${eventKey}:${roundKey}:${match.id}`)
      .setPlaceholder('Zu ersetzendes Team auswählen')
      .addOptions([
        {
          label: `Team 1: ${participantLabel(match.home)}`.slice(0, 100),
          value: 'home',
          description: 'Team 1 ersetzen',
        },
        {
          label: `Team 2: ${participantLabel(match.away)}`.slice(0, 100),
          value: 'away',
          description: 'Team 2 ersetzen',
        },
      ])
  );
}

function buildReplacementTeamPayload({ eventKey, roundKey, matchId, side, page = 0 }) {
  const candidates = getReplacementCandidates({ eventKey, roundKey, matchId, side });
  if (!candidates.length) throw new Error('Kein verfügbares Ersatzteam gefunden.');

  const totalPages = Math.max(1, Math.ceil(candidates.length / REPLACEMENT_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const pageCandidates = candidates.slice(
    currentPage * REPLACEMENT_PAGE_SIZE,
    (currentPage + 1) * REPLACEMENT_PAGE_SIZE
  );

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ko_replace_team_select:${eventKey}:${roundKey}:${matchId}:${side}:${currentPage}`)
        .setPlaceholder(totalPages === 1 ? 'Ersatzteam auswählen' : `Ersatzteam auswählen (${currentPage + 1}/${totalPages})`)
        .addOptions(pageCandidates.map(team => ({
          label: team.label.slice(0, 100),
          value: team.id,
          description: team.description.slice(0, 100),
        })))
    ),
  ];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ko_replace_team_page:${eventKey}:${roundKey}:${matchId}:${side}:${currentPage - 1}`)
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`ko_replace_team_page:${eventKey}:${roundKey}:${matchId}:${side}:${currentPage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    ));
  }

  return {
    content: totalPages === 1
      ? 'Wähle das Ersatzteam aus.'
      : `Wähle das Ersatzteam aus.\nSeite ${currentPage + 1}/${totalPages} (${candidates.length} Teams)`,
    components,
  };
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
      content: 'Keine meldbaren K.O.-Spiele für dich in dieser Runde.',
      flags: EPHEMERAL,
    });
    return true;
  }

  await interaction.reply({
    content: 'Wähle dein K.O.-Spiel aus. Das Endergebnis darf kein Unentschieden sein.',
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
    content: 'Wähle das K.O.-Spiel für das Admin-Ergebnis aus.',
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
  if (!entry) throw new Error('Dieses K.O.-Spiel ist für dich nicht meldbar.');

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
  return enqueueCoalesced(`knockout-posts:${eventKey}`, async () => {
    const latestEvent = readEventData(eventKey);
    await upsertKnockoutPost({ client, guild, eventKey, event: latestEvent || event });
    await refreshLiveSchedule(client, eventKey, latestEvent || event).catch(error => {
      console.warn(`[live-schedule] K.O.-Refresh für ${eventKey} fehlgeschlagen: ${error.message}`);
    });
  });
}

async function postCeremonyIfReady(guild, eventKey) {
  try {
    return await maybePostHallOfFameCeremony({ guild, eventKey });
  } catch (error) {
    console.warn(`Hall of Fame ceremony auto-post failed for ${eventKey}: ${error.message}`);
    return { posted: false, reason: 'error', error };
  }
}

async function applyAchievementsIfCompleted({ client, guild, eventKey, completed }) {
  if (!completed) return { applied: false, reason: 'not_completed' };

  const stats = applyTeamStatsForEvent(eventKey);
  if (stats.applied) {
    console.log(`[team-stats] ${eventKey}: ${stats.appliedTeams.length} Teams final aktualisiert.`);
  }

  const result = applyTeamAchievementsForEvent(eventKey);
  if (result.applied) {
    await refreshTeamAchievementsRankingMessage({ client, guild, force: true }).catch(error => {
      console.warn(`[team-achievements] Ranking konnte nicht aktualisiert werden: ${error.message}`);
    });
    await syncChampionRolesForTeam(guild, result.placementTeamIds.gold).catch(error => {
      console.warn(`[champion-roles] Gewinnerteam konnte nicht synchronisiert werden: ${error.message}`);
    });
  }
  return result;
}

async function finalizeConfirmedKnockoutResult(client, eventKey, outcome, guild = null) {
  scheduleRatingCapture(eventKey, outcome.match);
  const targetGuild = guild || await getConfiguredGuild(client, readSettings());
  await refreshKnockout(client, targetGuild, eventKey, outcome.event);
  await applyAchievementsIfCompleted({ client, guild: targetGuild, eventKey, completed: outcome.completed });
  const ceremony = await postCeremonyIfReady(targetGuild, eventKey);
  if (outcome.completed) {
    try {
      scheduleTeamOfTheTournamentPost({ client, eventKey });
    } catch (error) {
      console.warn(`[tott] Planung für ${eventKey} fehlgeschlagen; Turnierabschluss läuft weiter: ${error.message}`);
    }
  }
  return ceremony;
}

async function handleTeamResultModal(interaction, eventKey, roundKey, matchId, selectedParticipantKey, client) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const outcome = submitTeamResult({
    eventKey,
    roundKey,
    matchId,
    participantKeyValue: decodeURIComponent(selectedParticipantKey),
    userId: interaction.user.id,
    homeGoals: interaction.fields.getTextInputValue('home_goals'),
    awayGoals: interaction.fields.getTextInputValue('away_goals'),
  });

  await interaction.editReply({ content: 'Ergebnis gespeichert. K.-o.-Spielplan wird aktualisiert.' });
  await handleResultOutcome({
    client, eventKey, phase: 'knockout', phaseKey: roundKey, outcome, channelId: interaction.channelId,
  });
  if (outcome.status !== 'confirmed') {
    await refreshKnockout(client, interaction.guild, eventKey, outcome.event);
  }
  const ceremony = outcome.status === 'confirmed'
    ? await finalizeConfirmedKnockoutResult(client, eventKey, outcome, interaction.guild)
    : { posted: false };
  await notifyAdminDecision(interaction, outcome.match);
  const message = outcome.status === 'confirmed'
    ? ceremony.posted
      ? `K.O.-Ergebnis bestätigt. Sieger und nächste Runde wurden aktualisiert. Siegerehrung wurde in <#${ceremony.result.channelId}> gepostet.`
      : 'K.O.-Ergebnis bestätigt. Sieger und nächste Runde wurden aktualisiert.'
    : outcome.status === 'admin_decision_required'
      ? 'Ergebnis gespeichert. Es ist eine Admin-Entscheidung erforderlich.'
      : 'Ergebnis gespeichert. Es wartet auf die Meldung des Gegners.';
  await interaction.editReply({ content: message });
  return true;
}

async function handleOpenReplacement(interaction, eventKey, roundKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein K.O.-Team ersetzen.', flags: EPHEMERAL });
    return true;
  }

  const entries = getReplaceableMatches(eventKey, roundKey);
  if (!entries.length) {
    await interaction.reply({ content: 'Keine ersetzbaren K.O.-Matches in dieser Runde gefunden.', flags: EPHEMERAL });
    return true;
  }

  await interaction.reply({
    content: 'Wähle die K.O.-Paarung aus, in der ein Team ersetzt werden soll.',
    components: [buildReplacementMatchSelect(eventKey, roundKey, entries)],
    flags: EPHEMERAL,
  });
  return true;
}

async function handleReplacementMatchSelect(interaction, eventKey, roundKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein K.O.-Team ersetzen.', flags: EPHEMERAL });
    return true;
  }

  const matchId = interaction.values?.[0];
  const { round } = getRoundFromEvent(eventKey, roundKey);
  const match = (round.matches || []).find(entry => String(entry.id) === String(matchId));
  if (!match) throw new Error('K.O.-Match wurde nicht gefunden.');

  await interaction.update({
    content: 'Welches Team soll ersetzt werden?',
    components: [buildReplacementSideSelect(eventKey, roundKey, match)],
  });
  return true;
}

async function handleReplacementSideSelect(interaction, eventKey, roundKey, matchId) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein K.O.-Team ersetzen.', flags: EPHEMERAL });
    return true;
  }

  const side = interaction.values?.[0];
  await interaction.update(buildReplacementTeamPayload({ eventKey, roundKey, matchId, side, page: 0 }));
  return true;
}

async function handleReplacementTeamPage(interaction, eventKey, roundKey, matchId, side, page) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein K.O.-Team ersetzen.', flags: EPHEMERAL });
    return true;
  }

  await interaction.update(buildReplacementTeamPayload({ eventKey, roundKey, matchId, side, page }));
  return true;
}

async function handleReplacementTeamSelect(interaction, eventKey, roundKey, matchId, side, client) {
  await interaction.deferUpdate();
  if (!await isAdminAllowed(interaction)) {
    await interaction.editReply({ content: 'Du darfst kein K.O.-Team ersetzen.', components: [] });
    return true;
  }

  const replacementTeamId = interaction.values?.[0];
  const outcome = replaceKnockoutTeam({
    eventKey,
    roundKey,
    matchId,
    side,
    replacementTeamId,
    adminUserId: interaction.user.id,
  });

  await interaction.editReply({ content: 'Ergebnis gespeichert. K.-o.-Spielplan wird aktualisiert.' });

  if (outcome.status !== 'confirmed') {
    await refreshKnockout(client, interaction.guild, eventKey, outcome.event);
  }
  await interaction.editReply({
    content: [
      'K.O.-Team ersetzt.',
      `Alt: **${outcome.oldTeam?.clubName || participantLabel(outcome.oldParticipant)}**`,
      `Neu: **${outcome.newTeam.clubName}**`,
      'Ergebnis, offene Meldungen und Admin-Entscheidung für diese Paarung wurden zurückgesetzt.',
    ].join('\n'),
    components: [],
  });
  return true;
}

async function handleAdminResultModal(interaction, eventKey, roundKey, matchId, client) {
  await interaction.deferReply({ flags: EPHEMERAL });
  if (!await isAdminAllowed(interaction)) {
    await interaction.editReply({ content: 'Du darfst kein K.O.-Admin-Ergebnis setzen.' });
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

  await interaction.editReply({ content: 'K.-o.-Admin-Ergebnis gespeichert. Spielplan wird aktualisiert.' });

  await handleResultOutcome({ client, eventKey, phase: 'knockout', phaseKey: roundKey, outcome, channelId: interaction.channelId });
  const ceremony = await finalizeConfirmedKnockoutResult(client, eventKey, outcome, interaction.guild);
  await interaction.editReply({
    content: ceremony.posted
      ? `K.O.-Admin-Ergebnis gesetzt. K.O.-Phase ist abgeschlossen. Siegerehrung wurde in <#${ceremony.result.channelId}> gepostet.`
      : outcome.completed
      ? 'K.O.-Admin-Ergebnis gesetzt. K.O.-Phase ist abgeschlossen und Ceremony ist vorbereitet.'
      : 'K.O.-Admin-Ergebnis gesetzt. Sieger und nächste Runde wurden aktualisiert.',
  });
  return true;
}

async function handleKnockoutInteraction(interaction, client) {
  const customId = interaction.customId || '';

  if (interaction.isButton?.()) {
    const [action, eventKey, roundKey, matchId, side, page] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'ko_result_open') return handleOpenTeamResult(interaction, eventKey, roundKey);
    if (action === 'ko_admin_result_open') return handleOpenAdminResult(interaction, eventKey, roundKey);
    if (action === 'ko_replace_open') return handleOpenReplacement(interaction, eventKey, roundKey);
    if (action === 'ko_replace_team_page') return handleReplacementTeamPage(interaction, eventKey, roundKey, matchId, side, page);
  }

  if (interaction.isStringSelectMenu?.()) {
    const [action, eventKey, roundKey, matchId, side] = customId.split(':');
    if (!EVENT_KEYS.includes(eventKey)) return false;
    if (action === 'ko_result_select') return handleTeamResultSelect(interaction, eventKey, roundKey);
    if (action === 'ko_admin_result_select') return handleAdminResultSelect(interaction, eventKey, roundKey);
    if (action === 'ko_replace_match_select') return handleReplacementMatchSelect(interaction, eventKey, roundKey);
    if (action === 'ko_replace_side_select') return handleReplacementSideSelect(interaction, eventKey, roundKey, matchId);
    if (action === 'ko_replace_team_select') return handleReplacementTeamSelect(interaction, eventKey, roundKey, matchId, side, client);
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
  finalizeConfirmedKnockoutResult,
  handleKnockoutInteraction,
};
