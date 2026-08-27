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

function seconds(ms) {
  return `${(Number(ms || 0) / 1000).toFixed(1).replace('.', ',')} s`;
}

function formatDiagnostic(event) {
  const club = event.clubId ? `Club-ID: **${event.clubId}**` : null;
  if (event.type === 'request_started') {
    return event.operation === 'friendly_matches' && event.attempt === 1
      ? `🟡 **EA-ABFRAGE GESTARTET**\n${club || 'EA Clubs'}\nMatchdaten werden abgefragt.`
      : null;
  }
  if (event.type === 'request_succeeded') {
    return `🟢 **EA ANTWORT ERHALTEN**\n${club || 'EA Clubs'}\nAntwortzeit: **${seconds(event.durationMs)}**\nVersuch: **${event.attempt}**`;
  }
  if (event.type === 'request_timeout') {
    return `🔴 **EA TIMEOUT**\n${club || 'EA Clubs'}\nVersuch: **${event.attempt}/3**\n${event.error || 'EA hat nicht rechtzeitig geantwortet.'}`;
  }
  if (event.type === 'request_failed') {
    return `🔴 **EA FEHLER**\n${club || 'EA Clubs'}\nVersuch: **${event.attempt}/3**\n${event.error || 'Unbekannter EA-Fehler'}`;
  }
  if (event.type === 'cache_hit') {
    return `⚡ **EA-CACHE VERWENDET**\n${club}\nMatches im Cache: **${event.matchCount || 0}**\nAlter: **${seconds(event.ageMs)}**`;
  }
  if (event.type === 'cache_store') {
    return `📥 **EA-DATEN GESPEICHERT**\n${club}\nMatches erhalten: **${event.matchCount || 0}**`;
  }
  return null;
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
  setEaDiagnostics(event => sendTracker(formatDiagnostic(event)));
  const channel = await getTrackerChannel();
  if (!channel?.send) {
    console.warn('[tott-tracker] Diagnosekanal konnte nicht geladen werden.');
    return false;
  }
  await sendTracker('📡 **TOTT TRACKER ONLINE**\nEA-Diagnose ist aktiv. Timeouts, Antworten und Cache-Treffer werden hier protokolliert.');
  console.info(`[tott-tracker] Diagnose aktiv in ${channel.id}.`);
  return true;
}

module.exports = { initTottTracker, sendTracker };
