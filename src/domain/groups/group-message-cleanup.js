'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { readEventData } = require('../events/event-repository');

const USER_MESSAGE_DELETE_DELAY_MS = 15 * 60 * 1000;

function activeGroupChannelIds() {
  const channelIds = new Set();

  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (event.leaguePhase?.phaseType === 'league' && event.leaguePhase.status !== 'completed' && event.leaguePhase.resultsChannelId) channelIds.add(String(event.leaguePhase.resultsChannelId));
    if (!event.groups?.groups || event.groups.status === 'completed') continue;
    for (const group of Object.values(event.groups.groups)) {
      if (group.resultsChannelId) channelIds.add(String(group.resultsChannelId));
    }
  }

  return channelIds;
}

async function handleGroupMessage(message) {
  if (!message?.channelId || message.author?.bot) return false;
  if (!activeGroupChannelIds().has(String(message.channelId))) return false;

  setTimeout(() => {
    message.delete().catch(error => {
      if (error?.code !== 10008) {
        console.error('Gruppenkanal-Usernachricht konnte nicht gelöscht werden:', error);
      }
    });
  }, USER_MESSAGE_DELETE_DELAY_MS);

  return false;
}

async function deleteUserMessagesFromGroupChannel(client, group, limit = 500) {
  const channelId = group?.phaseType === 'league' ? group.resultsChannelId : group?.resultsChannelId;
  if (!client || !channelId) return { deleted: 0, scanned: 0 };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return { deleted: 0, scanned: 0 };

  let before;
  let deleted = 0;
  let scanned = 0;

  while (scanned < limit) {
    const remaining = Math.min(100, limit - scanned);
    const messages = await channel.messages.fetch({ limit: remaining, before }).catch(error => {
      console.error(`Gruppe ${group.groupKey}: Usernachrichten konnten nicht geladen werden:`, error);
      return null;
    });
    if (!messages?.size) break;

    for (const message of messages.values()) {
      scanned += 1;
      before = message.id;
      if (message.author?.bot) continue;
      await message.delete().then(() => {
        deleted += 1;
      }).catch(error => {
        if (error?.code !== 10008) {
          console.error(`Gruppe ${group.groupKey}: Usernachricht konnte nicht gelöscht werden:`, error);
        }
      });
    }

    if (messages.size < remaining) break;
  }

  return { deleted, scanned };
}

async function deleteTransientMessagesFromChannel(client, channelId, keepMessageIds, label, limit = 500) {
  if (!client || !channelId) return { deleted: 0, scanned: 0 };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return { deleted: 0, scanned: 0 };
  const keepIds = new Set((keepMessageIds || []).filter(Boolean).map(String));
  let before;
  let deleted = 0;
  let scanned = 0;
  while (scanned < limit) {
    const remaining = Math.min(100, limit - scanned);
    const messages = await channel.messages.fetch({ limit: remaining, before }).catch(error => {
      console.error(`${label}: Kanalbereinigung konnte Nachrichten nicht laden:`, error);
      return null;
    });
    if (!messages?.size) break;
    for (const message of messages.values()) {
      scanned += 1;
      before = message.id;
      if (keepIds.has(String(message.id))) continue;
      await message.delete().then(() => { deleted += 1; }).catch(error => {
        if (error?.code !== 10008) console.error(`${label}: Nachricht konnte nicht bereinigt werden:`, error);
      });
    }
    if (messages.size < remaining) break;
  }
  return { deleted, scanned };
}

async function deleteTransientMessagesFromGroupChannel(client, group, limit = 500) {
  if (group?.phaseType === 'league') {
    return deleteTransientMessagesFromChannel(client, group.resultsChannelId, [
      group.messages?.resultsTableMessageId,
      group.messages?.resultsScheduleMessageId,
    ], 'Ligaphase-Ergebnisse', limit);
  }

  const overview = await deleteTransientMessagesFromChannel(client, group?.channelId, [
    group?.teamsMessageId,
    group?.tableMessageId,
    group?.scheduleMessageId,
  ], `Gruppe ${group?.groupKey}`, limit);
  const results = await deleteTransientMessagesFromChannel(client, group?.resultsChannelId, [
    group?.resultsTableMessageId,
    group?.resultsScheduleMessageId,
  ], `Ergebnisse Gruppe ${group?.groupKey}`, limit);
  return {
    deleted: overview.deleted + results.deleted,
    scanned: overview.scanned + results.scanned,
    overview,
    results,
  };
}

async function deleteTransientMessagesFromLeagueOverview(client, phase, limit = 500) {
  const channelId = phase?.overviewChannelId;
  if (!client || !channelId) return { deleted: 0, scanned: 0 };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return { deleted: 0, scanned: 0 };
  const keepIds = new Set([
    phase.messages?.overviewTableMessageId,
    phase.messages?.overviewScheduleMessageId,
  ].filter(Boolean).map(String));
  let before;
  let deleted = 0;
  let scanned = 0;
  while (scanned < limit) {
    const remaining = Math.min(100, limit - scanned);
    const messages = await channel.messages.fetch({ limit: remaining, before }).catch(error => {
      console.error('Ligaphase: Kanalbereinigung konnte Nachrichten nicht laden:', error);
      return null;
    });
    if (!messages?.size) break;
    for (const message of messages.values()) {
      scanned += 1;
      before = message.id;
      if (keepIds.has(String(message.id))) continue;
      await message.delete().then(() => { deleted += 1; }).catch(error => {
        if (error?.code !== 10008) console.error('Ligaphase: Nachricht konnte nicht bereinigt werden:', error);
      });
    }
    if (messages.size < remaining) break;
  }
  return { deleted, scanned };
}

module.exports = {
  deleteTransientMessagesFromLeagueOverview,
  deleteTransientMessagesFromGroupChannel,
  deleteUserMessagesFromGroupChannel,
  handleGroupMessage,
};
