'use strict';

const { EmbedBuilder } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('./team-service');

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

function formatUser(userId) {
  if (!userId) return MISSING_MEMBER_LABEL;
  return `<@${userId}>`;
}

function formatCoManagers(team) {
  const coManagers = Array.isArray(team.coManagers) ? team.coManagers : [];
  if (!coManagers.length) return 'Keine';

  const uniqueUserIds = [...new Set(coManagers.map(coManager => String(coManager?.userId || '')).filter(Boolean))];
  if (!uniqueUserIds.length) return 'Keine';
  return uniqueUserIds.map(formatUser).join(', ');
}

function buildTeamBlocks(teams) {
  return uniqueSortedTeams(teams).map((team, index) => [
    `🔴 **${formatTeamNumber(index)} | ${team.clubName}**`,
    `👑 **VM:** ${formatUser(team.manager?.userId)}`,
    `🤝 **Co-VM:** ${formatCoManagers(team)}`,
  ].join('\n'));
}

function createListPayload(content) {
  return {
    content,
    embeds: [],
    allowedMentions: { parse: ['users'] },
  };
}

async function fetchTrackedMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(String(messageId)).catch(() => null);
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

async function syncListMessages(channel, trackedIds, chunks) {
  const ids = Array.isArray(trackedIds) ? trackedIds.map(String) : [];
  const nextIds = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const existing = await fetchTrackedMessage(channel, ids[index]);
    if (existing) {
      await existing.edit(createListPayload(chunks[index]));
      nextIds.push(String(existing.id));
    } else {
      const created = await channel.send(createListPayload(chunks[index]));
      nextIds.push(String(created.id));
    }
  }

  // Wenn durch gelöschte Teams weniger Blöcke benötigt werden, nur die
  // überzähligen bisher getrackten Listen-Nachrichten entfernen.
  for (let index = chunks.length; index < ids.length; index += 1) {
    const obsolete = await fetchTrackedMessage(channel, ids[index]);
    if (obsolete) await obsolete.delete().catch(() => null);
  }

  return nextIds;
}

async function refreshRegisteredTeamsOverview(client) {
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
  const chunks = chunkBlocks(buildTeamBlocks(teams));
  const tracked = messages.teams?.registeredTeamsOverview || {};

  const header = await syncHeaderMessage(channel, tracked.headerMessageId, teams);
  const nextIds = await syncListMessages(channel, tracked.listMessageIds, chunks);

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

module.exports = {
  buildTeamBlocks,
  formatUser,
  refreshRegisteredTeamsOverview,
  uniqueSortedTeams,
};
