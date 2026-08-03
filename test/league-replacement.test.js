'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithReplacementMocks(request, parent, isMain) {
  if (request === '../../storage') return { FILES: {}, readJson: (_file, fallback) => fallback };
  if (request === '../../storage/defaults') return { createSettingsDefault: () => ({}) };
  if (request === '../events/event-repository') return { readEventData: () => ({}), updateEventData: () => ({}) };
  if (request === '../checkins/checkin-panel') return { refreshCheckinMessage: async () => true };
  if (request === '../checkins/checkin-ban-integration') return { findActiveBanForTeamOrManagers: () => null };
  if (request === '../teams/team-service') return { findTeamById: () => null, listVisibleTeams: () => [] };
  if (request === './group-roles') return { getConfiguredGuild: async () => null, getTeamUserIds: () => [] };
  if (request === './group-posts') return { refreshGroupPosts: async () => true };
  if (request === '../league-phase/league-phase-service') return { refreshLeaguePhasePosts: async () => true };
  if (request === './group-results') return { recalculateGroupStandings: () => true, updateGroupCompletion: () => true };
  return originalLoad.call(this, request, parent, isMain);
};
const { replaceSlotInGroup } = require('../src/domain/groups/group-replacements');
Module._load = originalLoad;

test('league replacement inherits confirmed slot results and keeps future matches locked', () => {
  const oldSlot = { slot: 1, type: 'team', teamId: 'old', participantKey: 'team:old', displayName: 'Old' };
  const opponent = { slot: 2, type: 'team', teamId: 'opponent', participantKey: 'team:opponent', displayName: 'Opponent' };
  const replacement = { ...oldSlot, teamId: 'new', participantKey: 'team:new', displayName: 'New' };
  const confirmed = { status: 'confirmed', home: { ...oldSlot }, away: opponent, reports: [], result: { homeGoals: 2, awayGoals: 1 } };
  const future = { status: 'locked', home: { ...oldSlot }, away: opponent, reports: [], result: null };
  const group = { phaseType: 'league', slots: [oldSlot, opponent], matchdays: [{ matches: [confirmed] }, { matches: [future] }] };

  replaceSlotInGroup(group, oldSlot, replacement);

  assert.equal(confirmed.home.teamId, 'new');
  assert.deepEqual(confirmed.result, { homeGoals: 2, awayGoals: 1 });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(future.home.teamId, 'new');
  assert.equal(future.status, 'locked');
});

