'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

let storedEvent = null;
let cleanupCalls = [];
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
    return {
      deleteTransientMessagesFromGroupChannel: async (_client, phase) => { cleanupCalls.push(['results', phase.resultsChannelId]); },
      deleteTransientMessagesFromLeagueOverview: async (_client, phase) => { cleanupCalls.push(['overview', phase.overviewChannelId]); },
      deleteUserMessagesFromGroupChannel: async () => true,
    };
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

test('group deadline preserves the first submitted score even if the reports array was lost', async () => {
  const match = realMatch('group-first-report');
  match.firstReportedResult = { participantKey: 'team:home', homeGoals: 4, awayGoals: 2, submittedByUserId: 'manager' };
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
  assert.deepEqual([match.result.homeGoals, match.result.awayGoals], [4, 2]);
  assert.equal(match.result.source, 'slot_timeout_report');
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

test('repairs an interrupted league matchday without replacing its fixtures', async () => {
  const match = realMatch('league-recovery');
  match.status = 'locked';
  match.release.releasedAt = null;
  storedEvent = {
    leaguePhase: {
      phaseType: 'league', formatSize: 2, status: 'running', currentMatchday: 1,
      slots: [{}, {}], standings: [], messages: {},
      matchdays: [{ status: 'locked', releasedAt: null, autoScoreAt: null, matches: [match] }],
    },
    knockout: { status: 'not_created' }, meta: {},
  };
  const repaired = await leagueReleases.reconcileLeagueMatchday(null, 'monday', new Date('2026-08-01T22:10:00.000Z'));
  assert.equal(repaired, true);
  assert.equal(storedEvent.leaguePhase.currentMatchday, 1);
  assert.equal(storedEvent.leaguePhase.matchdays[0].status, 'open');
  assert.equal(match.status, 'open');
  assert.equal(match.release.slot, 1);
  assert.equal(storedEvent.leaguePhase.matchdays[0].autoScoreAt, '2026-08-01T22:35:00.000Z');
});

test('does not release league matchday one early during startup recovery', async () => {
  const match = realMatch('league-not-yet-started');
  match.status = 'locked';
  match.release.releasedAt = null;
  storedEvent = {
    schedule: { tournamentStartAt: '2026-08-01T23:00:00.000Z' },
    leaguePhase: {
      phaseType: 'league', formatSize: 2, status: 'running', currentMatchday: 0,
      slots: [{}, {}], standings: [], messages: {},
      matchdays: [{ status: 'locked', releasedAt: null, autoScoreAt: null, matches: [match] }],
    },
    knockout: { status: 'not_created' }, meta: {},
  };
  const released = await leagueReleases.reconcileLeagueMatchday(null, 'monday', new Date('2026-08-01T22:00:00.000Z'));
  assert.equal(released, false);
  assert.equal(storedEvent.leaguePhase.currentMatchday, 0);
  assert.equal(storedEvent.leaguePhase.matchdays[0].status, 'locked');
  assert.equal(match.status, 'locked');
});

test('posts league release with invitation window in the main league channel', async () => {
  const match = realMatch('league-release-message');
  match.status = 'locked';
  match.release.releasedAt = null;
  let sentPayload = null;
  cleanupCalls = [];
  const requestedChannels = [];
  const channel = {
    messages: { fetch: async () => null },
    send: async payload => { sentPayload = payload; return { id: 'release-message' }; },
  };
  const client = { channels: { fetch: async id => { requestedChannels.push(id); return channel; } } };
  storedEvent = {
    leaguePhase: {
      phaseType: 'league', formatSize: 2, status: 'running', currentMatchday: 0,
      overviewChannelId: 'league-main', resultsChannelId: 'league-results',
      slots: [{}, {}], standings: [], messages: {},
      matchdays: [{ status: 'locked', releasedAt: null, autoScoreAt: null, matches: [match] }],
    },
    knockout: { status: 'not_created' }, meta: {},
  };
  const released = await leagueReleases.releaseLeagueMatchday(client, 'monday', 1, new Date('2026-08-01T22:00:00.000Z'));
  assert.equal(released, true);
  assert.equal(requestedChannels[0], 'league-main');
  assert.match(sentPayload.content, /Spieltag 1 ist freigegeben/);
  assert.match(sentPayload.content, /00:00.*00:05 Uhr: Zeit zum Einladen/);
  assert.match(sentPayload.content, /Bitte tragt beide das Ergebnis unverz\u00FCglich nach dem Spiel ein/);
  assert.doesNotMatch(sentPayload.content, /Alle Begegnungen dieses Spieltags/);
  assert.deepEqual(cleanupCalls, [['results', 'league-results'], ['overview', 'league-main']]);
});

