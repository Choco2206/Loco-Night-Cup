'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

let storedEvent = null;
const originalLoad = Module._load;
Module._load = function loadWithResultMocks(request, parent, isMain) {
  if (request === '../events/event-repository') {
    return {
      updateEventData: (_eventKey, updater) => {
        storedEvent = updater(storedEvent);
        return storedEvent;
      },
    };
  }
  if (request === '../teams/team-service') {
    return {
      findTeamById: teamId => ({ id: teamId, clubName: `Team ${teamId}` }),
      isTeamMember: (team, userId) => String(team?.id) === String(userId).replace('user-', ''),
    };
  }
  if (request === './group-ranking') return { rankGroupRows: rows => rows };
  return originalLoad.call(this, request, parent, isMain);
};

const groupResults = require('../src/domain/groups/group-results');
const knockoutResults = require('../src/domain/knockout/knockout-results');
Module._load = originalLoad;

function participant(teamId) {
  return { type: 'team', teamId, participantKey: `team:${teamId}`, displayName: `Team ${teamId}` };
}

test('group and league results use the first report after the two-minute deadline', () => {
  const match = {
    id: 'group-match', matchday: 1, status: 'open', release: { releasedAt: new Date().toISOString() },
    home: participant('home'), away: participant('away'), reports: [], result: null,
  };
  const group = { groupKey: 'A', slots: [match.home, match.away], matchdays: [{ matches: [match] }], standings: [] };
  storedEvent = { groups: { status: 'created', groups: { A: group } }, meta: {} };

  const pending = groupResults.submitTeamResult({
    eventKey: 'monday', groupKey: 'A', matchId: match.id, participantKeyValue: 'team:home',
    userId: 'user-home', homeGoals: 2, awayGoals: 1,
  });
  assert.equal(pending.status, 'pending_confirmation');
  const afterDeadline = new Date(new Date(pending.match.confirmation.expiresAt).getTime() + 1);
  const confirmed = groupResults.autoConfirmFirstReport({ eventKey: 'monday', groupKey: 'A', matchId: match.id, now: afterDeadline });
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual([confirmed.match.result.homeGoals, confirmed.match.result.awayGoals], [2, 1]);
  assert.equal(confirmed.match.result.source, 'team_timeout');
});

test('knockout result stays pending because K.O. rounds are never auto-scored', () => {
  const match = {
    id: 'ko-match', status: 'open', home: participant('home'), away: participant('away'),
    reports: [], result: null, next: null, loserNext: null,
  };
  storedEvent = {
    knockout: { status: 'running', rounds: { final: { status: 'open', matches: [match] } } },
    ceremony: { status: 'not_ready', placements: {} }, meta: {},
  };
  const pending = knockoutResults.submitTeamResult({
    eventKey: 'monday', roundKey: 'final', matchId: match.id, participantKeyValue: 'team:home',
    userId: 'user-home', homeGoals: 3, awayGoals: 1,
  });
  assert.equal(pending.status, 'pending_confirmation');
  assert.equal(pending.match.confirmation.expiresAt, null);
  assert.equal(pending.match.result, null);
});

test('preserves the opponent reminder reference when the second team confirms', () => {
  const match = {
    id: 'notice-match', matchday: 1, status: 'open', release: { releasedAt: new Date().toISOString() },
    home: participant('home'), away: participant('away'), reports: [], result: null,
  };
  const group = { groupKey: 'A', slots: [match.home, match.away], matchdays: [{ matches: [match] }], standings: [] };
  storedEvent = { groups: { status: 'created', groups: { A: group } }, meta: {} };
  groupResults.submitTeamResult({
    eventKey: 'monday', groupKey: 'A', matchId: match.id, participantKeyValue: 'team:home',
    userId: 'user-home', homeGoals: '2', awayGoals: '0',
  });
  match.confirmation.notificationMessageId = 'notice-1';
  match.confirmation.channelId = 'channel-1';
  const confirmed = groupResults.submitTeamResult({
    eventKey: 'monday', groupKey: 'A', matchId: match.id, participantKeyValue: 'team:away',
    userId: 'user-away', homeGoals: '2', awayGoals: '0',
  });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.confirmationNotice.notificationMessageId, 'notice-1');
  assert.equal(confirmed.confirmationNotice.channelId, 'channel-1');
});

test('admin result selection includes completed matchdays in groups and league phase', () => {
  const first = {
    id: 'day-1', matchday: 1, status: 'confirmed',
    home: participant('home'), away: participant('away'), reports: [],
    result: { homeGoals: 0, awayGoals: 0, source: 'matchday_timeout_0_0' },
  };
  const second = {
    id: 'day-2', matchday: 2, status: 'locked',
    home: participant('home'), away: participant('away'), reports: [], result: null,
  };
  const league = {
    phaseType: 'league', currentMatchday: 2,
    slots: [first.home, first.away],
    matchdays: [{ matches: [first] }, { matches: [second] }],
    standings: [],
  };

  assert.deepEqual(
    groupResults.getAdminSelectableMatchdays(league).map(entry => entry.matchday),
    [1, 2]
  );
  assert.deepEqual(
    groupResults.getAdminSelectableMatches(league).map(match => match.id),
    ['day-1', 'day-2']
  );
});

