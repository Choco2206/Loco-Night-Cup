'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventDefault, createSettingsDefault } = require('../src/storage/defaults');
const { ensureEventCycle, getCheckinWindowState, getPlannedSchedule } = require('../src/domain/checkins/checkin-schedule');
const { validateEvent } = require('../src/validation/events.schema');
const { createEmptyManualGroups } = require('../src/domain/checkins/bomber-x-loco-manual-draw');
const { isHalloweenChannel } = require('../src/domain/checkins/halloween-channel');
const { buildBomberXLocoBlockerPayload, buildBomberXLocoPayload } = require('../src/domain/checkins/bomber-x-loco-checkin');
const { HALLOWEEN_CHECKIN_CHANNEL_ID } = require('../src/domain/events/bomber-x-loco-config');
const { isBomberXLocoDate } = require('../src/domain/events/bomber-x-loco-config');
const { generateBomberXLocoMatchesImage, BOMBER_X_LOCO_MATCHES_LAYOUT, BOMBER_X_LOCO_HALLOWEEN_MATCHES_LAYOUT } = require('../utils/generateBomberXLocoMatchesImage');

test('Halloween runs alongside normal Fridays with its own six-team format and Berlin winter times', () => {
  const settings = createSettingsDefault();
  const now = new Date('2026-09-26T10:00:00Z');
  const halloween = createEventDefault('bomber_halloween');
  const friday = createEventDefault('friday');
  ensureEventCycle('bomber_halloween', halloween, settings, now);
  ensureEventCycle('friday', friday, settings, now);

  assert.equal(halloween.cycle.cycleKey, 'bomber_halloween_2026-10-30');
  assert.equal(friday.cycle.eventDate, '2026-10-02');
  assert.equal(halloween.meta.eventMode, 'bomber_x_loco');
  assert.equal(halloween.format.minimumRealTeams, 6);
  assert.deepEqual(halloween.format.allowedSizes, [6, 12, 18, 24, 30, 36, 42, 48, 54, 60]);
  assert.deepEqual(validateEvent(halloween, 'bomber_halloween'), []);
  assert.equal(halloween.schedule.deadlineAt, '2026-10-30T17:30:00.000Z');
  assert.equal(halloween.schedule.drawAt, '2026-10-30T18:00:00.000Z');
  assert.equal(halloween.schedule.tournamentStartAt, '2026-10-30T20:00:00.000Z');
  assert.equal(halloween.schedule.resetAt, '2026-10-31T06:00:00.000Z');
  assert.equal(getCheckinWindowState('bomber_halloween', halloween, settings, now).canJoin, true);
  assert.equal(Object.keys(createEmptyManualGroups(60, 'bomber_halloween')).length, 10);
});

test('regular Friday check-in is closed on Halloween without touching its previous cycle', () => {
  const settings = createSettingsDefault();
  const friday = createEventDefault('friday');
  const now = new Date('2026-10-26T10:00:00Z');
  assert.equal(getPlannedSchedule('friday', friday, settings, now).eventDate, '2026-10-30');
  ensureEventCycle('friday', friday, settings, now);
  assert.equal(getCheckinWindowState('friday', friday, settings, now).canJoin, false);
  assert.equal(getPlannedSchedule('friday', createEventDefault('friday'), settings, new Date('2026-10-19T10:00:00Z')).eventDate, '2026-10-23');
  assert.equal(isBomberXLocoDate('friday', '2027-09-25'), false);
  assert.equal(isBomberXLocoDate('bomber_halloween', '2027-10-30'), false);
});

test('existing stylized Halloween channel can be resolved by its normalized name', () => {
  assert.equal(HALLOWEEN_CHECKIN_CHANNEL_ID, '1542823464434671676');
  assert.equal(Boolean(isHalloweenChannel({ name: '💣🐺🎃│𝘽𝙤𝙢𝙗𝙚𝙧-𝙓-𝙇𝙤𝙘𝙤-𝙃𝙖𝙡𝙡𝙤𝙬𝙚𝙚𝙣-𝘾𝙪𝙥', send() {} })), true);
  assert.equal(Boolean(isHalloweenChannel({ name: 'general', send() {} })), false);
});

test('Friday panel points to the Halloween check-in and switches to today wording', () => {
  const advance = buildBomberXLocoBlockerPayload({ halloween: true, channelId: HALLOWEEN_CHECKIN_CHANNEL_ID });
  const today = buildBomberXLocoBlockerPayload({ halloween: true, today: true, channelId: HALLOWEEN_CHECKIN_CHANNEL_ID });
  assert.match(advance.embeds[0].toJSON().description, /Für diesen Freitag/);
  assert.match(today.embeds[0].toJSON().description, /Heute findet kein regulärer/);
  assert.match(today.embeds[0].toJSON().description, /<#1542823464434671676>/);
  assert.equal(today.components[0].components[0].data.disabled, false);
});

test('Halloween check-in uses its own artwork instead of the promotional poster', () => {
  const settings = createSettingsDefault();
  const event = createEventDefault('bomber_halloween');
  ensureEventCycle('bomber_halloween', event, settings, new Date('2026-09-26T10:00:00Z'));
  const payload = buildBomberXLocoPayload(event, settings);
  assert.equal(payload.files[0].name, 'bomber-x-loco-halloween-check-in.png');
  assert.match(payload.embeds[0].toJSON().image.url, /bomber-x-loco-halloween-check-in\.png/);
});

test('Halloween matchdays use the separate portrait artwork with five times three slots', async () => {
  const group = { eventKey: 'bomber_halloween', groupKey: 'B', matchdays: [] };
  const halloween = await generateBomberXLocoMatchesImage({ group });
  const regular = await generateBomberXLocoMatchesImage({ group: { ...group, eventKey: 'bomber_x_loco' } });
  assert.equal(BOMBER_X_LOCO_MATCHES_LAYOUT.matchRowsY.length, 5);
  assert.equal(BOMBER_X_LOCO_HALLOWEEN_MATCHES_LAYOUT.matchRowsY.length, 5);
  assert.ok(BOMBER_X_LOCO_HALLOWEEN_MATCHES_LAYOUT.matchRowsY.every(day => day.length === 3));
  assert.notDeepEqual(BOMBER_X_LOCO_HALLOWEEN_MATCHES_LAYOUT.matchRowsY, BOMBER_X_LOCO_MATCHES_LAYOUT.matchRowsY);
  assert.ok(BOMBER_X_LOCO_MATCHES_LAYOUT.matchRowsY.every(day => day.length === 3));
  assert.equal(halloween.width, 1024);
  assert.equal(halloween.height, 1535);
  assert.notDeepEqual(halloween.buffer, regular.buffer);
});
