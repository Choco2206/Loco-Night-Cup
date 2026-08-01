'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

let storedEvent = null;
const originalLoad = Module._load;
const matchList = group => (group?.matchdays || []).flatMap(day => day.matches || []);

Module._load = function loadWithDeadlineMocks(request, parent, isMain) {
  if (request === '../../app/constants') {
    return { EVENT_KEYS: [], LEAGUE_PHASE_FORMATS: { 2: { matchdays: 1, matchesPerDay: 1, totalMatches: 1 } } };
  }
  if (request === '../../storage') return { FILES: {}, readJson: (_file, defaults) => defaults };
  if (request === '../../storage/defaults') return { createSettingsDefault: () => ({}) };
  if (request === '../checkins/checkin-schedule') return { getTournamentStartAt: () => new Date() };
  if (request === '../events/event-repository') {
    return {
      readEventData: () => storedEvent,
      updateEventData: (_eventKey, updater) => {
        storedEvent = updater(storedEvent);
        return storedEvent;
      },
    };
  }
  if (request === '../knockout/knockout-service') return { createKnockoutPhase: async () => true };
  if (request === './group-posts') return { refreshGroupPosts: async () => true };
  if (request === '../groups/group-results' || request === './group-results') {
    return {
      getMatches: matchList,
      getMatchSlot: match => Number(match.matchday),
      isMatchReleased: match => Boolean(match.release?.releasedAt),
      isRealMatch: match => match.home?.type === 'team' && match.away?.type === 'team',
      recalculateGroupStandings: group => { group.standingsRecalculated = true; },
      updateGroupCompletion: (event, group) => {
        if (matchList(group).every(match => match.status === 'confirmed')) group.status = 'completed';
        if (Object.values(event.groups?.groups || {}).every(entry => entry.status === 'completed')) event.groups.status = 'completed';
      },
    };
  }
  if (request === './group-message-cleanup' || request === '../groups/group-message-cleanup') {
    return { deleteUserMessagesFromGroupChannel: async () => true };
  }
  if (request === './league-phase-service') return { refreshLeaguePhasePosts: async () => true };
  if (request === './league-phase-results') return { getLeagueMatches: matchList };
  if (request === '../groups/group-roles') return { getConfiguredGuild: async () => null };
  return originalLoad.call(this, request, parent, isMain);
};

const groupReleases = require('../src/domain/groups/group-releases');
const leagueReleases = require('../src/domain/league-phase/league-phase-releases');
Module._load = originalLoad;

function realMatch(id, reports = []) {
  return {
    id,
    matchday: 1,
    status: 'open',
    home: { type: 'team', teamId: 'home' },
    away: { type: 'team', teamId: 'away' },
    reports,
    release: { slot: 1, releasedAt: '2026-08-01T22:00:00.000Z' },
  };
}

test('group deadline scores an entirely unreported match as 0:0', async () => {
  const match = realMatch('group-match');
  storedEvent = {
    schedule: { tournamentStartAt: '2026-08-01T22:00:00.000Z' },
    groups: {
      status: 'created',
      groups: { A: { groupKey: 'A', status: 'running', matchdays: [{ matches: [match] }] } },
      releases: { groups: { A: { currentSlot: 1, slots: { 1: { status: 'released', releasedAt: '2026-08-01T22:00:00.000Z', autoScoreAt: '2026-08-01T22:25:00.000Z' } } } } },
    },
    meta: {},
  };
  await groupReleases.applyAutoScores(null, 'monday', 'A', 1, new Date('2026-08-01T22:25:00.000Z'));
  assert.equal(match.status, 'confirmed');
  assert.deepEqual([match.result.homeGoals, match.result.awayGoals], [0, 0]);
  assert.equal(match.result.source, 'slot_timeout_0_0');
});

test('league deadline adopts one existing report and completes the matchday', async () => {
  const report = { participantKey: 'team:home', homeGoals: 2, awayGoals: 1, submittedByUserId: 'manager' };
  const match = realMatch('league-match', [report]);
  storedEvent = {
    leaguePhase: {
      phaseType: 'league', formatSize: 2, status: 'running', currentMatchday: 1,
      slots: [{}, {}], standings: [], messages: {},
      matchdays: [{ status: 'open', releasedAt: '2026-08-01T22:00:00.000Z', autoScoreAt: '2026-08-01T22:25:00.000Z', matches: [match] }],
    },
    knockout: { status: 'not_created' }, meta: {},
  };
  await leagueReleases.applyLeagueMatchdayDeadline(null, 'monday', 1, new Date('2026-08-01T22:25:00.000Z'));
  assert.equal(match.status, 'confirmed');
  assert.deepEqual([match.result.homeGoals, match.result.awayGoals], [2, 1]);
  assert.equal(match.result.source, 'matchday_timeout_report');
  assert.equal(storedEvent.leaguePhase.status, 'completed');
});

