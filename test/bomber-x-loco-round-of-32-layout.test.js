'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const layouts = require('../config/bomber-x-loco-ko-image-layouts');

test('maps all sixteen visible Sechzehntelfinale rows', () => {
  const matches = layouts.round_of_32.matches;
  assert.equal(matches.length, 16);
  assert.deepEqual(matches.map(match => match.score.y), [
    578, 635, 692, 749, 806, 863, 920, 977,
    1034, 1091, 1148, 1205, 1262, 1319, 1376, 1433,
  ]);
});

test('keeps Sechzehntelfinale logos inside both team panels', () => {
  for (const match of layouts.round_of_32.matches) {
    assert.equal(match.home.logo.centerX, 104);
    assert.equal(match.away.logo.centerX, 920);
    assert.ok(match.home.logo.centerX - match.home.logo.width / 2 >= 82);
    assert.ok(match.away.logo.centerX + match.away.logo.width / 2 <= 942);
  }
});
