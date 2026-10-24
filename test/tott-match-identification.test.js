'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/domain/team-of-the-tournament/team-of-the-tournament-service.js'), 'utf8');
function setup(linkedSide = 'both') {
  let event = {};
  const teams = [{ id: 'a', clubName: 'A', eaClub: { clubId: '101' } },
    { id: 'b', clubName: 'B', eaClub: { clubId: '102' } }];
  if (linkedSide === 'home') delete teams[1].eaClub;
  if (linkedSide === 'away') delete teams[0].eaClub;
  let responses = {};
  const calls = [];
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout,
    require: name => {
      if (name.includes('event-repository')) return {
        readEventData: () => event,
        updateEventData: (_, fn) => { event = fn(event); },
      };
      if (name.includes('team-service')) return { findTeamById: id => teams.find(t => t.id === id) };
      if (name.includes('ea-clubs-client')) return { getFriendlyMatches: async id => {
        calls.push(id);
        if (responses[id] instanceof Error) throw responses[id];
        return responses[id] || [];
      } };
      return { sendTracker: async () => {} };
    },
  };
  vm.runInNewContext(source + '\nmodule.exports.captureOnceForTest = captureOnce;', sandbox);
  const lnc = { id: 'fixture', status: 'confirmed',
    home: { type: 'team', teamId: 'a' }, away: { type: 'team', teamId: 'b' },
    result: { homeGoals: 1, awayGoals: 5, confirmedAt: '2026-10-15T22:00:00Z' } };
  return { api: sandbox.module.exports, teams, lnc, calls,
    respond: value => { responses = value; }, get event() { return event; } };
}
const player = name => ({ playername: name, rating: '8', pos: 'forward', goals: '1' });
function match(id = 'ea-1', homeGoals = '1', awayGoals = '5') {
  return { matchId: id, timestamp: '2026-10-15T21:58:00Z',
    clubs: { 101: { goals: homeGoals }, 102: { goals: awayGoals } },
    players: { 101: { p1: player('One') }, 102: { p2: player('Two') } } };
}
test('duplicate club responses do not block an otherwise unique score fallback', () => {
  const h = setup(); const m = match('ea-1', '0', '0');
  const result = h.api.selectEaMatch([m, m], h.lnc, h.teams);
  assert.equal(result.match.matchId, 'ea-1');
  assert.equal(result.fallback, true);
});
test('two distinct score-mismatching games remain ambiguous', () => {
  const h = setup();
  const result = h.api.selectEaMatch([match('one', '0', '0'), match('two', '0', '0')], h.lnc, h.teams);
  assert.equal(result.match, null);
});
for (const side of ['home', 'away']) test('one linked ' + side + ' club captures both teams without changing connections', async () => {
  const h = setup(side); const m = match();
  h.respond({ 101: [m], 102: [m] });
  const result = await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(result.captured, true);
  const state = h.event.ceremony.teamOfTheTournament;
  assert.equal(state.performances.length, 2);
  assert.equal(new Set(state.performances.map(row => row.teamId)).size, 2);
  assert.equal(h.teams.filter(t => t.eaClub).length, 1);
  assert.equal(h.api.hasCompleteCapture(h.event, h.lnc), true);
  await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(state.performances.length, 2);
});
test('nested club identities and complementary players are resolved through both responses', async () => {
  const h = setup();
  const m = { matchId: 'nested', timestamp: '2026-10-15T21:58:00Z',
    clubs: { home: { details: { clubId: '101' }, goals: '1' },
      away: { details: { clubId: '102' }, goals: '5' } },
    players: { home: { p1: player('One') } } };
  const other = { ...m, players: { away: { p2: player('Two') } } };
  h.respond({ 101: [m], 102: [other] });
  const result = await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(result.captured, true);
  assert.equal(result.rows.length, 2);
});
test('missing opponent values stay pending and can be backfilled without duplicate points', async () => {
  const h = setup('home'); const m = match(); delete m.players[102];
  h.respond({ 101: [m] });
  let result = await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(result.reason, 'partial_player_data');
  assert.equal(h.api.hasCompleteCapture(h.event, h.lnc), false);
  h.respond({ 101: [match()] });
  result = await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(result.captured, true);
  assert.equal(result.rows.length, 2);
});
test('used IDs and missing timestamps cannot identify a single-linked-club fixture', () => {
  const h = setup('home'); const linked = h.teams.filter(t => t.eaClub); const m = match();
  assert.equal(h.api.selectEaMatch([m], h.lnc, linked, new Set(['ea-1'])).match, null);
  delete m.timestamp;
  assert.equal(h.api.selectEaMatch([m], h.lnc, linked).match, null);
});
test('the opponent response can recover after the first club request fails', async () => {
  const h = setup(); h.respond({ 101: new Error('503'), 102: [match()] });
  assert.equal((await h.api.captureOnceForTest('test', h.lnc)).captured, true);
  assert.equal(h.calls.length, 2);
});

test('one linked club accepts the sole recent fixture even if EA reports a different score', async () => {
  const h = setup('home'); h.respond({ 101: [match('score-lag', '0', '0')] });
  const result = await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(result.captured, true);
  assert.equal(result.fallback, true);
  assert.equal(result.rows.length, 2);
});

test('twenty unrelated history entries do not make one recent fixture ambiguous', () => {
  const h = setup('home');
  const history = Array.from({ length: 20 }, (_, i) => ({
    ...match('old-' + i), timestamp: '2026-10-15T19:00:00Z',
  }));
  history.push(match('actual', '0', '0'));
  const result = h.api.selectEaMatch(history, h.lnc, h.teams.filter(t => t.eaClub));
  assert.equal(result.match.matchId, 'actual');
});

test('time fallback never accepts an older score-mismatching fixture', () => {
  const h = setup('home'); const m = match('old', '0', '0');
  m.timestamp = '2026-10-15T21:45:00Z';
  assert.equal(h.api.selectEaMatch([m], h.lnc, h.teams.filter(t => t.eaClub)).match, null);
});

test('start-time lookback accepts a unique exact-score fixture, not an arbitrary old game', () => {
  const h = setup('home'); const m = match();
  m.timestamp = '2026-10-15T21:42:00Z';
  assert.equal(h.api.selectEaMatch([m], h.lnc, h.teams.filter(t => t.eaClub)).match.matchId, 'ea-1');
  m.timestamp = '2026-10-15T21:20:00Z';
  assert.equal(h.api.selectEaMatch([m], h.lnc, h.teams.filter(t => t.eaClub)).match, null);
});

test('one linked club does not guess between multiple recent score-mismatching games', () => {
  const h = setup('home');
  const result = h.api.selectEaMatch([match('one', '0', '0'), match('two', '0', '0')],
    h.lnc, h.teams.filter(t => t.eaClub));
  assert.equal(result.match, null);
  assert.equal(result.reason, 'ambiguous_recent_matches');
});

test('a linked opponent must match its club ID, not only the score and time', () => {
  const h = setup(); const m = match();
  m.clubs[999] = m.clubs[102]; delete m.clubs[102];
  assert.equal(h.api.selectEaMatch([m], h.lnc, h.teams).match, null);
});

test('admin results of any score are skipped but a normally reported 3:0 is eligible', async () => {
  const h = setup();
  h.lnc.result = { ...h.lnc.result, source: 'admin', matchPlayed: true };
  assert.equal((await h.api.captureOnceForTest('test', h.lnc)).reason, 'forfeit');
  assert.equal(h.calls.length, 0);
  h.lnc.result = { ...h.lnc.result, source: 'teams', homeGoals: 3, awayGoals: 0 };
  assert.equal(h.api.requiresEaCapture(h.lnc), true);
  h.lnc.result.matchPlayed = false;
  assert.equal(h.api.requiresEaCapture(h.lnc), false);
});

test('concurrent closing checks and regular capture share one fixture operation', async () => {
  const h = setup(); h.respond({ 101: [match()], 102: [match()] });
  const results = await Promise.all(Array.from({ length: 7 }, () => h.api.captureOnceForTest('test', h.lnc)));
  assert.ok(results.every(result => result.captured));
  assert.equal(h.calls.length, 2);
  assert.equal(h.event.ceremony.teamOfTheTournament.performances.length, 2);
});


function decisionPair() {
  const draw = match('main-draw', '2', '2');
  draw.timestamp = '2026-10-15T21:42:00Z';
  const decision = match('golden-goal', '0', '3');
  decision.clubs[102].winnerByDnf = '1';
  return { draw, decision };
}
test('knockout DNF decision uses the preceding draw instead of short-game ratings', () => {
  const h = setup(); const { draw, decision } = decisionPair();
  const result = h.api.selectEaMatch([decision, draw], h.lnc, h.teams, new Set(), { knockout: true });
  assert.equal(result.match.matchId, 'main-draw');
  assert.equal(result.decisionMatchId, 'golden-goal');
});
test('knockout DNF with missing, ambiguous or wrong-winner main game requires review', () => {
  const h = setup(); const { draw, decision } = decisionPair();
  for (const candidates of [[decision], [draw, { ...draw, matchId: 'other-draw' }, decision]]) {
    const result = h.api.selectEaMatch(candidates, h.lnc, h.teams, new Set(), { knockout: true });
    assert.equal(result.match, null);
    assert.equal(result.reason, 'decision_needs_review');
  }
  decision.clubs[102].winnerByDnf = '0'; decision.clubs[101].winnerByDnf = '1';
  assert.equal(h.api.selectEaMatch([draw, decision], h.lnc, h.teams, new Set(), { knockout: true }).match, null);
});
test('golden-goal recovery stores only full-game stats and reserves the decision ID', async () => {
  const h = setup(); const { draw, decision } = decisionPair();
  h.event.knockout = { rounds: { final: { matches: [h.lnc] } } };
  h.respond({ 101: [decision, draw], 102: [decision, draw] });
  const result = await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(result.captured, true);
  assert.equal(result.decisionMatchId, 'golden-goal');
  const state = h.event.ceremony.teamOfTheTournament;
  assert.equal(state.capturedMatches[0].decisionMatchId, 'golden-goal');
  assert.ok(state.performances.every(row => row.eaMatchId === 'main-draw'));
  assert.ok(state.performances.every(row => row.won === 0));
});
test('failed identity diagnostics show actual EA names, dates, opponent IDs and reuse', async () => {
  const h = setup(); const wrong = match('wrong');
  wrong.clubs[101].details = { name: 'Different club' };
  wrong.clubs[999] = wrong.clubs[102]; delete wrong.clubs[102];
  h.teams[0].eaClub.name = 'Expected club';
  h.respond({ 101: [wrong] });
  const result = await h.api.captureOnceForTest('test', h.lnc);
  assert.equal(result.captured, false);
  assert.match(result.detail, /Different club/);
  assert.match(result.detail, /Expected club/);
  assert.match(result.detail, /999/);
  assert.match(result.detail, /Club-IDs passen nicht/);
});
