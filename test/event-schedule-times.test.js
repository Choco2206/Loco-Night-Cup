'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventDefault, createSettingsDefault } = require('../src/storage/defaults');
const { getPlannedSchedule } = require('../src/domain/checkins/checkin-schedule');

test('starts Monday through Thursday and Sunday at 23:00 with unchanged lead times', () => {
  const settings = createSettingsDefault();

  for (const eventKey of ['monday', 'tuesday', 'wednesday', 'thursday', 'sunday']) {
    const event = createEventDefault(eventKey);
    const profile = settings.timeProfiles.profiles[settings.timeProfiles.eventProfiles[eventKey]];
    assert.deepEqual(
      {
        deadlineTime: profile.deadlineTime,
        lateWindowUntilTime: profile.lateWindowUntilTime,
        drawTime: profile.drawTime,
        tournamentStartTime: profile.tournamentStartTime,
        startIsNextDay: profile.startIsNextDay,
      },
      {
        deadlineTime: '22:30',
        lateWindowUntilTime: '22:45',
        drawTime: '22:50',
        tournamentStartTime: '23:00',
        startIsNextDay: false,
      },
    );
  }

  const monday = createEventDefault('monday');
  monday.cycle.eventDate = '2026-08-10';
  const planned = getPlannedSchedule('monday', monday, settings, new Date('2026-08-10T12:00:00.000Z'));
  assert.equal(planned.deadlineAt.toISOString(), '2026-08-10T20:30:00.000Z');
  assert.equal(planned.lateWindowUntil.toISOString(), '2026-08-10T20:45:00.000Z');
  assert.equal(planned.drawAt.toISOString(), '2026-08-10T20:50:00.000Z');
  assert.equal(planned.tournamentStartAt.toISOString(), '2026-08-10T21:00:00.000Z');
});

test('keeps Friday and Saturday on the existing 00:15 late schedule', () => {
  const settings = createSettingsDefault();
  for (const eventKey of ['friday', 'saturday']) {
    assert.equal(settings.timeProfiles.eventProfiles[eventKey], 'weekend_late_night');
  }

  const friday = createEventDefault('friday');
  friday.cycle.eventDate = '2026-08-07';
  const planned = getPlannedSchedule('friday', friday, settings, new Date('2026-08-07T12:00:00.000Z'));
  assert.equal(planned.deadlineAt.toISOString(), '2026-08-07T21:45:00.000Z');
  assert.equal(planned.lateWindowUntil.toISOString(), '2026-08-07T22:00:00.000Z');
  assert.equal(planned.drawAt.toISOString(), '2026-08-07T22:05:00.000Z');
  assert.equal(planned.tournamentStartAt.toISOString(), '2026-08-07T22:15:00.000Z');
});

