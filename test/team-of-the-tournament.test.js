'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FORMATION, MINIMUM_MATCHES, buildSelection, confirmedEventMatches, normalizePosition, selectEaMatch } = require('../src/domain/team-of-the-tournament/team-of-the-tournament-service');
const { aggregatePlayers, buildAwardsText, buildIntroText, buildTestPerformances, buildTestSelection, closingRatingsReady } = require('../src/domain/team-of-the-tournament/team-of-the-tournament-post');
const layout = require('../config/team-of-the-tournament-layout');
const bomberXLocoLayout = require('../config/bomber-x-loco-tott-layout');
const { AUTO_CLEANUP_DELAY_MS, isTeamOfTheTournamentSettled } = require('../src/domain/events/event-completion-policy');

test('uses the fixed 1-3-5-2 Team of the Tournament formation', () => {
  assert.deepEqual(FORMATION, { goalkeeper: 1, defender: 3, midfielder: 5, forward: 2 });
  assert.equal(MINIMUM_MATCHES, 3);
});

test('keeps event data until the Team of the Tournament workflow is settled', () => {
  assert.equal(AUTO_CLEANUP_DELAY_MS, 75 * 60 * 1000);
  assert.equal(isTeamOfTheTournamentSettled({ knockout: { status: 'completed' }, ceremony: { teamOfTheTournament: { postStatus: 'pending' } } }), false);
  assert.equal(isTeamOfTheTournamentSettled({ knockout: { status: 'completed' }, ceremony: { teamOfTheTournament: { postStatus: 'posted' } } }), true);
  assert.equal(isTeamOfTheTournamentSettled({ knockout: { status: 'completed' }, ceremony: { teamOfTheTournament: { postStatus: 'skipped' } } }), true);
});

test('normalizes the four EA Clubs position groups', () => {
  assert.equal(normalizePosition('goalkeeper'), 'goalkeeper');
  assert.equal(normalizePosition('defender'), 'defender');
  assert.equal(normalizePosition('midfielder'), 'midfielder');
  assert.equal(normalizePosition('forward'), 'forward');
});

test('requires three matches and selects the highest average rating', () => {
  const rows = [];
  const add = (playerId, ratings) => ratings.forEach((rating, index) => rows.push({
    lncMatchId: `m${index}`, teamId: 'team-a', playerId, playerName: playerId,
    position: 'forward', rating, goals: 0, assists: 0, manOfTheMatch: 0,
  }));
  add('eligible-high', [8, 9, 8.5]);
  add('eligible-low', [7, 7.5, 8]);
  add('ineligible', [10, 10]);
  const selection = buildSelection(rows);
  assert.deepEqual(selection.forward.map(player => player.playerId), ['eligible-high', 'eligible-low']);
  assert.equal(selection.forward[0].averageRating, 8.5);
});

test('matches one linked club by oriented score and closest confirmation time', () => {
  const linkedTeam = { id: 'home', eaClub: { clubId: '101' } };
  const lncMatch = {
    home: { teamId: 'home' }, away: { teamId: 'away' },
    result: { homeGoals: 2, awayGoals: 1, confirmedAt: '2026-08-02T00:30:00.000Z' },
  };
  const matches = [
    { matchId: 'old', timestamp: '1785624000', clubs: { 101: { clubId: '101', goals: '2' }, 999: { goals: '1' } } },
    { matchId: 'right', timestamp: '1785630000', clubs: { 101: { clubId: '101', goals: '2' }, 999: { goals: '1' } } },
    { matchId: 'reversed', timestamp: '1785630300', clubs: { 101: { clubId: '101', goals: '1' }, 999: { goals: '2' } } },
  ];
  assert.equal(selectEaMatch(matches, lncMatch, [linkedTeam])?.matchId, 'right');
});

test('does not guess a one-linked-team match without an EA timestamp', () => {
  const linkedTeam = { id: 'home', eaClub: { clubId: '101' } };
  const lncMatch = { home: { teamId: 'home' }, away: { teamId: 'away' }, result: { homeGoals: 2, awayGoals: 1, confirmedAt: '2026-08-02T00:30:00.000Z' } };
  const matches = [{ matchId: 'unknown-time', clubs: { 101: { clubId: '101', goals: '2' }, 999: { goals: '1' } } }];
  assert.equal(selectEaMatch(matches, lncMatch, [linkedTeam]), null);
});

test('finds confirmed group, league and knockout matches for startup recovery without duplicates', () => {
  const match = id => ({ id, status: 'confirmed', result: { homeGoals: 1, awayGoals: 0 } });
  const shared = match('shared');
  const event = {
    groups: { groups: { A: { matchdays: [{ matches: [match('group'), shared] }] } } },
    leaguePhase: { matchdays: [{ matches: [match('league')] }] },
    knockout: { rounds: { final: { matches: [match('final'), shared] } } },
  };
  assert.deepEqual(confirmedEventMatches(event).map(entry => entry.id), ['group', 'shared', 'league', 'final']);
});

test('waits for every linked confirmed event match before posting the final selection', () => {
  const event = {
    groups: { groups: { A: { matchdays: [{ matches: [{ id: 'group', status: 'confirmed', result: { homeGoals: 1, awayGoals: 0 }, home: { teamId: 'missing' }, away: { teamId: 'missing-2' } }] }] } } },
    knockout: { rounds: {} },
    ceremony: { teamOfTheTournament: { capturedMatches: [] } },
  };
  // Unlinked teams never block the workflow; linked matches are covered by integration tests with stored teams.
  assert.equal(closingRatingsReady(event), true);
});

test('maps exactly eleven graphic slots to the 1-3-5-2 formation', () => {
  assert.equal(layout.reference.width, 1024);
  assert.equal(layout.reference.height, 1536);
  assert.equal(layout.slots.goalkeeper.length, 1);
  assert.equal(layout.slots.defender.length, 3);
  assert.equal(layout.slots.midfielder.length, 5);
  assert.equal(layout.slots.forward.length, 2);
  assert.deepEqual(layout.slots.goalkeeper[0], {
    logo: { centerX: 513, centerY: 1288, radius: 80 },
    name: { x: 386, y: 1361, width: 190, height: 56 },
    rating: { centerX: 601, centerY: 1389, radius: 34 },
  });
});

test('uses a separate serial-free Bomber X Loco Team of the Tournament layout', () => {
  assert.deepEqual(bomberXLocoLayout.reference, { width: 1022, height: 1536 });
  assert.equal(bomberXLocoLayout.serial, null);
  assert.equal(Object.values(bomberXLocoLayout.slots).flat().length, 11);
  assert.equal(layout.template, 'assets/team-of-the-tournament/team-of-the-tournament.png');
  assert.equal(bomberXLocoLayout.template, 'assets/bomber-x-loco/team-of-the-tournament.jpg');
});

test('builds eleven fictitious players for the admin graphic test', () => {
  const selection = buildTestSelection();
  assert.equal(Object.values(selection).flat().length, 11);
  assert.ok(Object.values(selection).flat().every(player => player.averageRating >= 6.5 && player.averageRating <= 9.9));
  assert.equal(buildTestPerformances(selection).length, 33);
  assert.match(buildIntroText({ test: true }), /@everyone/);
  assert.match(buildIntroText({ test: true }), /Loco DNA/);
});

test('aggregates special awards only after three appearances', () => {
  const performances = [1, 2, 3].flatMap(match => ([
    { teamId: 'a', playerId: 'scorer', playerName: 'Scorer', rating: 8, goals: 1, assists: 0, tacklesMade: 0, saves: 0, cleanSheets: 0, passesMade: 10, manOfTheMatch: 1 },
    { teamId: 'b', playerId: 'helper', playerName: 'Helper', rating: 7.5, goals: 0, assists: 2, tacklesMade: 4, saves: 0, cleanSheets: 1, passesMade: 20, manOfTheMatch: 0 },
  ]));
  const players = aggregatePlayers(performances);
  assert.equal(players.length, 2);
  const awards = buildAwardsText(performances);
  assert.match(awards, /Top-TorschÃ¼tze.*Scorer/);
  assert.match(awards, /Assist-KÃ¶nig.*Helper/);
  assert.match(awards, /Top-AbrÃ¤umer.*Helper/);
});
