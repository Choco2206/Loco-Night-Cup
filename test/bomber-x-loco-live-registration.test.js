'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('module');

test('live Bomber registration keeps manual byes and marks waitlist teams', () => {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '../teams/team-service' && parent?.filename.endsWith('bomber-x-loco-registration.js')) {
      return {
        findNonDeletedTeamByUserId: () => null,
        findTeamById: teamId => ({ id: String(teamId), clubName: `Team ${teamId}`, status: 'active', registrationStatus: 'complete' }),
        isTeamMember: () => false,
      };
    }
    if (request === './checkin-ban-integration' && parent?.filename.endsWith('bomber-x-loco-registration.js')) {
      return { findActiveBanForTeamOrManagers: () => null };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const modulePath = require.resolve('../src/domain/checkins/bomber-x-loco-registration');
  delete require.cache[modulePath];
  const { buildPayload, resetEventForReschedule, resetRegistrationForReschedule, stateFromLiveEvent } = require(modulePath);
  Module._load = originalLoad;

  const teamIds = Array.from({ length: 47 }, (_, index) => String(index + 1));
  const baseEvent = {
    checkin: {
      entries: teamIds.map(teamId => ({ teamId })),
      activeTeamIds: teamIds.slice(0, 42),
      waitlistTeamIds: teamIds.slice(42),
    },
    format: { size: 42, activeByeCount: 0 },
    byes: [],
  };

  const withoutBye = buildPayload(stateFromLiveEvent(baseEvent), { liveEvent: true });
  const withoutByeText = withoutBye.embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(withoutByeText, /43 \| Team 43 \(WL\)/);
  assert.match(withoutByeText, /47 \| Team 47 \(WL\)/);

  const withByeEvent = {
    ...baseEvent,
    checkin: { ...baseEvent.checkin, activeTeamIds: teamIds, waitlistTeamIds: [] },
    format: { size: 48, activeByeCount: 1 },
    byes: [{ type: 'bye', status: 'active', id: 'bye_saturday_1' }],
  };
  const withBye = buildPayload(stateFromLiveEvent(withByeEvent), { liveEvent: true });
  const withByeText = withBye.embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(withByeText, /Aktuelles Format: 48er Turnier/);
  assert.match(withByeText, /Teilnehmerfeld: 48\/48 Plätze \(47 Teams \+ 1 Freilos\)/);
  assert.match(withByeText, /48 \| Freilos/);
  assert.doesNotMatch(withByeText, /Team 43 \(WL\)/);

  const oldState = {
    eventDate: '2026-09-19',
    entries: [{ teamId: '1' }, { teamId: '2' }],
    activeTeamIds: ['1'],
    waitlistTeamIds: ['2'],
    byes: [{ id: 'old-bye', status: 'active' }],
    format: { size: 48 },
    handedOverAt: '2026-09-19T18:00:00.000Z',
  };
  assert.equal(resetRegistrationForReschedule(oldState, new Date('2026-09-20T12:00:00.000Z')), true);
  assert.equal(oldState.eventDate, '2026-09-25');
  assert.deepEqual(oldState.entries, []);
  assert.deepEqual(oldState.activeTeamIds, []);
  assert.deepEqual(oldState.waitlistTeamIds, []);
  assert.deepEqual(oldState.byes, []);
  assert.deepEqual(oldState.format, {});
  assert.equal(oldState.handedOverAt, null);

  const oldEvent = {
    status: 'checkin_open',
    cycle: { eventDate: '2026-09-25' },
    meta: { eventMode: 'bomber_x_loco' },
    checkin: {
      isOpen: true,
      entries: [{ teamId: '1' }, { teamId: '2' }],
      activeTeamIds: ['1'],
      waitlistTeamIds: ['2'],
      lateLeaveBans: [{ teamId: 'old' }],
    },
    byes: [{ id: 'old-bye', status: 'active' }],
    format: { size: 48, lockedAt: '2026-09-19T18:00:00.000Z', participants: [{ teamId: '1' }] },
    groups: { status: 'completed', groups: { A: {} } },
    knockout: { status: 'created', rounds: { round_of_32: {} } },
    ceremony: { status: 'ready', postedAt: '2026-09-19T23:00:00.000Z' },
  };
  assert.equal(resetEventForReschedule(oldEvent, new Date('2026-09-20T12:00:00.000Z')), true);
  assert.deepEqual(oldEvent.checkin.entries, []);
  assert.deepEqual(oldEvent.checkin.activeTeamIds, []);
  assert.deepEqual(oldEvent.checkin.waitlistTeamIds, []);
  assert.deepEqual(oldEvent.byes, []);
  assert.equal(oldEvent.format.size, null);
  assert.equal(oldEvent.format.lockedAt, null);
  assert.deepEqual(oldEvent.format.participants, []);
  assert.equal(oldEvent.groups.status, 'not_created');
  assert.equal(oldEvent.knockout.status, 'not_created');

  oldState.entries.push({ teamId: 'new-team' });
  assert.equal(resetRegistrationForReschedule(oldState, new Date('2026-09-21T12:00:00.000Z')), false);
  assert.deepEqual(oldState.entries, [{ teamId: 'new-team' }]);
});
