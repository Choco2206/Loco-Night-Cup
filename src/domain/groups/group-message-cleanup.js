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
      if (group.channelId) channelIds.add(String(group.channelId));
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
        console.error('Gruppenkanal-Usernachricht konnte nicht geloescht werden:', error);
      }
    });
  }, USER_MESSAGE_DELETE_DELAY_MS);

  return false;
}

async function deleteUserMessagesFromGroupChannel(client, group, limit = 500) {
  const channelId = group?.phaseType === 'league' ? group.resultsChannelId : group?.channelId;
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
          console.error(`Gruppe ${group.groupKey}: Usernachricht konnte nicht geloescht werden:`, error);
        }
      });
    }

    if (messages.size < remaining) break;
  }

  return { deleted, scanned };
}

async function deleteTransientMessagesFromGroupChannel(client, group, limit = 500) {
  const channelId = group?.phaseType === 'league' ? group.resultsChannelId : group?.channelId;
  if (!client || !channelId) return { deleted: 0, scanned: 0 };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return { deleted: 0, scanned: 0 };
  const keepIds = new Set((group?.phaseType === 'league'
    ? [group.messages?.resultsTableMessageId, group.messages?.resultsScheduleMessageId]
    : [group.tableMessageId, group.scheduleMessageId]
  ).filter(Boolean).map(String));
  let before;
  let deleted = 0;
  let scanned = 0;
  while (scanned < limit) {
    const remaining = Math.min(100, limit - scanned);
    const messages = await channel.messages.fetch({ limit: remaining, before }).catch(error => {
      console.error(`Gruppe ${group.groupKey}: Kanalbereinigung konnte Nachrichten nicht laden:`, error);
      return null;
    });
    if (!messages?.size) break;
    for (const message of messages.values()) {
      scanned += 1;
      before = message.id;
      if (keepIds.has(String(message.id))) continue;
      await message.delete().then(() => { deleted += 1; }).catch(error => {
        if (error?.code !== 10008) console.error(`Gruppe ${group.groupKey}: Nachricht konnte nicht bereinigt werden:`, error);
      });
    }
    if (messages.size < remaining) break;
  }
  return { deleted, scanned };
}

module.exports = {
  deleteTransientMessagesFromGroupChannel,
  deleteUserMessagesFromGroupChannel,
  handleGroupMessage,
};
