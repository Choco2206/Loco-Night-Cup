'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('./team-service');

const STREAM_LIST_CHANNEL_ID = '1527123946905010307';
const DISCORD_MESSAGE_LIMIT = 2000;
const HEADER = '# 📺 Team-Streams\n\nHier findet ihr die Streamlinks der teilnehmenden Teams.';
let refreshQueue = Promise.resolve();

function buildEntry(team) {
  return `**${team.clubName}**\n${team.twitchUrls.join('\n')}`;
}

function buildStreamListPages(teams = listVisibleTeams()) {
  const entries = teams
    .filter(team => Array.isArray(team.twitchUrls) && team.twitchUrls.length)
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }))
    .map(buildEntry);
  const pages = [];
  let current = HEADER;
  for (const entry of entries) {
    const next = `${current}\n\n${entry}`;
    if (next.length <= DISCORD_MESSAGE_LIMIT) {
      current = next;
      continue;
    }
    pages.push(current);
    if (entry.length > DISCORD_MESSAGE_LIMIT) throw new Error('Ein Streamlisten-Eintrag überschreitet das Discord-Zeichenlimit.');
    current = entry;
  }
  pages.push(current);
  return pages;
}

function getState(messages) {
  messages.teams = messages.teams || {};
  messages.teams.streamList = messages.teams.streamList || {
    channelId: STREAM_LIST_CHANNEL_ID, messageIds: [], createdAt: null, updatedAt: null,
  };
  return messages.teams.streamList;
}

async function runRefresh(client) {
  const channel = await client.channels.fetch(STREAM_LIST_CHANNEL_ID).catch(() => null);
  if (!channel?.send || !channel.messages?.fetch) throw new Error('Der Streamlisten-Kanal wurde nicht gefunden.');
  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = getState(messages);
  const tracked = [];
  for (const id of state.messageIds || []) tracked.push(await channel.messages.fetch(id).catch(() => null));
  const pages = buildStreamListPages();
  const nextIds = [];
  for (let index = 0; index < pages.length; index += 1) {
    const payload = { content: pages[index], allowedMentions: { parse: [] } };
    const message = tracked[index] ? await tracked[index].edit(payload) : await channel.send(payload);
    nextIds.push(message.id);
  }
  for (const stale of tracked.slice(pages.length)) if (stale) await stale.delete().catch(() => {});
  const now = new Date().toISOString();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    const currentState = getState(current);
    currentState.channelId = STREAM_LIST_CHANNEL_ID;
    currentState.messageIds = nextIds;
    currentState.updatedAt = now;
    if (!currentState.createdAt) currentState.createdAt = now;
    return current;
  });
  return { teamCount: listVisibleTeams().filter(team => team.twitchUrls?.length).length, messageCount: nextIds.length };
}

function refreshTeamStreamList(client) {
  const refresh = refreshQueue.then(() => runRefresh(client));
  refreshQueue = refresh.catch(() => {});
  return refresh;
}

module.exports = { HEADER, STREAM_LIST_CHANNEL_ID, buildStreamListPages, refreshTeamStreamList };
