'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSettingsDefault, createEventDefault } = require('../src/storage/defaults');
const { getPlannedSchedule } = require('../src/domain/checkins/checkin-schedule');
const { isLocoZwergenCupDate, isLocoZwergenCupEvent } = require('../src/domain/events/loco-zwergen-cup-config');

test('Loco Zwergen Cup is isolated to Saturday 12 September 2026', () => {
  assert.equal(isLocoZwergenCupDate('saturday', '2026-09-12'), true);
  assert.equal(isLocoZwergenCupDate('friday', '2026-09-12'), false);
  assert.equal(isLocoZwergenCupDate('saturday', '2026-09-19'), false);
  assert.equal(isLocoZwergenCupEvent({ meta: { eventMode: 'loco_zwergen_cup' } }), true);
});

test('schedule selects Zwergen, Bomber and normal Saturday independently', () => {
  const settings = createSettingsDefault();
  const event = createEventDefault('saturday');
  event.cycle = { eventDate: '2026-09-12', timezone: 'Europe/Berlin' };
  assert.equal(getPlannedSchedule('saturday', event, settings, new Date('2026-09-12T10:00:00Z')).eventMode, 'loco_zwergen_cup');
  event.cycle.eventDate = '2026-09-19';
  assert.equal(getPlannedSchedule('saturday', event, settings, new Date('2026-09-19T10:00:00Z')).eventMode, 'bomber_x_loco');
  event.cycle.eventDate = '2026-09-26';
  assert.equal(getPlannedSchedule('saturday', event, settings, new Date('2026-09-26T10:00:00Z')).eventMode, 'night_cup');
});
