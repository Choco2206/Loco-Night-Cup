'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { readEventData } = require('../events/event-repository');

const USER_MESSAGE_DELETE_DELAY_MS = 15 * 60 * 1000;

function activeGroupChannelIds() {
  const channelIds = new Set();

  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
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

module.exports = {
  handleGroupMessage,
};
