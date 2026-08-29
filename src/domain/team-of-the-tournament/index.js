'use strict';

// Gemeinsamer Einstiegspunkt für EA-Club-Verknüpfung und TOTT-Auswertung.

const { FILES, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const eaClient = require('./ea-clubs-client');
const service = require('./team-of-the-tournament-service');
const post = require('./team-of-the-tournament-post');
const tracker = require('./tott-tracker');

const LIVE_TOTT_CHANNEL_ID = '1533394601220505641';

function ensureLiveTottChannelSetting() {
  let previous = null;
  updateJson(FILES.settings, createSettingsDefault(), settings => {
    settings.channels = settings.channels || {};
    previous = settings.channels.teamOfTheTournamentChannelId || null;
    settings.channels.teamOfTheTournamentChannelId = LIVE_TOTT_CHANNEL_ID;
    return settings;
  });

  if (previous && String(previous) !== LIVE_TOTT_CHANNEL_ID) {
    console.warn(`[tott-channel] Falsche persistente Live-Kanal-ID korrigiert: ${previous} -> ${LIVE_TOTT_CHANNEL_ID}`);
  } else {
    console.info(`[tott-channel] Live-Kanal-ID bestätigt: ${LIVE_TOTT_CHANNEL_ID}`);
  }
}

async function initTeamOfTheTournament(client) {
  ensureLiveTottChannelSetting();
  return post.initTeamOfTheTournament(client);
}

async function testLiveTottChannel(client) {
  ensureLiveTottChannelSetting();
  return post.testLiveTottChannel(client);
}

module.exports = {
  ...eaClient,
  ...service,
  ...post,
  ...tracker,
  ensureLiveTottChannelSetting,
  initTeamOfTheTournament,
  testLiveTottChannel,
};
