'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');

test('locked Halloween display sorts premium by registration without changing membership', () => {
  const original = Module._load;
  const premiumPath = require.resolve('../src/domain/premium/premium-store');
  delete require.cache[premiumPath];
  Module._load = function(request, parent, main) {
    if (request === '../../storage' && parent?.filename === premiumPath) return {
      DATA_DIR: '/tmp', readJson: () => ({ subscriptions: Object.fromEntries(['first', 'later', 'waiting'].map(id => [id, { startsAt: '2020-01-01', expiresAt: '2099-01-01' }])) }),
    };
    return original.call(this, request, parent, main);
  };
  let sortPremiumEntries;
  try { ({ sortPremiumEntries } = require(premiumPath)); }
  finally { Module._load = original; delete require.cache[premiumPath]; }
  const source = fs.readFileSync(require.resolve('../src/domain/checkins/bomber-x-loco-checkin'), 'utf8');
  const functions = source.slice(source.indexOf('function sortDisplayIds'), source.indexOf('function getWaitlistIds'));
  const context = { sortPremiumEntries, findTeamById: () => null, MAX_PARTICIPANTS: 60,
    getEntryTeamIds: e => e.checkin.entries.map(x => x.teamId), getWaitlistIds: e => e.checkin.waitlistTeamIds,
    getManualByeCount: () => 1, teamName: id => id, BOMBER_X_LOCO_FORMAT_SIZES: [], formatSeparator: () => '' };
  vm.createContext(context);
  vm.runInContext(functions, context);
  const event = { format: { lockedAt: '2026-10-30', size: 6 }, checkin: {
    entries: [ ['normal', 1], ['later', 3], ['first', 2], ['waiting', 4] ].map(([teamId, hour]) => ({ teamId, checkedInAt: `2026-10-29T0${hour}:00:00Z` })),
    activeTeamIds: ['normal', 'later', 'first'], waitlistTeamIds: ['waiting'],
  } };
  const before = JSON.stringify(event);
  const lines = context.formatTeams(event).split('\n');
  assert.deepEqual(lines.slice(0, 5), ['1. first', '2. later', '3. normal', '4. waiting (WL)', '5. Freilos']);
  assert.equal(JSON.stringify(event), before);
});
