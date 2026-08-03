'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

let storedEvent = null;
const teams = {
  alpha: { id: 'alpha', clubName: 'Loco Alpha', manager: { userId: 'vm-alpha' }, coManagers: [{ userId: 'co-alpha' }] },
  beta: { id: 'beta', clubName: 'Loco Beta', manager: { userId: 'vm-beta' }, coManagers: [] },
};
const originalLoad = Module._load;
Module._load = function loadWithAttendanceMocks(request, parent, isMain) {
  if (request === '../../app/constants') return { EVENT_KEYS: [] };
  if (request === '../../storage') return { FILES: {}, readJson: () => ({ roles: { cupLeadRoleIds: ['lead-role'] } }) };
  if (request === '../../storage/defaults') return { createSettingsDefault: () => ({}) };
  if (request === '../events/event-repository') {
    return {
      readEventData: () => storedEvent,
      updateEventData: (_eventKey, updater) => { storedEvent = updater(storedEvent); return storedEvent; },
    };
  }
  if (request === '../teams/team-service') {
    return {
      findTeamById: id => teams[id] || null,
      isTeamMember: (team, userId) => team?.manager?.userId === userId || team?.coManagers?.some(entry => entry.userId === userId),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const attendance = require('../src/domain/groups/attendance-service');
Module._load = originalLoad;

function groupScope() {
  return {
    groupKey: 'A', channelId: 'group-channel',
    slots: [
      { type: 'team', teamId: 'alpha' },
      { type: 'team', teamId: 'beta' },
      { type: 'bye', byeId: 'bye-1' },
    ],
    attendance: {
      status: 'open', messageId: 'attendance-message', presentTeamIds: [],
      closesAt: new Date(Date.now() + 60_000).toISOString(), finalizedAt: null,
    },
  };
}

test('attendance card lists only real teams and shows checked state', () => {
  const scope = groupScope();
  scope.attendance.presentTeamIds = ['alpha'];
  const payload = attendance.buildAttendancePayload('monday', 'A', scope);
  const description = payload.embeds[0].toJSON().description;
  assert.match(description, /バ. \*\*Loco Alpha\*\*/);
  assert.match(description, /Μo \*\*Loco Beta\*\*/);
  assert.doesNotMatch(description, /bye-1/);
  assert.equal(payload.components[0].toJSON().components[0].label, 'Anwesend');
});

test('a co-manager can mark only the associated team present without changing tournament state', async () => {
  const scope = groupScope();
  storedEvent = {
    status: 'groups', schedule: { tournamentStartAt: new Date(Date.now() + 180_000).toISOString() },
    groups: { status: 'created', groups: { A: scope } },
    knockout: { status: 'not_created' },
  };
  let edited = false;
  const message = { id: 'attendance-message', edit: async () => { edited = true; return message; } };
  const channel = { messages: { fetch: async () => message } };
  const client = { channels: { fetch: async () => channel } };
  let deferred = false;
  const interaction = {
    customId: 'team_attendance:monday:A', user: { id: 'co-alpha' },
    isButton: () => true,
    deferUpdate: async () => { deferred = true; },
    reply: async () => { throw new Error('reply should not be used'); },
  };

  const handled = await attendance.handleAttendanceInteraction(interaction, client);
  assert.equal(handled, true);
  assert.equal(deferred, true);
  assert.equal(edited, true);
  assert.deepEqual(storedEvent.groups.groups.A.attendance.presentTeamIds, ['alpha']);
  assert.equal(storedEvent.status, 'groups');
  assert.equal(storedEvent.knockout.status, 'not_created');
});

