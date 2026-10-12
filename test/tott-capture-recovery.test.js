const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const teams = [
  { id: 'a', clubName: 'A', eaClub: { clubId: '101' } },
  { id: 'b', clubName: 'B', eaClub: { clubId: '102' } },
];
const lnc = { id: 'lnc', status: 'confirmed', home: { type: 'team', teamId: 'a' }, away: { type: 'team', teamId: 'b' }, result: { homeGoals: 2, awayGoals: 1, confirmedAt: '2026-10-11T23:30:00Z' } };
const player = name => ({ playername: name, pos: 'forward', rating: '8', goals: '1' });
const ea = { matchId: 'ea', timestamp: '2026-10-11T23:28:00Z', clubs: { 101: { goals: '2' }, 102: { goals: '1' } }, players: { 101: { p1: player('One') } } };
let event = {};
let failFirst = false;
let complete = false;
const calls = [];
const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout,
  require: path => {
    if (path.includes('event-repository')) return { readEventData: () => event, updateEventData: (_, fn) => { event = fn(event); } };
    if (path.includes('team-service')) return { findTeamById: id => teams.find(t => t.id === id) };
    if (path.includes('ea-clubs-client')) return { getFriendlyMatches: async (id, platform, count, options) => {
      calls.push({ id, options });
      if (failFirst && id === '101') throw new Error('HTTP 503');
      return [{ ...ea, players: complete ? { ...ea.players, 102: { p2: player('Two') } } : ea.players }];
    } };
    return { sendTracker: async () => {} };
  },
};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../src/domain/team-of-the-tournament/team-of-the-tournament-service.js'), 'utf8') + '\nmodule.exports._captureOnce = captureOnce;', sandbox);
const service = sandbox.module.exports;
require('node:test')('recovers partial EA captures without duplicate player points despite a failed club request', async () => {
  let result = await service._captureOnce('test', lnc);
  assert.equal(result.reason, 'partial_player_data');
  assert.equal(service.hasCompleteCapture(event, lnc), false);
  assert.equal(event.ceremony.teamOfTheTournament.performances.length, 1);
  complete = true; failFirst = true;
  result = await service._captureOnce('test', lnc);
  assert.equal(result.captured, true);
  assert.equal(service.hasCompleteCapture(event, lnc), true);
  assert.equal(event.ceremony.teamOfTheTournament.performances.length, 2);
  assert.equal(event.ceremony.teamOfTheTournament.capturedMatches.length, 1);
  await service._captureOnce('test', lnc);
  assert.equal(event.ceremony.teamOfTheTournament.performances.length, 2);
  assert.ok(calls.every(call => call.options.fresh));
  assert.equal(service.selectEaMatch([ea], lnc, teams, new Set(['ea'])).match, null);
  assert.equal(service.selectEaMatch([ea], lnc, teams).match.matchId, 'ea');
  console.log('PASS: partial capture, recovery through opponent after HTTP error, no duplicates, fresh requests, used-match exclusion.');
});
