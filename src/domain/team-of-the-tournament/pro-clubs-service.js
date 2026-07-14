'use strict';

const config = require('./config');
const { EaProClubsProvider } = require('./providers/ea-pro-clubs-provider');

async function verifyClubConnection({ clubId, platform = config.platform, provider = new EaProClubsProvider() }) {
  const id = String(clubId || '').trim(); const targetPlatform = String(platform || config.platform).trim();
  if (!/^\d+$/.test(id)) throw new Error('Die Club-ID muss numerisch sein.');
  const matches = await provider.getRecentFriendlyMatches(id, targetPlatform, config.matchResultCount);
  const club = matches.flatMap(match => [match.home.club, match.away.club]).find(entry => String(entry.clubId) === id);
  if (!club) throw new Error('Die angegebene Club-ID kommt in der EA-Antwort nicht vor.');
  return { clubId: id, platform: targetPlatform, clubName: club.name, verified: true };
}

module.exports = { verifyClubConnection };
