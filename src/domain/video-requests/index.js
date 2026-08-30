'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { readEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');

const EPHEMERAL = 64;
const REFRESH_INTERVAL_MS = 30 * 1000;
const PANEL_PREFIX = 'video_request_open';
const SELECT_PREFIX = 'video_request_select';
let refreshTimer = null;

function isTeamMember(team, userId) {
  if (!team || !userId) return false;
  const id = String(userId);
  if (String(team.manager?.userId || '') === id) return true;
  return (team.coManagers || []).some(coManager => String(coManager?.userId || '') === id);
}

function teamName(team, fallback = 'Team') {
  return team?.clubName || fallback;
}

function participantTeam(participant) {
  if (participant?.type !== 'team' || !participant.teamId) return null;
  return findTeamById(participant.teamId);
}

function participantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'Freilos';
  return participant.displayName || teamName(participantTeam(participant), participant.teamId || 'Team');
}

function teamManagerUserIds(team) {
  const ids = [team?.manager?.userId, ...(team?.coManagers || []).map(coManager => coManager?.userId)]
    .filter(Boolean)
    .map(String);
  return [...new Set(ids)];
}

function mentionUsers(userIds) {
  return userIds.map(userId => `<@${userId}>`).join(' ');
}

function isReleasedOpenMatch(match) {
  return Boolean(
    match?.home?.type === 'team'
    && match?.away?.type === 'team'
    && match?.release?.releasedAt
    && match.status !== 'confirmed'
  );
}

function groupMatches(group) {
  return (group?.matchdays || []).flatMap(matchday => matchday?.matches || []);
}

function currentGroupSlot(event, groupKey) {
  const release = event?.groups?.releases?.groups?.[groupKey];
  return Number(release?.currentSlot) || null;
}

function groupMatchSlot(match) {
  const releaseSlot = Number(match?.release?.slot);
  if (Number.isInteger(releaseSlot) && releaseSlot > 0) return releaseSlot;
  const explicitSlot = Number(match?.slot ?? match?.matchday ?? match?.matchDay);
  return Number.isInteger(explicitSlot) && explicitSlot > 0 ? explicitSlot : null;
}

function requesterEntryForMatch(match, userId) {
  const homeTeam = participantTeam(match.home);
  const awayTeam = participantTeam(match.away);
  if (!homeTeam || !awayTeam) return null;
  if (isTeamMember(homeTeam, userId)) return { requesterTeam: homeTeam, opponentTeam: awayTeam };
  if (isTeamMember(awayTeam, userId)) return { requesterTeam: awayTeam, opponentTeam: homeTeam };
  return null;
}

function getGroupRequestableMatches(event, groupKey, userId) {
  const group = event?.groups?.groups?.[groupKey];
  const slot = currentGroupSlot(event, groupKey);
  if (!group || !slot) return [];
  return groupMatches(group)
    .filter(match => isReleasedOpenMatch(match) && groupMatchSlot(match) === slot)
    .map(match => ({ match, slot, ...requesterEntryForMatch(match, userId) }))
    .filter(entry => entry.requesterTeam && entry.opponentTeam);
}

function getLeagueRequestableMatches(event, userId) {
  const phase = event?.leaguePhase;
  const slot = Number(phase?.currentMatchday) || null;
  if (phase?.phaseType !== 'league' || !slot) return [];
  const matchday = phase.matchdays?.[slot - 1];
  if (!matchday) return [];
  return (matchday.matches || [])
    .filter(match => isReleasedOpenMatch(match) && groupMatchSlot(match) === slot)
    .map(match => ({ match, slot, ...requesterEntryForMatch(match, userId) }))
    .filter(entry => entry.requesterTeam && entry.opponentTeam);
}

function getKoRequestableMatches(event, roundKey, userId) {
  const round = event?.knockout?.rounds?.[roundKey];
  if (!round) return [];
  return (round.matches || [])
    .filter(isReleasedOpenMatch)
    .map(match => ({ match, ...requesterEntryForMatch(match, userId) }))
    .filter(entry => entry.requesterTeam && entry.opponentTeam);
}

function getRequestableMatches(event, phase, phaseKey, userId) {
  if (phase === 'group') return getGroupRequestableMatches(event, phaseKey, userId);
  if (phase === 'league') return getLeagueRequestableMatches(event, userId);
  return getKoRequestableMatches(event, phaseKey, userId);
}

function panelCustomId(phase, eventKey, phaseKey) {
  return `${PANEL_PREFIX}:${phase}:${eventKey}:${phaseKey}`;
}

function selectCustomId(phase, eventKey, phaseKey) {
  return `${SELECT_PREFIX}:${phase}:${eventKey}:${phaseKey}`;
}

function buildPanelRow(phase, eventKey, phaseKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(phase, eventKey, phaseKey))
      .setLabel('Größenvideo anfordern')
      .setEmoji('📹')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildPanelPayload(phase, eventKey, phaseKey) {
  const context = phase === 'group'
    ? `Gruppe ${phaseKey}`
    : phase === 'league'
      ? 'Ligaphase'
      : 'K.O.-Runde';
  return {
    content: [
      '📹 **Größenvideo anfordern**',
      `Hier könnt ihr für eure aktuell freigegebene Begegnung in **${context}** ein Größenvideo vom Gegner anfordern.`,
      'Es werden nur Begegnungen angezeigt, die gerade freigegeben sind und an denen euer Team beteiligt ist.',
    ].join('\n'),
    components: [buildPanelRow(phase, eventKey, phaseKey)],
    allowedMentions: { parse: [] },
  };
}

function hasPanelComponent(message, phase, eventKey, phaseKey) {
  const expected = panelCustomId(phase, eventKey, phaseKey);
  return (message?.components || []).some(row => (row.components || []).some(component => component.customId === expected));
}

async function ensurePanelInChannel(client, channelId, phase, eventKey, phaseKey) {
  if (!channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send || !channel.messages?.fetch) return false;

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const existing = recent?.find(message => message.author?.id === client.user.id && hasPanelComponent(message, phase, eventKey, phaseKey));
  const payload = buildPanelPayload(phase, eventKey, phaseKey);
  if (existing) await existing.edit(payload).catch(() => null);
  else await channel.send(payload).catch(() => null);
  return true;
}

async function refreshPanels(client) {
  if (!client?.user) return;
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    for (const [groupKey, group] of Object.entries(event?.groups?.groups || {})) {
      await ensurePanelInChannel(client, group?.videoChannelId, 'group', eventKey, groupKey).catch(() => null);
    }
    if (event?.leaguePhase?.phaseType === 'league' && event.leaguePhase.videoChannelId) {
      await ensurePanelInChannel(client, event.leaguePhase.videoChannelId, 'league', eventKey, 'league').catch(() => null);
    }
    for (const [roundKey, round] of Object.entries(event?.knockout?.rounds || {})) {
      if (!round?.matches?.length || round.status === 'not_needed') continue;
      await ensurePanelInChannel(client, round?.videoChannelId, 'ko', eventKey, roundKey).catch(() => null);
    }
  }
}

function buildMatchSelect(phase, eventKey, phaseKey, entries) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(selectCustomId(phase, eventKey, phaseKey))
      .setPlaceholder('Begegnung auswählen')
      .addOptions(entries.slice(0, 25).map(entry => {
        const prefix = phase === 'group' || phase === 'league' ? `Spieltag ${entry.slot}: ` : '';
        return {
          label: `${prefix}${participantName(entry.match.home)} vs ${participantName(entry.match.away)}`.slice(0, 100),
          value: String(entry.match.id),
          description: `Gegner: ${teamName(entry.opponentTeam)}`.slice(0, 100),
        };
      }))
  );
}

async function handleOpenRequest(interaction, phase, eventKey, phaseKey) {
  const event = readEventData(eventKey);
  const entries = getRequestableMatches(event, phase, phaseKey, interaction.user.id);

  if (!entries.length) {
    await interaction.reply({
      content: 'Für dein Team gibt es hier aktuell keine freigegebene Begegnung, für die ein Größenvideo angefordert werden kann.',
      flags: EPHEMERAL,
    });
    return true;
  }

  const slotText = phase === 'group' || phase === 'league'
    ? ` Aktuell freigegeben: Spieltag ${entries[0].slot}.`
    : '';
  await interaction.reply({
    content: `Wähle die Begegnung aus, für die du ein Größenvideo vom Gegner anfordern möchtest.${slotText}`,
    components: [buildMatchSelect(phase, eventKey, phaseKey, entries)],
    flags: EPHEMERAL,
  });
  return true;
}

async function handleRequestSelect(interaction, phase, eventKey, phaseKey) {
  const matchId = String(interaction.values?.[0] || '');
  const event = readEventData(eventKey);
  const entries = getRequestableMatches(event, phase, phaseKey, interaction.user.id);
  const entry = entries.find(candidate => String(candidate.match.id) === matchId);

  if (!entry) {
    await interaction.update({
      content: 'Diese Begegnung ist nicht mehr freigegeben oder gehört nicht zu deinem Team.',
      components: [],
    });
    return true;
  }

  const opponentUserIds = teamManagerUserIds(entry.opponentTeam);
  const opponentMentions = mentionUsers(opponentUserIds);
  const context = phase === 'group' || phase === 'league'
    ? `Spieltag ${entry.slot} · ${participantName(entry.match.home)} vs ${participantName(entry.match.away)}`
    : `${participantName(entry.match.home)} vs ${participantName(entry.match.away)}`;

  await interaction.channel.send({
    content: [
      opponentMentions,
      '📹 **Größenvideo angefordert**',
      `**${teamName(entry.requesterTeam)}** hat für **${context}** ein Größenvideo angefordert.`,
      'Bitte schickt das Größenvideo **spätestens nach dem Spiel** hier in den Kanal.',
    ].filter(Boolean).join('\n'),
    allowedMentions: { parse: [], users: opponentUserIds },
  });

  await interaction.update({
    content: `✅ Größenvideo bei **${teamName(entry.opponentTeam)}** angefordert.`,
    components: [],
  });
  return true;
}

async function handleInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith(`${PANEL_PREFIX}:`) && !customId.startsWith(`${SELECT_PREFIX}:`)) return false;

  const [prefix, phase, eventKey, phaseKey] = customId.split(':');
  if (!['group', 'league', 'ko'].includes(phase) || !EVENT_KEYS.includes(eventKey) || !phaseKey) return false;

  if (prefix === PANEL_PREFIX && interaction.isButton?.()) {
    return handleOpenRequest(interaction, phase, eventKey, phaseKey);
  }
  if (prefix === SELECT_PREFIX && interaction.isStringSelectMenu?.()) {
    return handleRequestSelect(interaction, phase, eventKey, phaseKey);
  }
  return false;
}

async function init(client) {
  await refreshPanels(client);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refreshPanels(client).catch(error => console.warn(`[video-request] Panel-Refresh fehlgeschlagen: ${error.message}`));
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

module.exports = {
  handleInteraction,
  init,
  refreshPanels,
};
