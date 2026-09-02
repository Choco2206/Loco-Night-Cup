'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const layout = require('../config/bomber-x-loco-special-awards-layout');
const { renderSpecialAwards } = require('../utils/special-awards-renderer');

function player(key, index) {
  return {
    teamId: `missing-preview-team-${index}`,
    playerName: `Award Spieler ${index + 1}`,
    [key]: key === 'averageRating' ? 8.75 : index + 3,
    averageRating: 8.75,
  };
}

test('maps all eight Bomber X Loco awards without a serial field', () => {
  assert.deepEqual(layout.reference, { width: 1536, height: 1024 });
  assert.equal(layout.serial, null);
  assert.deepEqual(layout.awards.map(slot => slot.key), [
    'goals', 'assists', 'tacklesMade', 'saves',
    'cleanSheets', 'passesMade', 'averageRating', 'manOfTheMatch',
  ]);
});

test('renders the one-off Bomber X Loco Special Awards graphic', async () => {
  const awards = Object.fromEntries(layout.awards.map((slot, index) => [slot.key, player(slot.key, index)]));
  const rendered = await renderSpecialAwards({ awards, serialNumber: 99, variant: 'bomber_x_loco' });
  assert.equal(rendered.fileName, 'bomber-x-loco-special-awards.png');
  assert.ok(rendered.buffer.length > 500_000);
});
