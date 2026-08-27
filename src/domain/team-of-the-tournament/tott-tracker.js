'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { setEaDiagnostics } = require('./ea-clubs-client');

const FALLBACK_CHANNEL_ID = '1542489791600529408';
let trackerClient = null;
let trackerChannel = null;

async function getTrackerChannel() {
  if (trackerChannel?.send) return trackerChannel;
  if (!trackerClient) return null;
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels?.teamOfTheTournamentTrackerChannelId || FALLBACK_CHANNEL_ID;
  trackerChannel = await trackerClient.channels.fetch(channelId).catch(() => null);
  return trackerChannel;
}

async function sendTracker(content) {
  if (!content) return false;
  const channel = await getTrackerChannel();
  if (!channel?.send) return false;
  await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
  return true;
}

async function initTottTracker(client) {
  trackerClient = client;
  trackerChannel = null;

  // Keine Low-Level-Request-Meldungen mehr. Der Tracker wird nur noch
  // vom TOTT-Service pro Night-Cup-Begegnung beschrieben.
  setEaDiagnostics(null);

  const channel = await getTrackerChannel();
  if (!channel?.send) {
    console.warn('[tott-tracker] Diagnosekanal konnte nicht geladen werden.');
    return false;
  }

  console.info(`[tott-tracker] Match-Diagnose aktiv in ${channel.id}.`);
  return true;
}

module.exports = { initTottTracker, sendTracker };
