'use strict';

const { FILES, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { HALLOWEEN_CHECKIN_CHANNEL_ID, HALLOWEEN_EVENT_KEY } = require('../events/bomber-x-loco-config');

function isHalloweenChannel(channel) {
  const name = String(channel?.name || '').normalize('NFKC').toLowerCase();
  return channel?.send && ['bomber', 'halloween', 'cup'].every(part => name.includes(part))
    && (name.includes('loco') || name.includes('loko'));
}

async function resolveHalloweenChannel(client, settings) {
  const storedId = HALLOWEEN_CHECKIN_CHANNEL_ID || settings.channels?.checkinChannelIds?.[HALLOWEEN_EVENT_KEY];
  if (storedId) {
    const stored = await client.channels.fetch(storedId).catch(() => null);
    return stored?.send ? stored : null;
  }
  const guildId = settings.guild?.guildId;
  const guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : null;
  if (!guild) return null;
  const channels = await guild.channels.fetch().catch(() => null);
  const matches = channels ? [...channels.values()].filter(isHalloweenChannel) : [];
  if (matches.length !== 1) {
    console.warn(`[halloween-checkin] ${matches.length} matching channels; cannot choose safely`);
    return null;
  }
  const channel = matches[0];
  updateJson(FILES.settings, createSettingsDefault(), current => {
    current.channels = current.channels || {};
    current.channels.checkinChannelIds = current.channels.checkinChannelIds || {};
    current.channels.checkinChannelIds[HALLOWEEN_EVENT_KEY] = String(channel.id);
    return current;
  });
  return channel;
}

module.exports = { isHalloweenChannel, resolveHalloweenChannel };
