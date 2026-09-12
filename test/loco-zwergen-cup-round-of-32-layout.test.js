'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const layouts = require('../config/loco-zwergen-cup-ko-image-layouts');

test('maps all sixteen Zwergen Cup Sechzehntelfinale rows', () => {
  const layout = layouts.round_of_32;
  assert.equal(layout.template, 'assets/loco-zwerge-cup/round-of-32.jpeg');
  assert.equal(layout.matches.length, 16);
  assert.deepEqual(layout.matches.map(match => match.score.y), [
    494, 549, 602, 655, 708, 761, 814, 867,
    922, 975, 1028, 1081, 1134, 1187, 1240, 1293,
  ]);
  assert.equal(fs.existsSync(path.join(__dirname, '..', layout.template)), true);
});

test('keeps logos, names and scores inside every dense matchup row', () => {
  for (const match of layouts.round_of_32.matches) {
    assert.equal(match.home.logo.width, 38);
    assert.equal(match.away.logo.width, 38);
    assert.ok(match.home.logo.centerX - 19 >= 35);
    assert.ok(match.away.logo.centerX + 19 <= 989);
    assert.equal(match.home.teamName.align, 'center');
    assert.equal(match.away.teamName.align, 'center');
    assert.equal(match.score.x, 512);
  }
});
