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
  // Diagnostics include candidate identities and can exceed Discord's limit.
  const chunks = [];
  let remaining = String(content);
  while (remaining.length > 1900) {
    const boundary = remaining.lastIndexOf('\n', 1900);
    const end = boundary > 0 ? boundary : 1900;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).replace(/^\n/, '');
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) {
    try { await channel.send({ content: chunk, allowedMentions: { parse: [] } }); }
    catch (error) {
      console.warn(`[tott-tracker] Nachricht konnte nicht gesendet werden: ${error.message}`);
      return false;
    }
  }
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
