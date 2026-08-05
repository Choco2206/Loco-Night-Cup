'use strict';

const { EmbedBuilder } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('./team-service');

const TEAM_LIST_CHUNK_LIMIT = 1850;
const MISSING_MEMBER_LABEL = '⚠️ Nicht mehr auf dem Server';

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
  return coManagers
    .map(coManager => formatUser(coManager?.userId))
    .join(', ');
}

function buildTeamBlocks(teams) {
  return teams
    .slice()
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }))
    .map((team, index) => [
      `🔴 **${formatTeamNumber(index)} | ${team.clubName}**`,
      `👑 **VM:** ${formatUser(team.manager?.userId)}`,
      `🤝 **Co-VM:** ${formatCoManagers(team)}`,
    ].join('\n'));
}

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function messagesAreOutOfOrder(messages) {
  const timestamps = messages.map(message => Number(message?.createdTimestamp));
  if (timestamps.some(timestamp => !Number.isFinite(timestamp) || timestamp <= 0)) return false;
  return timestamps.some((timestamp, index) => index > 0 && timestamp < timestamps[index - 1]);
}

function createListPayload(content) {
  return {
    content,
    allowedMentions: { parse: ['users'] },
  };
}

async function recreateOverview(channel, header, oldMessages, teams, chunks) {
  for (const message of [header, ...oldMessages]) {
    if (message) await message.delete().catch(() => {});
  }

  const nextHeader = await channel.send({ embeds: [buildHeaderEmbed(teams)] });
  const nextIds = [];
  for (const chunk of chunks) {
    const created = await channel.send(createListPayload(chunk));
    nextIds.push(created.id);
  }
  return { header: nextHeader, nextIds };
}

async function refreshRegisteredTeamsOverview(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels.registeredTeamsChannelId;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) {
    console.warn(`[team-overview] Registered teams channel ${channelId} wurde nicht gefunden oder ist nicht beschreibbar.`);
    return false;
  }

  const teams = listVisibleTeams();
  const chunks = chunkBlocks(buildTeamBlocks(teams));
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.teams.registeredTeamsOverview;
  const oldIds = Array.isArray(state.listMessageIds) ? state.listMessageIds : [];

  let header = await fetchMessage(channel, state.headerMessageId);
  const oldMessages = await Promise.all(oldIds.map(messageId => fetchMessage(channel, messageId)));
  const trackedMessageMissing = Boolean(state.headerMessageId && !header)
    || Boolean(!state.headerMessageId && oldIds.length)
    || oldMessages.some(message => !message);
  const trackedMessages = [header, ...oldMessages].filter(Boolean);
  const wrongOrder = messagesAreOutOfOrder(trackedMessages);

  let nextIds = [];
  if (trackedMessageMissing || wrongOrder) {
    ({ header, nextIds } = await recreateOverview(channel, header, oldMessages, teams, chunks));
    console.info(`[team-overview] Übersicht geordnet neu aufgebaut (${trackedMessageMissing ? 'Nachricht fehlte' : 'Reihenfolge war falsch'}).`);
  } else {
    if (header) {
      await header.edit({ embeds: [buildHeaderEmbed(teams)] });
    } else {
      header = await channel.send({ embeds: [buildHeaderEmbed(teams)] });
    }

    for (let index = 0; index < chunks.length; index++) {
      const oldMessage = oldMessages[index];
      const payload = createListPayload(chunks[index]);
      if (oldMessage) {
        await oldMessage.edit(payload);
        nextIds.push(oldMessage.id);
      } else {
        const created = await channel.send(payload);
        nextIds.push(created.id);
      }
    }

    for (let index = chunks.length; index < oldMessages.length; index++) {
      const oldMessage = oldMessages[index];
      if (oldMessage) await oldMessage.delete().catch(() => {});
    }
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

  return true;
}

module.exports = {
  buildTeamBlocks,
  formatUser,
  messagesAreOutOfOrder,
  refreshRegisteredTeamsOverview,
};
