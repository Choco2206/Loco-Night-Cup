'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRoundReleaseContent, getRoundReleaseAt } = require('../src/domain/knockout/knockout-release');

test('uses the actual round release time for a five-minute invitation window', () => {
  const releasedAt = new Date('2026-07-17T23:10:00.000Z');
  const content = buildRoundReleaseContent({ label: 'Achtelfinale', releasedAt, mentions: '<@1> <@2>' });
  assert.match(content, /Achtelfinale ist freigegeben/);
  assert.match(content, /01:10 Uhr bis 01:15 Uhr/);
  assert.ok(content.startsWith('<@1> <@2>'));
});

test('only starts a round release when a real match is open', () => {
  const round = { matches: [
    { home: { type: 'team' }, away: { type: 'placeholder' }, status: 'locked', release: { releasedAt: null } },
    { home: { type: 'team' }, away: { type: 'team' }, status: 'open', release: { releasedAt: '2026-07-17T23:10:00.000Z' } },
  ] };
  assert.equal(getRoundReleaseAt(round).toISOString(), '2026-07-17T23:10:00.000Z');
  assert.equal(getRoundReleaseAt({ matches: [round.matches[0]] }), null);
});
