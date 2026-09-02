'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renderSpecialAwards } = require('../utils/special-awards-renderer');
const layout = require('../config/special-awards-layout');

test('maps all eight Special Awards to fixed graphic areas', () => {
  assert.deepEqual(layout.awards.map(slot => slot.key), [
    'goals', 'assists', 'tacklesMade', 'saves',
    'cleanSheets', 'passesMade', 'averageRating', 'manOfTheMatch',
  ]);
  assert.ok(layout.awards.every(slot => slot.logo.length === 6));
});

test('renders the Special Awards template as a Discord-ready PNG', async () => {
  const rendered = await renderSpecialAwards({ awards: {}, serialNumber: 4 });
  assert.equal(rendered.fileName, 'special-awards-4.png');
  assert.equal(rendered.buffer.subarray(1, 4).toString(), 'PNG');
  assert.ok(rendered.buffer.length > 100000);
});
