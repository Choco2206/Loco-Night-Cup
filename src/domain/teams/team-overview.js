'use strict';

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('./team-service');
const { resolveProfileLinks, profileLink, escapeLabel } = require('./user-profile-links');
let refreshQueue = Promise.resolve();

const TEAM_LIST_CHUNK_LIMIT = 1850;
const MISSING_MEMBER_LABEL = '⚠️ Nicht mehr auf dem Server';
const REGISTERED_TEAMS_CHANNEL_ID = '1516429682843848935';

function chunkBlocks(blocks, maxLength = TEAM_LIST_CHUNK_LIMIT) {
  const chunks = [];
  let current = '';

  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : ['Noch keine Teams registriert.'];
}

function normalizeTeamName(value) {
  return String(value || '').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
}

function uniqueSortedTeams(teams) {
  const byId = new Map();
  for (const team of teams || []) {
    if (!team?.id) continue;
    byId.set(String(team.id), team);
  }

  const byName = new Map();
  for (const team of byId.values()) {
    const key = normalizeTeamName(team.clubName) || String(team.id);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, team);
      continue;
    }

    const existingUpdated = new Date(existing.meta?.updatedAt || existing.meta?.createdAt || 0).getTime() || 0;
    const currentUpdated = new Date(team.meta?.updatedAt || team.meta?.createdAt || 0).getTime() || 0;
    if (currentUpdated >= existingUpdated) byName.set(key, team);
  }

  return [...byName.values()].sort((a, b) => (
    String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de', {
      sensitivity: 'base',
      numeric: true,
    })
  ));
}

function buildHeaderEmbed(teams) {
  return new EmbedBuilder()
    .setTitle('🏆 LOCO NIGHT CUP • REGISTRIERTE TEAMS')
    .setDescription([
      `Aktuell registriert: **${teams.length} Teams**`,
      '',
      'Teams sind alphabetisch sortiert.',
      'Bei Rückfragen kannst du die VMs direkt anklicken.',
    ].join('\n'))
    .setColor(0xff0000)
    .setFooter({ text: 'Loco Night Bot • Team-Übersicht' });
}

function formatTeamNumber(index) {
  return String(index + 1).padStart(2, '0');
}

function formatUser(userId, links = new Map()) {
  if (!userId) return MISSING_MEMBER_LABEL;
  return links.get(String(userId)) || profileLink(userId);
}

function formatCoManagers(team, links) {
  const coManagers = Array.isArray(team.coManagers) ? team.coManagers : [];
  if (!coManagers.length) return 'Keine';

  const uniqueUserIds = [...new Set(coManagers.map(coManager => String(coManager?.userId || '')).filter(Boolean))];
  if (!uniqueUserIds.length) return 'Keine';
  return uniqueUserIds.map(id => formatUser(id, links)).join(', ');
}

function buildTeamBlocks(teams, links) {
  return uniqueSortedTeams(teams).map((team, index) => [
    `🔴 **${formatTeamNumber(index)} | ${escapeLabel(team.clubName)}**`,
    `👑 **VM:** ${formatUser(team.manager?.userId, links)}`,
    `🤝 **Co-VM:** ${formatCoManagers(team, links)}`,
  ].join('\n'));
}

function createListPayload(content) {
  return {
    content,
    embeds: [],
    flags: MessageFlags.SuppressEmbeds,
    allowedMentions: { parse: [] },
  };
}

async function fetchTrackedMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(String(messageId)).catch(error => {
    if (error.code === 10008) return null;
    throw error;
  });
}

async function syncHeaderMessage(channel, trackedId, teams) {
  const payload = { content: null, embeds: [buildHeaderEmbed(teams)], allowedMentions: { parse: [] } };
  const existing = await fetchTrackedMessage(channel, trackedId);
  if (existing) {
    await existing.edit(payload);
    return existing;
  }
  return channel.send(payload);
}

function messagesAreOutOfOrder(messages) {
  return messages.some((message, index) => index > 0 && message.createdTimestamp < messages[index - 1].createdTimestamp);
}

function isOverviewBlock(message) {
  const content = String(message.content || '').trim();
  if (content === 'Noch keine Teams registriert.') return true;
  // Older versions placed bold markers around the whole heading/label.
  // Recognize both layouts, only in our own numbered team-list messages.
  const plain = content.replace(/\*\*/g, '');
  return /^🔴\s+\d+\s*\|\s*[^\n]+/u.test(plain)
    && /^👑\s+VM:\s*/mu.test(plain)
    && /^🤝\s+Co-VM:\s*/mu.test(plain);
}

async function discoverOverviewMessages(channel, botId) {
  const found = [];
  let before;
  for (;;) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!page.size) break;
    for (const message of page.values()) {
      if (message.author?.id === botId && isOverviewBlock(message)) found.push(message);
    }
    before = page.last().id;
    if (page.size < 100) break;
  }
  return found.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function syncListMessages(channel, trackedIds, chunks, botId) {
  const discovered = await discoverOverviewMessages(channel, botId);
  const byId = new Map(discovered.map(message => [String(message.id), message]));
  for (const id of new Set(trackedIds || [])) {
    if (!byId.has(String(id))) {
      const message = await fetchTrackedMessage(channel, id);
      if (message?.author?.id === botId && isOverviewBlock(message)) byId.set(String(id), message);
    }
  }
  // Reuse the actual chronological order, including recovered untracked blocks.
  const existing = [...byId.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const nextIds = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const message = existing[index]
      ? await existing[index].edit(createListPayload(chunks[index]))
      : await channel.send(createListPayload(chunks[index]));
    nextIds.push(String(message.id));
  }
  for (const obsolete of existing.slice(chunks.length)) await obsolete.delete();
  return nextIds;
}

async function runRefresh(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const messages = readJson(FILES.messages, createMessagesDefault());
  const channelId = settings.channels.registeredTeamsChannelId || REGISTERED_TEAMS_CHANNEL_ID;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) {
    console.warn(`[team-overview] Registered teams channel ${channelId} wurde nicht gefunden oder ist nicht beschreibbar.`);
    return false;
  }

  const teams = uniqueSortedTeams(listVisibleTeams());
  const links = await resolveProfileLinks(client, channel.guild, teams);
  const chunks = chunkBlocks(buildTeamBlocks(teams, links));
  const tracked = messages.teams?.registeredTeamsOverview || {};

  const header = await syncHeaderMessage(channel, tracked.headerMessageId, teams);
  const nextIds = await syncListMessages(channel, tracked.listMessageIds, chunks, client.user.id);

  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.teams.registeredTeamsOverview.channelId = channel.id;
    current.teams.registeredTeamsOverview.headerMessageId = header.id;
    current.teams.registeredTeamsOverview.listMessageIds = nextIds;
    current.teams.registeredTeamsOverview.updatedAt = new Date().toISOString();
    if (!current.teams.registeredTeamsOverview.createdAt) {
      current.teams.registeredTeamsOverview.createdAt = new Date().toISOString();
    }
    return current;
  });

  console.info(`[team-overview] Übersicht synchronisiert: ${teams.length} eindeutige Teams in ${nextIds.length} Listenblock/-blöcken.`);
  return true;
}

function refreshRegisteredTeamsOverview(client) {
  const refresh = refreshQueue.then(() => runRefresh(client));
  refreshQueue = refresh.catch(() => {});
  return refresh;
}

module.exports = {
  messagesAreOutOfOrder,
  isOverviewBlock,
  syncListMessages,
  buildTeamBlocks,
  formatUser,
  refreshRegisteredTeamsOverview,
  uniqueSortedTeams,
};
