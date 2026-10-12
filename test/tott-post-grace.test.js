'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/domain/team-of-the-tournament/team-of-the-tournament-post.js'), 'utf8');
const scheduler = source.slice(source.indexOf('function scheduleTeamOfTheTournamentPost('), source.indexOf('async function initTeamOfTheTournament('));
function harness(missing, players = 11) {
  let now = 1000000; let posted = 0; let checks = 0;
  const timers = [];
  class Clock extends Date { constructor(value) { super(value === undefined ? now : value); } static now() { return now; } }
  const context = {
    Date: Clock, console: { info() {}, warn() {} }, postTimers: new Map(),
    TOTT_GRACE_PERIOD_MS: 300000, TOTT_EXTENDED_GRACE_PERIOD_MS: 600000,
    TOTT_GIVE_UP_AFTER_MS: 7200000, POST_RETRY_DELAYS_MS: [120000], CONTINUOUS_RETRY_DELAY_MS: 900000,
    readEventData: () => ({ ceremony: {} }), updatePostState() {},
    capturePendingMatchesNow: async () => { checks++; },
    workflowSnapshot: () => ({ selectedPlayers: players, capturedMatches: missing ? 4 : 8, linkedMatches: 8 }),
    resumeRatingCaptures: () => 0,
    postTeamOfTheTournament: async () => { posted++; return { posted: true }; },
    setTimeout: (fn, delay) => { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
  };
  vm.runInNewContext(scheduler + '\nthis.schedule = scheduleTeamOfTheTournamentPost;', context);
  context.schedule({ client: {}, eventKey: 'test' });
  return { timers, get posted() { return posted; }, get checks() { return checks; },
    async advance() { const timer = timers.shift(); now += timer.delay; await timer.fn(); } };
}
test('posts complete TOTT data after five minutes', async () => {
  const h = harness(false);
  assert.equal(h.timers[0].delay, 300000);
  await h.advance();
  assert.equal(h.posted, 1);
  assert.equal(h.checks, 1);
});
test('checks incomplete data again at ten minutes before posting the available eleven', async () => {
  const h = harness(true);
  await h.advance();
  assert.equal(h.posted, 0);
  assert.equal(h.timers[0].delay, 300000);
  await h.advance();
  assert.equal(h.posted, 1);
  assert.equal(h.checks, 2);
});
test('does not post fewer than eleven eligible players at ten minutes', async () => {
  const h = harness(true, 10);
  await h.advance(); await h.advance();
  assert.equal(h.posted, 0);
  assert.equal(h.timers.length, 1);
});
