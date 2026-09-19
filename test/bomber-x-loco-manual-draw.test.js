'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('module');

function loadManualDraw() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '../teams/team-service' && parent?.filename.endsWith('bomber-x-loco-manual-draw.js')) {
      return { findTeamById: teamId => ({ id: String(teamId), clubName: `Team ${teamId}` }) };
    }
    if (request === '../events/event-lock-service' && parent?.filename.endsWith('bomber-x-loco-manual-draw.js')) {
      return { lockEventFormat: () => null };
    }
    if (request === '../groups/group-roles' && parent?.filename.endsWith('bomber-x-loco-manual-draw.js')) {
      return { ensureGroupRolesAndMembers: async () => ({ guild: null, updates: [] }) };
    }
    if (request === '../groups/group-channels' && parent?.filename.endsWith('bomber-x-loco-manual-draw.js')) {
      return {
        ensureGroupChannel: async () => null,
        ensureGroupResultsChannel: async () => null,
        ensureGroupVideoChannel: async () => null,
        getGroupUserIds: () => [],
      };
    }
    if (request === '../groups/group-posts' && parent?.filename.endsWith('bomber-x-loco-manual-draw.js')) {
      return { upsertGroupPosts: async () => ({}), updateGroupMessageRefs: () => null };
    }
    if (request === '../groups/attendance-service' && parent?.filename.endsWith('bomber-x-loco-manual-draw.js')) {
      return { ensureAttendancePost: async () => null };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve('../src/domain/checkins/bomber-x-loco-manual-draw');
  delete require.cache[modulePath];
  const loaded = require(modulePath);
  Module._load = originalLoad;
  return loaded;
}

test('manual Bomber draw offers locked teams and byes as selectable participants', () => {
  const { availableParticipants, createEmptyManualGroups } = loadManualDraw();
  const participants = [
    ...Array.from({ length: 46 }, (_, index) => ({ type: 'team', teamId: String(index + 1), displayName: `Team ${index + 1}` })),
    { type: 'bye', byeId: 'bye_saturday_1', displayName: 'Freilos' },
    { type: 'bye', byeId: 'bye_saturday_2', displayName: 'Freilos' },
  ];
  const event = {
    format: { participants },
    groups: { groups: createEmptyManualGroups(48) },
  };

  const available = availableParticipants(event);
  assert.equal(available.length, 48);
  assert.deepEqual(available.slice(0, 2).map(entry => entry.displayName), ['Freilos 1', 'Freilos 2']);
  assert.deepEqual(available.slice(0, 2).map(entry => entry.value), ['bye:bye_saturday_1', 'bye:bye_saturday_2']);
});

test('manual Bomber draw persists a bye slot and generates bye matches safely', () => {
  const { assignParticipantInEvent, createEmptyManualGroups } = loadManualDraw();
  const groups = createEmptyManualGroups(6);
  const teamParticipants = Array.from({ length: 5 }, (_, index) => ({ type: 'team', teamId: String(index + 1), displayName: `Team ${index + 1}` }));
  const group = groups.A;
  for (let index = 0; index < teamParticipants.length; index += 1) {
    group.slots[index] = {
      slot: index + 1,
      type: 'team',
      teamId: String(index + 1),
      participantKey: `team:${index + 1}`,
      displayName: `Team ${index + 1}`,
      pendingAssignment: false,
    };
  }
  const event = {
    cycle: { eventDate: '2026-09-19' },
    meta: { eventMode: 'bomber_x_loco' },
    format: { participants: [...teamParticipants, { type: 'bye', byeId: 'bye_saturday_1', displayName: 'Freilos' }] },
    groups: { manualDraw: true, groups },
  };

  const result = assignParticipantInEvent(event, {
    groupKey: 'A',
    selectedValue: 'bye:bye_saturday_1',
    actorUserId: 'admin',
    now: new Date('2026-09-19T17:00:00.000Z'),
  });

  assert.equal(result.group.slots[5].type, 'bye');
  assert.equal(result.group.slots[5].byeId, 'bye_saturday_1');
  assert.equal(result.group.assignmentComplete, true);
  assert.equal(result.allAssigned, true);
  assert.ok(result.group.matchdays.flatMap(matchday => matchday.matches).some(match => match.status === 'bye'));
  assert.equal(event.meta.bomberManualDrawCompletedAt, '2026-09-19T17:00:00.000Z');
});
