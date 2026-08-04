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

function formatUser(userId, presentUserIds) {
  if (!userId) return MISSING_MEMBER_LABEL;
  return presentUserIds.has(String(userId)) ? `<@${userId}>` : MISSING_MEMBER_LABEL;
}

function formatCoManagers(team, presentUserIds) {
  const coManagers = Array.isArray(team.coManagers) ? team.coManagers : [];
  if (!coManagers.length) return 'Keine';
  return coManagers
    .map(coManager => formatUser(coManager?.userId, presentUserIds))
    .join(', ');
}

function buildTeamBlocks(teams, presentUserIds) {
  return teams
    .slice()
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }))
    .map((team, index) => [
      `🔴 **${formatTeamNumber(index)} | ${team.clubName}**`,
      `👑 **VM:** ${formatUser(team.manager?.userId, presentUserIds)}`,
      `🤝 **Co-VM:** ${formatCoManagers(team, presentUserIds)}`,
    ].join('\n'));
}

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function collectTeamUserIds(teams) {
  const userIds = new Set();
  for (const team of teams) {
    if (team.manager?.userId) userIds.add(String(team.manager.userId));
    for (const coManager of team.coManagers || []) {
      if (coManager?.userId) userIds.add(String(coManager.userId));
    }
  }
  return [...userIds];
}

async function getPresentUserIds(guild, teams) {
  const present = new Set();
  if (!guild?.members?.cache) return present;

  for (const userId of collectTeamUserIds(teams)) {
    const member = guild.members.cache.get(String(userId));
    if (member) present.add(String(userId));
  }

  return present;
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
  const presentUserIds = await getPresentUserIds(channel.guild, teams);
  const chunks = chunkBlocks(buildTeamBlocks(teams, presentUserIds));
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.teams.registeredTeamsOverview;

  let header = await fetchMessage(channel, state.headerMessageId);
  if (header) {
    await header.edit({ embeds: [buildHeaderEmbed(teams)] });
  } else {
    header = await channel.send({ embeds: [buildHeaderEmbed(teams)] });
    state.headerMessageId = header.id;
  }

  const oldIds = Array.isArray(state.listMessageIds) ? state.listMessageIds : [];
  const nextIds = [];

  for (let index = 0; index < chunks.length; index++) {
    const oldMessage = await fetchMessage(channel, oldIds[index]);
    const payload = {
      content: chunks[index],
      allowedMentions: { parse: ['users'] },
    };

    if (oldMessage) {
      await oldMessage.edit(payload);
      nextIds.push(oldMessage.id);
    } else {
      const created = await channel.send(payload);
      nextIds.push(created.id);
    }
  }

  for (let index = chunks.length; index < oldIds.length; index++) {
    const oldMessage = await fetchMessage(channel, oldIds[index]);
    if (oldMessage) await oldMessage.delete().catch(() => {});
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
  refreshRegisteredTeamsOverview,
};
