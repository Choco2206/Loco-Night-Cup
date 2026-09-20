'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('module');

test('Bomber X Loco keeps 48 participants and displays later entries as an ordered waitlist', () => {
  const teamIds = Array.from({ length: 51 }, (_, index) => String(index + 1));
  const originalLoad = Module._load;

  Module._load = function load(request, parent, isMain) {
    if (request === '../teams/team-service' && parent?.filename.endsWith('bomber-x-loco-checkin.js')) {
      return { findTeamById: teamId => ({ id: String(teamId), clubName: `Team ${teamId}`, status: 'active', registrationStatus: 'complete' }) };
    }
    if (request === './checkin-format' && parent?.filename.endsWith('bomber-x-loco-checkin.js')) {
      return {
        getEntryTeamIds: event => event.checkin.entries.map(entry => String(entry.teamId)),
        getManualByeCount: event => (event.byes || []).filter(bye => bye.status === 'active').length,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const modulePath = require.resolve('../src/domain/checkins/bomber-x-loco-checkin');
  delete require.cache[modulePath];
  const { buildBomberXLocoPayload, getWaitlistIds } = require(modulePath);
  Module._load = originalLoad;

  const event = {
    status: 'checkin_open',
    cycle: { eventDate: '2026-09-25' },
    schedule: {
      deadlineAt: '2099-09-19T16:30:00.000Z',
      drawAt: '2099-09-19T17:00:00.000Z',
      tournamentStartAt: '2099-09-19T19:00:00.000Z',
    },
    format: { size: 48 },
    checkin: {
      isOpen: true,
      entries: teamIds.map(teamId => ({ teamId })),
      activeTeamIds: teamIds.slice(0, 48),
      waitlistTeamIds: teamIds.slice(48),
    },
  };

  assert.deepEqual(getWaitlistIds(event), ['49', '50', '51']);
  const payload = buildBomberXLocoPayload(event, {});
  const descriptions = payload.embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(descriptions, /Teilnehmerfeld: 48\/48 Plätze/);
  assert.match(descriptions, /Warteliste: 3 Teilnehmerplätze/);
  assert.match(descriptions, /1\. Team 49 \(WL\)/);
  assert.match(descriptions, /3\. Team 51 \(WL\)/);
});

test('Bomber X Loco promotes the 54er waitlist at 60 teams and starts a new waitlist at team 61', () => {
  const { buildBomberXLocoPayload, getWaitlistIds } = require('../src/domain/checkins/bomber-x-loco-checkin');
  const createEvent = count => {
    const teamIds = Array.from({ length: count }, (_, index) => String(index + 1));
    const size = count >= 60 ? 60 : 54;
    return {
      status: 'checkin_open',
      cycle: { eventDate: '2026-09-25' },
      schedule: {
        deadlineAt: '2099-09-25T16:30:00.000Z',
        drawAt: '2099-09-25T17:00:00.000Z',
        tournamentStartAt: '2099-09-25T19:00:00.000Z',
      },
      format: { size },
      checkin: {
        isOpen: true,
        entries: teamIds.map(teamId => ({ teamId })),
        activeTeamIds: teamIds.slice(0, size),
        waitlistTeamIds: teamIds.slice(size),
      },
      byes: [],
    };
  };

  const at57 = createEvent(57);
  assert.deepEqual(getWaitlistIds(at57), ['55', '56', '57']);
  const text57 = buildBomberXLocoPayload(at57, {}).embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(text57, /55\. Team 55 \(WL\)/);
  assert.match(text57, /57\. Team 57 \(WL\)/);

  const at60 = createEvent(60);
  assert.deepEqual(getWaitlistIds(at60), []);
  const text60 = buildBomberXLocoPayload(at60, {}).embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(text60, /Teilnehmerfeld: 60\/60 Plätze/);
  assert.doesNotMatch(text60, /Team 55 \(WL\)/);

  const at61 = createEvent(61);
  assert.deepEqual(getWaitlistIds(at61), ['61']);
  const text61 = buildBomberXLocoPayload(at61, {}).embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(text61, /Warteliste: 1 Teilnehmerplätze/);
  assert.match(text61, /1\. Team 61 \(WL\)/);
});

test('Bomber X Loco displays one manual bye as the 48th participant slot', () => {
  const teamIds = Array.from({ length: 47 }, (_, index) => String(index + 1));
  const { buildBomberXLocoPayload } = require('../src/domain/checkins/bomber-x-loco-checkin');
  const event = {
    status: 'checkin_open',
    cycle: { eventDate: '2026-09-25' },
    schedule: {
      deadlineAt: '2099-09-19T16:30:00.000Z',
      drawAt: '2099-09-19T17:00:00.000Z',
      tournamentStartAt: '2099-09-19T19:00:00.000Z',
    },
    format: { size: 48, activeByeCount: 1 },
    checkin: {
      isOpen: true,
      entries: teamIds.map(teamId => ({ teamId })),
      activeTeamIds: teamIds,
      waitlistTeamIds: [],
    },
    byes: [{ type: 'bye', status: 'active', id: 'bye_saturday_1' }],
  };

  const payload = buildBomberXLocoPayload(event, {});
  const descriptions = payload.embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(descriptions, /Aktuelles Format: 48er Turnier/);
  assert.match(descriptions, /Teilnehmerfeld: 48\/48 Plätze \(47 Teams \+ 1 Freilos\)/);
  assert.match(descriptions, /48\. Freilos/);
  assert.doesNotMatch(descriptions, /noch 1 erforderlich/);
});

test('Bomber X Loco marks teams as waitlisted after the bye is removed', () => {
  const teamIds = Array.from({ length: 47 }, (_, index) => String(index + 1));
  const { buildBomberXLocoPayload } = require('../src/domain/checkins/bomber-x-loco-checkin');
  const event = {
    status: 'checkin_open',
    cycle: { eventDate: '2026-09-25' },
    schedule: {
      deadlineAt: '2099-09-19T16:30:00.000Z',
      drawAt: '2099-09-19T17:00:00.000Z',
      tournamentStartAt: '2099-09-19T19:00:00.000Z',
    },
    format: { size: 42, activeByeCount: 0 },
    checkin: {
      isOpen: true,
      entries: teamIds.map(teamId => ({ teamId })),
      activeTeamIds: teamIds.slice(0, 42),
      waitlistTeamIds: teamIds.slice(42),
    },
    byes: [],
  };

  const payload = buildBomberXLocoPayload(event, {});
  const descriptions = payload.embeds.map(embed => embed.toJSON().description || '').join('\n');
  assert.match(descriptions, /42\. Team 42/);
  assert.doesNotMatch(descriptions, /42\. Team 42 \(WL\)/);
  assert.match(descriptions, /43\. Team 43 \(WL\)/);
  assert.match(descriptions, /47\. Team 47 \(WL\)/);
});
