'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FORMATION, MINIMUM_MATCHES, buildSelection, normalizePosition } = require('../src/domain/team-of-the-tournament/team-of-the-tournament-service');

test('uses the fixed 1-3-5-2 Team of the Tournament formation', () => {
  assert.deepEqual(FORMATION, { goalkeeper: 1, defender: 3, midfielder: 5, forward: 2 });
  assert.equal(MINIMUM_MATCHES, 3);
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

