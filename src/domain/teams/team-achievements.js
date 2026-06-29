'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { readTeamsData, updateTeamsData } = require('./team-repository');

const TEAM_ACHIEVEMENTS_CHANNEL_ID = '1521094531833925764';
const DISCORD_MESSAGE_LIMIT = 2000;

function nowIso() {
  return new Date().toISOString();
}

function createEmptyHistory() {
  return {
    titles: {
      gold: 0,
      silver: 0,
      bronze: 0,
    },
  };
}

function normalizeNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function ensureTeamHistory(team) {
  const before = JSON.stringify(team.history || null);
  team.history = team.history && typeof team.history === 'object' && !Array.isArray(team.history)
    ? team.history
    : {};
  team.history.titles = team.history.titles && typeof team.history.titles === 'object' && !Array.isArray(team.history.titles)
    ? team.history.titles
    : {};
  team.history.titles.gold = normalizeNonNegativeInteger(team.history.titles.gold);
  team.history.titles.silver = normalizeNonNegativeInteger(team.history.titles.silver);
  team.history.titles.bronze = normalizeNonNegativeInteger(team.history.titles.bronze);
  return before !== JSON.stringify(team.history);
}

function getTeamTitles(team) {
  const titles = team?.history?.titles || {};
  return {
    gold: normalizeNonNegativeInteger(titles.gold),
    silver: normalizeNonNegativeInteger(titles.silver),
    bronze: normalizeNonNegativeInteger(titles.bronze),
  };
}

function hasPlacement(titles) {
  return titles.gold > 0 || titles.silver > 0 || titles.bronze > 0;
}

function compareAchievementEntries(left, right) {
  if (right.titles.gold !== left.titles.gold) return right.titles.gold - left.titles.gold;
  if (right.titles.silver !== left.titles.silver) return right.titles.silver - left.titles.silver;
  if (right.titles.bronze !== left.titles.bronze) return right.titles.bronze - left.titles.bronze;
  return String(left.clubName || '').localeCompare(String(right.clubName || ''), 'de', { sensitivity: 'base' });
}

function getTeamAchievementRanking() {
  return readTeamsData().teams
    .filter(team => team?.id && team?.clubName)
    .map(team => ({
      teamId: String(team.id),
      clubName: team.clubName,
      titles: getTeamTitles(team),
    }))
    .filter(entry => hasPlacement(entry.titles))
    .sort(compareAchievementEntries)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function getTeamAchievementRank(teamId) {
  const id = String(teamId);
  const entry = getTeamAchievementRanking().find(item => String(item.teamId) === id);
  return entry?.rank || null;
}

function getPlacementTeamIds(event) {
  const placements = event?.ceremony?.placements || event?.knockout?.placements || {};
  return {
    gold: placements.firstTeamId ? String(placements.firstTeamId) : null,
    silver: placements.secondTeamId ? String(placements.secondTeamId) : null,
    bronze: placements.thirdTeamId ? String(placements.thirdTeamId) : null,
  };
}

function getEventAchievementState(event) {
  return event?.ceremony?.teamAchievements || {};
}

function applyTeamAchievementsForEvent(eventKey) {
  const event = readEventData(eventKey);
  const currentState = getEventAchievementState(event);
  if (currentState.appliedAt) {
    return { applied: false, reason: 'already_applied', state: currentState };
  }

  const placementTeamIds = getPlacementTeamIds(event);
  if (!placementTeamIds.gold || !placementTeamIds.silver || !placementTeamIds.bronze) {
    return { applied: false, reason: 'missing_placements', placementTeamIds };
  }

  if (event?.knockout?.status !== 'completed') {
    return { applied: false, reason: 'knockout_not_completed', placementTeamIds };
  }

  const timestamp = nowIso();
  const placementPairs = [
    ['gold', placementTeamIds.gold],
    ['silver', placementTeamIds.silver],
    ['bronze', placementTeamIds.bronze],
  ];
  const appliedTeams = [];

  updateTeamsData(data => {
    const teamsById = new Map((Array.isArray(data.teams) ? data.teams : []).map(team => [String(team.id), team]));
    for (const [, teamId] of placementPairs) {
      if (!teamsById.has(teamId)) throw new Error(`Team-Erfolge konnten nicht angewendet werden: Team ${teamId} wurde nicht gefunden.`);
    }

    for (const [placement, teamId] of placementPairs) {
      const team = teamsById.get(teamId);
      ensureTeamHistory(team);
      team.history.titles[placement] += 1;
      team.meta = { ...(team.meta || {}), updatedAt: timestamp };
      appliedTeams.push({ placement, teamId, clubName: team.clubName });
    }

    return data;
  });

  let state;
  updateEventData(eventKey, storedEvent => {
    storedEvent.ceremony = storedEvent.ceremony || {};
    if (storedEvent.ceremony.teamAchievements?.appliedAt) {
      state = storedEvent.ceremony.teamAchievements;
      return storedEvent;
    }

    storedEvent.ceremony.teamAchievements = {
      appliedAt: timestamp,
      placements: placementTeamIds,
    };
    storedEvent.meta = { ...(storedEvent.meta || {}), updatedAt: timestamp };
    state = storedEvent.ceremony.teamAchievements;
    return storedEvent;
  });

  return { applied: true, placementTeamIds, appliedTeams, state };
}

function incrementTeamAchievement({ teamId, titleKey, actorUserId = null }) {
  if (!['gold', 'silver', 'bronze'].includes(titleKey)) throw new Error('Dieser Team-Erfolg ist nicht bekannt.');

  const timestamp = nowIso();
  let updatedTeam = null;
  updateTeamsData(data => {
    const team = (Array.isArray(data.teams) ? data.teams : []).find(entry => String(entry.id) === String(teamId));
    if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');

    ensureTeamHistory(team);
    team.history.titles[titleKey] += 1;
    team.meta = {
      ...(team.meta || {}),
      updatedAt: timestamp,
      updatedByUserId: actorUserId ? String(actorUserId) : team.meta?.updatedByUserId || null,
    };
    updatedTeam = team;
    return data;
  });

  return updatedTeam;
}

function iconForRank(rank) {
  if (rank === 1) return '👑';
  if (rank === 2) return '💎';
  if (rank === 3) return '⚔️';
  return '🔥';
}

function rankingEntryText(entry) {
  return [
    `${iconForRank(entry.rank)} **#${entry.rank} ${entry.clubName}**`,
    `🥇 ${entry.titles.gold}   🥈 ${entry.titles.silver}   🥉 ${entry.titles.bronze}`,
  ].join('\n');
}

function createRankingMessageChunks(entries = getTeamAchievementRanking()) {
  if (!entries.length) {
    return [
      [
        '🏆 **Loco Night Cup Team-Erfolge**',
        '',
        'Hier werden alle Teams angezeigt, die bereits mindestens eine Platzierung im Loco Night Cup erreicht haben.',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '',
        '🏅 Noch keine Team-Erfolge vorhanden.',
        '',
        'Nach dem ersten abgeschlossenen Turnier erscheint hier automatisch das Ranking aller Teams mit mindestens einer Platzierung.',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '',
        '🔄 Diese Übersicht wird nach jedem abgeschlossenen Turnier automatisch aktualisiert.',
      ].join('\n'),
    ];
  }

  const header = [
    '🏆 **Loco Night Cup Team-Erfolge**',
    '',
    'Hier stehen alle Teams, die sich bereits eine Platzierung im Loco Night Cup erspielt haben.',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
  const continuationHeader = [
    '🏆 **Loco Night Cup Team-Erfolge (Fortsetzung)**',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
  const footer = [
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '🔄 Diese Übersicht wird nach jedem abgeschlossenen Turnier automatisch aktualisiert.',
  ].join('\n');

  const chunks = [];
  let current = header;

  for (const entry of entries) {
    const block = ['', rankingEntryText(entry)].join('\n');
    const next = `${current}${block}`;
    if (`${next}${footer}`.length > DISCORD_MESSAGE_LIMIT && current !== header) {
      chunks.push(`${current}${footer}`);
      current = `${continuationHeader}${block}`;
    } else {
      current = next;
    }
  }

  chunks.push(`${current}${footer}`);
  return chunks;
}

async function fetchAchievementsChannel(client, guild) {
  const fromClient = client?.channels?.fetch
    ? await client.channels.fetch(TEAM_ACHIEVEMENTS_CHANNEL_ID).catch(() => null)
    : null;
  const fromGuild = !fromClient && guild?.channels?.fetch
    ? await guild.channels.fetch(TEAM_ACHIEVEMENTS_CHANNEL_ID).catch(() => null)
    : null;
  const channel = fromClient || fromGuild || guild?.channels?.cache?.get?.(TEAM_ACHIEVEMENTS_CHANNEL_ID) || null;

  if (!channel?.send || !channel?.messages?.fetch) {
    throw new Error(`Team-Erfolge-Kanal ${TEAM_ACHIEVEMENTS_CHANNEL_ID} wurde nicht gefunden oder ist nicht beschreibbar.`);
  }

  return channel;
}

async function upsertMessage(channel, messageId, content) {
  const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  const payload = { content, allowedMentions: { parse: [] } };
  if (existing) return existing.edit(payload);
  return channel.send(payload);
}

async function deleteMessage(channel, messageId) {
  if (!messageId) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  await message.delete().catch(() => {});
  return true;
}

function readMessageState() {
  const messages = readJson(FILES.messages, createMessagesDefault());
  return messages.teams?.teamAchievements || { channelId: null, messageIds: [] };
}

function writeMessageState(messageIds) {
  const timestamp = nowIso();
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    messages.teams = messages.teams || {};
    const current = messages.teams.teamAchievements || {};
    messages.teams.teamAchievements = {
      channelId: TEAM_ACHIEVEMENTS_CHANNEL_ID,
      messageIds,
      createdAt: current.createdAt || timestamp,
      updatedAt: timestamp,
    };
    return messages;
  });
}

async function refreshTeamAchievementsRankingMessage({ client, guild, force = false }) {
  const state = readMessageState();
  const knownMessageIds = Array.isArray(state.messageIds) ? state.messageIds.filter(Boolean).map(String) : [];
  if (!force && !knownMessageIds.length) return { skipped: true, messageIds: [], rankedCount: null };

  const targetGuild = guild || client?.guilds?.cache?.first?.() || null;
  const channel = await fetchAchievementsChannel(client, targetGuild);
  const chunks = createRankingMessageChunks();
  const nextMessageIds = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const message = await upsertMessage(channel, knownMessageIds[index], chunks[index]);
    nextMessageIds.push(String(message.id));
  }

  for (const staleMessageId of knownMessageIds.slice(chunks.length)) {
    await deleteMessage(channel, staleMessageId);
  }

  writeMessageState(nextMessageIds);
  return {
    skipped: false,
    rankedCount: getTeamAchievementRanking().length,
    messageIds: nextMessageIds,
  };
}

async function ensureTeamAchievementsRankingMessage({ client, guild }) {
  return refreshTeamAchievementsRankingMessage({ client, guild, force: true });
}

module.exports = {
  TEAM_ACHIEVEMENTS_CHANNEL_ID,
  applyTeamAchievementsForEvent,
  createEmptyHistory,
  createRankingMessageChunks,
  ensureTeamHistory,
  getTeamAchievementRank,
  getTeamAchievementRanking,
  getTeamTitles,
  incrementTeamAchievement,
  ensureTeamAchievementsRankingMessage,
  refreshTeamAchievementsRankingMessage,
};
