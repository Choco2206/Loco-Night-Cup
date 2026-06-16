'use strict';

const { EmbedBuilder } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('./team-service');

function chunkBlocks(blocks, maxLength = 1900) {
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
    .setTitle('Registrierte Teams')
    .setDescription(`Aktuell sichtbar: **${teams.length} Teams**`)
    .setColor(0xff0000);
}

function buildTeamBlocks(teams) {
  return teams
    .slice()
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }))
    .map((team, index) => {
      const manager = team.manager?.userId ? `<@${team.manager.userId}>` : 'Kein VM';
      const coManagers = team.coManagers.length
        ? team.coManagers.map(co => `<@${co.userId}>`).join(', ')
        : 'Keine';
      const flags = [];
      if (team.status === 'leaderless') flags.push('führungslos');
      if (team.registrationStatus === 'incomplete') flags.push('unvollständig');
      const suffix = flags.length ? ` (${flags.join(', ')})` : '';

      return [
        `**${index + 1}. ${team.clubName}${suffix}**`,
        `VM: ${manager}`,
        `Co-VMs: ${coManagers}`,
      ].join('\n');
    });
}

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function refreshRegisteredTeamsOverview(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels.registeredTeamsChannelId;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;

  const teams = listVisibleTeams();
  const chunks = chunkBlocks(buildTeamBlocks(teams));
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
