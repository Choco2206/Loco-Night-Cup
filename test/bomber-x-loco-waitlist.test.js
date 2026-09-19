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
      return { getEntryTeamIds: event => event.checkin.entries.map(entry => String(entry.teamId)) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const modulePath = require.resolve('../src/domain/checkins/bomber-x-loco-checkin');
  delete require.cache[modulePath];
  const { buildBomberXLocoPayload, getWaitlistIds } = require(modulePath);
  Module._load = originalLoad;

  const event = {
    status: 'checkin_open',
    cycle: { eventDate: '2026-09-19' },
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
  assert.match(descriptions, /Teilnehmerfeld: 48\/48 Teams/);
  assert.match(descriptions, /Warteliste: 3 Teams/);
  assert.match(descriptions, /1\. Team 49/);
  assert.match(descriptions, /3\. Team 51/);
});
