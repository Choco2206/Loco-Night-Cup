'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const layouts = require('../config/bomber-x-loco-ko-image-layouts');

test('maps all sixteen visible rows of the replacement Sechzehntelfinale artwork', () => {
  const matches = layouts.round_of_32.matches;
  assert.equal(matches.length, 16);
  assert.deepEqual(matches.map(match => match.score.y), [
    567, 624, 679, 734, 789, 844, 900, 954,
    1010, 1065, 1120, 1175, 1230, 1286, 1340, 1396,
  ]);
  assert.equal(layouts.round_of_32.template, 'assets/bomber-x-loco/round-of-32.jpg');
});

test('keeps Sechzehntelfinale logos inside both team panels', () => {
  for (const match of layouts.round_of_32.matches) {
    assert.equal(match.home.logo.centerX, 104);
    assert.equal(match.away.logo.centerX, 920);
    assert.ok(match.home.logo.centerX - match.home.logo.width / 2 >= 82);
    assert.ok(match.away.logo.centerX + match.away.logo.width / 2 <= 942);
  }
});
