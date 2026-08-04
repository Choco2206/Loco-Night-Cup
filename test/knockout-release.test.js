'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRoundReleaseContent, buildRoundReleasePayload, getRoundReleaseAt, getRoundReminderAt, isRoundReadyForRelease, ROUND_VIDEO_CHANNEL_NAMES } = require('../src/domain/knockout/knockout-release');

test('uses the actual round release time for a five-minute invitation window', () => {
  const releasedAt = new Date('2026-07-17T23:10:00.000Z');
  const content = buildRoundReleaseContent({ label: 'Achtelfinale', releasedAt });
  assert.match(content, /Achtelfinale ist freigegeben/);
  assert.match(content, /01:10 Uhr bis 01:15 Uhr/);
  assert.ok(!content.includes('<@'));
});

test('pings only the role assigned to the released K.O. round', () => {
  const releasedAt = new Date('2026-07-17T23:10:00.000Z');
  const payload = buildRoundReleasePayload({ label: 'Achtelfinale', releasedAt, roleId: 'round-of-16-role' });
  assert.match(payload.content, /^<@&round-of-16-role>\n/);
  assert.match(payload.content, /Achtelfinale ist freigegeben/);
  assert.deepEqual(payload.allowedMentions, { parse: [], roles: ['round-of-16-role'] });
});

test('schedules the K.O. result reminder twenty minutes after the dynamic release', () => {
  const releasedAt = new Date('2026-07-17T23:10:00.000Z');
  assert.equal(getRoundReminderAt(releasedAt).toISOString(), '2026-07-17T23:30:00.000Z');
});

test('uses one dedicated GrБひenvideo channel name per K.O. round', () => {
  assert.equal(ROUND_VIDEO_CHANNEL_NAMES.round_of_16, 'grБひenvideo-ko-achtelfinale');
  assert.equal(ROUND_VIDEO_CHANNEL_NAMES.quarter_final, 'grБひenvideo-ko-viertelfinale');
  assert.equal(ROUND_VIDEO_CHANNEL_NAMES.semi_final, 'grБひenvideo-ko-halbfinale');
  assert.equal(ROUND_VIDEO_CHANNEL_NAMES.third_place, 'grБひenvideo-ko-platz-3');
  assert.equal(ROUND_VIDEO_CHANNEL_NAMES.final, 'grБひenvideo-ko-finale');
});

test('releases following rounds only after the complete prerequisite round is confirmed', () => {
  const openMatch = {
    home: { type: 'team' }, away: { type: 'team' }, status: 'open',
    release: { releasedAt: '2026-07-17T23:10:00.000Z' },
  };
  const event = { knockout: {
    firstRoundKey: 'round_of_16',
    rounds: {
      round_of_16: { status: 'open', matches: [openMatch] },
      quarter_final: { status: 'open', matches: [openMatch] },
      semi_final: { status: 'locked', matches: [] },
    },
  } };
  assert.equal(isRoundReadyForRelease(event, 'round_of_16'), true);
  assert.equal(isRoundReadyForRelease(event, 'quarter_final'), false);
  event.knockout.rounds.round_of_16.status = 'completed';
  assert.equal(isRoundReadyForRelease(event, 'quarter_final'), true);
});

test('only starts a round release when a real match is open', () => {
  const round = { matches: [
    { home: { type: 'team' }, away: { type: 'placeholder' }, status: 'locked', release: { releasedAt: null } },
    { home: { type: 'team' }, away: { type: 'team' }, status: 'open', release: { releasedAt: '2026-07-17T23:10:00.000Z' } },
  ] };
  assert.equal(getRoundReleaseAt(round).toISOString(), '2026-07-17T23:10:00.000Z');
  assert.equal(getRoundReleaseAt({ matches: [round.matches[0]] }), null);
});

