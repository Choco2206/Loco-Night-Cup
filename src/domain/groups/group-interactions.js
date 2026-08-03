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
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { refreshGroupPosts } = require('./group-posts');
const { refreshLeaguePhasePosts } = require('../league-phase');
const { afterGroupResultConfirmed } = require('./group-releases');
const {
  announceReplacement,
  getAvailableReplacementTeams,
  getReplaceableParticipants,
  replaceGroupParticipant,
  syncReplacementDiscordResources,
} = require('./group-replacements');
const {
  getAdminSelectableMatchdays,
  getAdminSelectableMatches,
  getCurrentReleasedSlot,
  getUserSelectableMatches,
  setAdminResult,
  submitTeamResult,
} = require('./group-results');
const { handleResultOutcome } = require('../results/result-confirmation-service');
const { scheduleRatingCapture } = require('../team-of-the-tournament');

const EPHEMERAL = 64;
const SELECT_OPTION_LIMIT = 25;
const SELECT_ROW_LIMIT = 5;

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
  const group = String(groupKey).toLowerCase() === 'league' ? event.leaguePhase : event.groups?.groups?.[groupKey];
  if (!group) throw new Error('Gruppe wurde nicht gefunden.');
  return { event, group };
}

async function refreshPhasePosts(client, eventKey, event, group) {
  if (group?.phaseType === 'league') return refreshLeaguePhasePosts(client, eventKey);
  return refreshGroupPosts({ client, eventKey, event, group });
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
      content: `Keine meldbaren Spiele fuer dich im aktuell freigegebenen Slot ${slot || '-'}.`,
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
  const matchdays = getAdminSelectableMatchdays(group);

  if (!matchdays.length) {
    await interaction.reply({ content: 'Keine wertbaren Gruppenspiele gefunden.', flags: EPHEMERAL });
    return true;
  }

  await interaction.reply({
    content: 'Waehle zuerst den Spieltag aus. Auch abgeschlossene Spieltage koennen korrigiert werden.',
    components: [buildMatchdaySelect(eventKey, groupKey, matchdays)],
    flags: EPHEMERAL,
  });
  return true;
}

function buildReplacementTargetSelect(eventKey, groupKey, participants) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`group_replacement_target:${eventKey}:${groupKey}`)
      .setPlaceholder('Slot oder Teilnehmer ersetzen')
      .addOptions(participants.map(participant => ({
        label: participant.label.slice(0, 100),
        value: participant.participantKey,
        description: participant.description.slice(0, 100),
      })))
  );
}

function chunk(entries, size) {
  const chunks = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
}

function buildReplacementTeamSelectRows(eventKey, groupKey, participantKeyValue, teams) {
  const chunks = chunk(teams, SELECT_OPTION_LIMIT);
  if (chunks.length > SELECT_ROW_LIMIT) {
    throw new Error('Es sind zu viele Ersatzteams verfuegbar. Bitte reduziere die Auswahl voruebergehend.');
  }

  return chunks.map((teamChunk, index) => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`group_replacement_team:${eventKey}:${groupKey}:${encodeURIComponent(participantKeyValue)}:${index}`)
      .setPlaceholder(chunks.length === 1 ? 'Ersatzteam auswaehlen' : `Ersatzteam auswaehlen (${index + 1}/${chunks.length})`)
      .addOptions(teamChunk.map(team => ({
        label: team.label.slice(0, 100),
        value: team.id,
        description: team.description.slice(0, 100),
      })))
  ));
}

async function handleOpenReplacement(interaction, eventKey, groupKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst keinen Nachruecker einsetzen.', flags: EPHEMERAL });
    return true;
  }

  const participants = getReplaceableParticipants({ eventKey, groupKey });
  if (!participants.length) {
    await interaction.reply({ content: 'In dieser Gruppe gibt es keinen ersetzbaren Slot.', flags: EPHEMERAL });
    return true;
  }

  await interaction.reply({
    content: 'Waehle den Slot oder Teilnehmer aus, der ersetzt werden soll.',
    components: [buildReplacementTargetSelect(eventKey, groupKey, participants)],
    flags: EPHEMERAL,
  });
  return true;
}

async function handleReplacementTargetSelect(interaction, eventKey, groupKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst keinen Nachruecker einsetzen.', flags: EPHEMERAL });
    return true;
  }

  const participantKeyValue = interaction.values?.[0];
  const teams = getAvailableReplacementTeams({ eventKey, groupKey, participantKeyValue });
  if (!teams.length) {
    await interaction.update({
      content: 'Kein verfuegbares Ersatzteam gefunden.',
      components: [],
    });
    return true;
  }

  await interaction.update({
    content: 'Waehle das Ersatzteam aus.',
    components: buildReplacementTeamSelectRows(eventKey, groupKey, participantKeyValue, teams),
  });
  return true;
}

async function handleReplacementTeamSelect(interaction, eventKey, groupKey, encodedParticipantKey, client) {
  await interaction.deferUpdate();
  if (!await isAdminAllowed(interaction)) {
    await interaction.editReply({ content: 'Du darfst keinen Nachruecker einsetzen.', components: [] });
    return true;
  }

  const participantKeyValue = decodeURIComponent(encodedParticipantKey);
  const replacementTeamId = interaction.values?.[0];
  const outcome = replaceGroupParticipant({
    eventKey,
    groupKey,
    participantKeyValue,
    replacementTeamId,
  });
  const sync = await syncReplacementDiscordResources({ client, eventKey, outcome });
  await announceReplacement({ interaction, outcome, newUserIds: sync.newUserIds });

  await interaction.editReply({
    content: `Nachruecker eingesetzt: **${outcome.newTeam.clubName}**. Gruppenanzeigen, Rollen, Kanalrechte und Check-in wurden aktualisiert.`,
    components: [],
  });
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

async function handleAdminResultSelect(interaction, eventKey, groupKey, selectedMatchday) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const matchId = interaction.values?.[0];
  const { group } = getGroupFromEvent(eventKey, groupKey);
  const match = getAdminSelectableMatches(group).find(entry => (
    String(entry.id) === String(matchId)
    && Number(entry.matchday || entry.release?.slot || 0) === Number(selectedMatchday)
  ));
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

async function finalizeConfirmedGroupResult(client, eventKey, groupKey, outcome) {
  scheduleRatingCapture(eventKey, outcome.match);
  await refreshPhasePosts(client, eventKey, outcome.event, outcome.group);
  await afterGroupResultConfirmed(client, eventKey, groupKey);
}

function buildMatchdaySelect(eventKey, groupKey, matchdays) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`group_admin_result_matchday:${eventKey}:${groupKey}`)
      .setPlaceholder('Spieltag auswaehlen')
      .addOptions(matchdays.map(entry => ({
        label: `Spieltag ${entry.matchday}`,
        value: String(entry.matchday),
        description: `${entry.matches.length} Begegnung${entry.matches.length === 1 ? '' : 'en'}`,
      })))
  );
}

async function handleTeamResultModal(interaction, eventKey, groupKey, matchId, selectedParticipantKey, client) {
  await interaction.deferReply({ flags: EPHEMERAL });
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

  await interaction.editReply({ content: 'Ergebnis gespeichert. Tabelle und Spielplan werden aktualisiert.' });

  await handleResultOutcome({
    client, eventKey, phase: 'group', phaseKey: groupKey, outcome, channelId: interaction.channelId,
  });
  if (outcome.status !== 'confirmed') {
    await refreshPhasePosts(client, eventKey, outcome.event, outcome.group);
  }
  await notifyAdminDecision(interaction, outcome.match);
  if (outcome.status === 'confirmed') {
    await finalizeConfirmedGroupResult(client, eventKey, groupKey, outcome);
  }

  const message = outcome.status === 'confirmed'
    ? 'Ergebnis bestaetigt. Tabelle und Spielplan wurden aktualisiert.'
    : outcome.status === 'admin_decision_required'
      ? 'Ergebnis gespeichert. Es ist eine Admin-Entscheidung erforderlich.'
      : 'Ergebnis gespeichert. Es wartet auf die Meldung des Gegners.';
  await interaction.editReply({ content: message });
  return true;
}

async function handleAdminMatchdaySelect(interaction, eventKey, groupKey) {
  if (!await isAdminAllowed(interaction)) {
    await interaction.reply({ content: 'Du darfst kein Admin-Ergebnis setzen.', flags: EPHEMERAL });
    return true;
  }

  const selectedMatchday = Number(interaction.values?.[0]);
  const { group } = getGroupFromEvent(eventKey, groupKey);
  const selected = getAdminSelectableMatchdays(group)
    .find(entry => entry.matchday === selectedMatchday);
  if (!selected) throw new Error('Spieltag wurde nicht gefunden.');

  await interaction.update({
    content: `Waehle die Begegnung aus Spieltag ${selectedMatchday} aus.`,
    components: [buildMatchSelect(
      `group_admin_result_select:${eventKey}:${groupKey}:${selectedMatchday}`,
      selected.matches.map(match => ({ match, value: match.id }))
    )],
  });
  return true;
}

function groupMessageIds(group, refs) {
  return [
    group?.messageId,
    group?.headerMessageId,
    group?.teamsMessageId,
    group?.tableMessageId,
    group?.scheduleMessageId,
    refs?.messageId,
    refs?.headerMessageId,
    refs?.teamsMessageId,
    refs?.tableMessageId,
    refs?.scheduleMessageId,
  ].filter(Boolean).map(String);
}

function collectGroupCandidates() {
  const messages = readJson(FILES.messages, createMessagesDefault());
  const candidates = [];
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (event.leaguePhase?.phaseType === 'league') {
      const group = event.leaguePhase;
      candidates.push({ eventKey, groupKey: 'league', event, group,
        channelId: String(group.resultsChannelId || ''),
        messageIds: Object.values(group.messages || {}).filter(Boolean).map(String),
        liveTableMessageId: group.messages?.resultsTableMessageId || null });
    }
    for (const [groupKey, group] of Object.entries(event.groups?.groups || {})) {
      const refs = messages.groups?.[eventKey]?.groups?.[groupKey] || {};
      candidates.push({
        eventKey,
        groupKey,
        event,
        group,
        channelId: String(group.channelId || refs.channelId || ''),
        messageIds: groupMessageIds(group, refs),
        liveTableMessageId: group.tableMessageId || refs.tableMessageId || null,
      });
    }
  }
  return candidates;
}

function logMissingGroup(interaction, parsedEventKey, parsedGroupKey, candidates) {
  console.error('[group-interactions] Gruppe wurde nicht gefunden.', {
    customId: interaction.customId || null,
    channelId: interaction.channelId || interaction.channel?.id || null,
    messageId: interaction.message?.id || null,
    recognizedGroupId: parsedGroupKey || null,
    eventId: parsedEventKey || null,
    events: EVENT_KEYS.map(eventKey => ({
      eventId: eventKey,
      existingGroupIds: candidates.filter(candidate => candidate.eventKey === eventKey).map(candidate => candidate.groupKey),
      groups: candidates
        .filter(candidate => candidate.eventKey === eventKey)
        .map(candidate => ({
          groupId: candidate.groupKey,
          storedChannelId: candidate.channelId || null,
          liveTableMessageId: candidate.liveTableMessageId,
        })),
    })),
  });
}

function resolveGroupInteractionContext(interaction, parsedEventKey, parsedGroupKey) {
  const candidates = collectGroupCandidates();
  console.info('[group-interactions] Gruppeninteraktion wird aufgeloest.', {
    customId: interaction.customId || null,
    channelId: interaction.channelId || interaction.channel?.id || null,
    messageId: interaction.message?.id || null,
    extractedGroupId: parsedGroupKey || null,
    extractedWeekday: parsedEventKey || null,
    eventFile: FILES.events?.[parsedEventKey] || null,
    existingGroupIds: candidates
      .filter(candidate => candidate.eventKey === parsedEventKey)
      .map(candidate => candidate.groupKey),
    existingChannelIds: candidates
      .filter(candidate => candidate.eventKey === parsedEventKey)
      .map(candidate => candidate.channelId)
      .filter(Boolean),
  });
  const exact = candidates.find(candidate => (
    candidate.eventKey === parsedEventKey && candidate.groupKey === parsedGroupKey
  ));
  if (exact) return exact;

  const caseInsensitive = candidates.find(candidate => (
    candidate.eventKey === parsedEventKey
    && candidate.groupKey.toLowerCase() === String(parsedGroupKey || '').toLowerCase()
  ));
  if (caseInsensitive) return caseInsensitive;

  const channelId = String(interaction.channelId || interaction.channel?.id || '');
  const messageId = String(interaction.message?.id || '');
  const channelMatches = channelId
    ? candidates.filter(candidate => candidate.channelId === channelId)
    : [];
  const messageMatches = messageId
    ? candidates.filter(candidate => candidate.messageIds.includes(messageId))
    : [];
  const resolved = channelMatches.length === 1
      ? channelMatches[0]
      : messageMatches.length === 1
        ? messageMatches[0]
        : null;

  if (resolved) {
    console.warn('[group-interactions] Gruppe ueber gespeicherte Discord-Zuordnung aufgeloest.', {
      customId: interaction.customId || null,
      channelId: channelId || null,
      messageId: messageId || null,
      parsedEventId: parsedEventKey || null,
      parsedGroupId: parsedGroupKey || null,
      resolvedEventId: resolved.eventKey,
      resolvedGroupId: resolved.groupKey,
      liveTableMessageId: resolved.liveTableMessageId,
    });
    return resolved;
  }

  logMissingGroup(interaction, parsedEventKey, parsedGroupKey, candidates);
  throw new Error('Gruppe wurde nicht gefunden.');
}

async function handleAdminResultModal(interaction, eventKey, groupKey, matchId, client) {
  await interaction.deferReply({ flags: EPHEMERAL });
  if (!await isAdminAllowed(interaction)) {
    await interaction.editReply({ content: 'Du darfst kein Admin-Ergebnis setzen.' });
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

  await interaction.editReply({ content: 'Admin-Ergebnis gespeichert. Tabelle und Spielplan werden aktualisiert.' });

  await handleResultOutcome({ client, eventKey, phase: 'group', phaseKey: groupKey, outcome, channelId: interaction.channelId });
  await finalizeConfirmedGroupResult(client, eventKey, groupKey, outcome);
  await interaction.editReply({
    content: 'Admin-Ergebnis gesetzt. Tabelle und Spielplan wurden aktualisiert.',
  });
  return true;
}

async function handleGroupInteraction(interaction, client) {
  const { handleAttendanceInteraction } = require('./attendance-service');
  if (await handleAttendanceInteraction(interaction, client)) return true;
  const customId = interaction.customId || '';
  const { handleLeaguePhaseTestInteraction } = require('../league-phase/league-phase-test');
  if (await handleLeaguePhaseTestInteraction(interaction)) return true;

  if (interaction.isButton?.()) {
    const [action, parsedEventKey, parsedGroupKey] = customId.split(':');
    if (!['group_result_open', 'group_admin_result_open', 'group_replacement_open'].includes(action)) return false;
    const { eventKey, groupKey } = resolveGroupInteractionContext(interaction, parsedEventKey, parsedGroupKey);
    if (action === 'group_result_open') return handleOpenTeamResult(interaction, eventKey, groupKey);
    if (action === 'group_admin_result_open') return handleOpenAdminResult(interaction, eventKey, groupKey);
    if (action === 'group_replacement_open') return handleOpenReplacement(interaction, eventKey, groupKey);
  }

  if (interaction.isStringSelectMenu?.()) {
    const [action, parsedEventKey, parsedGroupKey, extraValue] = customId.split(':');
    if (!['group_result_select', 'group_admin_result_matchday', 'group_admin_result_select', 'group_replacement_target', 'group_replacement_team'].includes(action)) return false;
    const { eventKey, groupKey } = resolveGroupInteractionContext(interaction, parsedEventKey, parsedGroupKey);
    if (action === 'group_result_select') return handleTeamResultSelect(interaction, eventKey, groupKey);
    if (action === 'group_admin_result_matchday') return handleAdminMatchdaySelect(interaction, eventKey, groupKey);
    if (action === 'group_admin_result_select') return handleAdminResultSelect(interaction, eventKey, groupKey, extraValue);
    if (action === 'group_replacement_target') return handleReplacementTargetSelect(interaction, eventKey, groupKey);
    if (action === 'group_replacement_team') return handleReplacementTeamSelect(interaction, eventKey, groupKey, extraValue, client);
  }

  if (interaction.isModalSubmit?.()) {
    const parts = customId.split(':');
    const [action, parsedEventKey, parsedGroupKey] = parts;
    if (!['group_result_modal', 'group_admin_result_modal'].includes(action)) return false;
    const { eventKey, groupKey } = resolveGroupInteractionContext(interaction, parsedEventKey, parsedGroupKey);
    if (action === 'group_result_modal') {
      const selectedParticipantKey = parts.at(-1);
      const matchId = parts.slice(3, -1).join(':');
      return handleTeamResultModal(interaction, eventKey, groupKey, matchId, selectedParticipantKey, client);
    }
    if (action === 'group_admin_result_modal') {
      const matchId = parts.slice(3).join(':');
      return handleAdminResultModal(interaction, eventKey, groupKey, matchId, client);
    }
  }

  return false;
}

module.exports = {
  finalizeConfirmedGroupResult,
  handleGroupInteraction,
};

