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

    // Falls alte Daten doch einmal denselben Club doppelt enthalten, gewinnt
    // defensiv der zuletzt aktualisierte Datensatz. Es werden dabei keine
    // Teamdaten gelöscht, nur die öffentliche Übersicht wird eindeutig.
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
    allowedMentions: { parse: ['users'] },
  };
}

function looksLikeRegisteredTeamsOverviewMessage(message, clientUserId) {
  if (!message || String(message.author?.id || '') !== String(clientUserId || '')) return false;
  if (message.embeds?.some(embed => String(embed?.title || '').includes('REGISTRIERTE TEAMS'))) return true;
  const content = String(message.content || '');
  return content.includes('🔴 **') && content.includes('👑 **VM:**');
}

async function deleteOldOverviewMessages(channel, clientUserId) {
  let before;
  let deleted = 0;

  // Mehrere Seiten ablaufen, damit auch ältere liegengebliebene Listenblöcke
  // verschwinden. Es werden ausschließlich Nachrichten dieses Bots gelöscht,
  // die eindeutig wie die Teamübersicht aussehen.
  for (let page = 0; page < 10; page += 1) {
    const fetched = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!fetched?.size) break;

    for (const message of fetched.values()) {
      if (!looksLikeRegisteredTeamsOverviewMessage(message, clientUserId)) continue;
      if (await message.delete().then(() => true).catch(() => false)) deleted += 1;
    }

    const oldest = fetched.last();
    if (!oldest?.id || fetched.size < 100) break;
    before = oldest.id;
  }

  return deleted;
}

async function refreshRegisteredTeamsOverview(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels.registeredTeamsChannelId || REGISTERED_TEAMS_CHANNEL_ID;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) {
    console.warn(`[team-overview] Registered teams channel ${channelId} wurde nicht gefunden oder ist nicht beschreibbar.`);
    return false;
  }

  const teams = uniqueSortedTeams(listVisibleTeams());
  const chunks = chunkBlocks(buildTeamBlocks(teams));

  const deleted = await deleteOldOverviewMessages(channel, client.user?.id);
  const header = await channel.send({ embeds: [buildHeaderEmbed(teams)] });
  const nextIds = [];
  for (const chunk of chunks) {
    const created = await channel.send(createListPayload(chunk));
    nextIds.push(created.id);
  }

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

  console.info(`[team-overview] Übersicht sauber neu aufgebaut: ${teams.length} eindeutige Teams, ${deleted} alte Übersichts-Nachrichten entfernt.`);
  return true;
}

module.exports = {
  buildTeamBlocks,
  formatUser,
  refreshRegisteredTeamsOverview,
  uniqueSortedTeams,
};
