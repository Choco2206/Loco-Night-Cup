'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renderTeamOfTheTournament } = require('../utils/team-of-the-tournament-renderer');

function player(position, index) {
  return {
    teamId: `missing-preview-team-${position}-${index}`,
    playerName: `${position} ${index + 1}`,
    averageRating: 7.2 + (index * 0.3),
  };
}

test('renders the one-off Bomber X Loco TOTT without a serial-number filename', async () => {
  const selection = {
    forward: [player('forward', 0), player('forward', 1)],
    midfielder: Array.from({ length: 5 }, (_, index) => player('midfielder', index)),
    defender: Array.from({ length: 3 }, (_, index) => player('defender', index)),
    goalkeeper: [player('goalkeeper', 0)],
  };
  const rendered = await renderTeamOfTheTournament({ selection, serialNumber: 99, variant: 'bomber_x_loco' });
  assert.equal(rendered.fileName, 'bomber-x-loco-team-of-the-tournament.png');
  assert.ok(rendered.buffer.length > 500_000);
});
