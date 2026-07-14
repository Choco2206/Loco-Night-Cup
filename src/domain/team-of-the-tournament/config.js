'use strict';

const path = require('path');
const { ROOT_DIR } = require('../../storage');

function integer(name, fallback, min = 1) {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

const POSITION_GROUPS = {
  goalkeeper: { slots: ['TW'], positions: ['GOALKEEPER'], amount: 1 },
  defender: { slots: ['ZIV', 'LIV', 'RIV'], positions: ['DEFENDER'], amount: 3 },
  midfielder: { slots: ['ZOM', 'LZDM', 'RZDM', 'LM', 'RM'], positions: ['MIDFIELDER'], amount: 5 },
  forward: { slots: ['LS', 'RS'], positions: ['FORWARD'], amount: 2 },
};

module.exports = Object.freeze({
  provider: process.env.PRO_CLUBS_API_PROVIDER || 'ea-direct',
  baseUrl: process.env.PRO_CLUBS_API_BASE_URL || 'https://proclubs.ea.com/api/fc',
  platform: process.env.PRO_CLUBS_PLATFORM || 'common-gen5',
  timeoutMs: integer('PRO_CLUBS_API_TIMEOUT_MS', 10000, 1000),
  matchResultCount: integer('PRO_CLUBS_MATCH_RESULT_COUNT', 10),
  channelId: process.env.TEAM_OF_THE_TOURNAMENT_CHANNEL_ID || '1526529020626341958',
  minMatches: integer('TOTT_MIN_MATCHES', 2),
  maxAttempts: integer('TOTT_MAX_LOOKUP_ATTEMPTS', 3),
  allowPartialPublish: String(process.env.TOTT_ALLOW_PARTIAL_PUBLISH || 'true').toLowerCase() !== 'false',
  templatePath: path.join(ROOT_DIR, 'assets', 'team-of-the-tournament', 'team-of-the-tournament-352.png'),
  positionGroups: POSITION_GROUPS,
  groupOrder: Object.keys(POSITION_GROUPS),
});
