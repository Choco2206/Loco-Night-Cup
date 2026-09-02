'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTottSelection } = require('../src/domain/admin/bomber-x-loco-graphics-test');

test('fills all eleven Bomber X Loco TOTT slots with existing logo teams', () => {
  const teams = [
    { id: 'team-a', clubName: 'Team A', logo: { fileName: 'team-a.png' } },
    { id: 'team-b', clubName: 'Team B', logo: { fileName: 'team-b.png' } },
  ];
  const selection = buildTottSelection(teams);
  assert.equal(selection.goalkeeper.length, 1);
  assert.equal(selection.defender.length, 3);
  assert.equal(selection.midfielder.length, 5);
  assert.equal(selection.forward.length, 2);
  assert.equal(Object.values(selection).flat().length, 11);
  assert.deepEqual(new Set(Object.values(selection).flat().map(player => player.teamId)), new Set(['team-a', 'team-b']));
});

test('refuses an empty-logo preview instead of posting placeholder crests', () => {
  assert.throws(() => buildTottSelection([{ id: 'team-a', clubName: 'Team A' }]), /gespeichertem Logo/);
});
