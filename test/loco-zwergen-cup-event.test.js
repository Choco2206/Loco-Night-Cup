'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSettingsDefault, createEventDefault } = require('../src/storage/defaults');
const { getPlannedSchedule } = require('../src/domain/checkins/checkin-schedule');
const {
  LOCO_ZWERGEN_CUP_FORMAT_SIZES,
  getLocoZwergenCupFormat,
  isLocoZwergenCupDate,
  isLocoZwergenCupEvent,
} = require('../src/domain/events/loco-zwergen-cup-config');
const { GROUP_KEYS } = require('../src/app/constants');
const { createGroups } = require('../src/domain/groups/group-draw');
const { qualifyTeams } = require('../src/domain/knockout/knockout-qualification');
const { buildKnockoutRounds } = require('../src/domain/knockout/knockout-bracket');
const { getAllowedSizes } = require('../src/domain/checkins/checkin-format');
const { getQualificationText } = require('../src/domain/groups/group-embeds');
const { validateEvent } = require('../src/validation/events.schema');

test('Loco Zwergen Cup is isolated to Saturday 12 September 2026', () => {
  assert.equal(isLocoZwergenCupDate('saturday', '2026-09-12'), true);
  assert.equal(isLocoZwergenCupDate('friday', '2026-09-12'), false);
  assert.equal(isLocoZwergenCupDate('saturday', '2026-09-19'), false);
  assert.equal(isLocoZwergenCupEvent({ meta: { eventMode: 'loco_zwergen_cup' } }), true);
});

test('schedule selects Zwergen, Bomber and normal Saturday independently', () => {
  const settings = createSettingsDefault();
  const event = createEventDefault('saturday');
  event.cycle = { eventDate: '2026-09-12', timezone: 'Europe/Berlin' };
  assert.equal(getPlannedSchedule('saturday', event, settings, new Date('2026-09-12T10:00:00Z')).eventMode, 'loco_zwergen_cup');
  event.cycle.eventDate = '2026-09-19';
  assert.equal(getPlannedSchedule('saturday', event, settings, new Date('2026-09-19T10:00:00Z')).eventMode, 'bomber_x_loco');
  event.cycle.eventDate = '2026-09-26';
  assert.equal(getPlannedSchedule('saturday', event, settings, new Date('2026-09-26T10:00:00Z')).eventMode, 'night_cup');
});

test('Zwergen Cup alone supports 36, 40, 44 and 48 teams', () => {
  assert.deepEqual(LOCO_ZWERGEN_CUP_FORMAT_SIZES.slice(-4), [36, 40, 44, 48]);
  assert.deepEqual(GROUP_KEYS.slice(-4), ['I', 'J', 'K', 'L']);

  const expected = {
    36: { groups: 9, thirds: 9, fourths: 5 },
    40: { groups: 10, thirds: 10, fourths: 2 },
    44: { groups: 11, thirds: 10, fourths: 0 },
    48: { groups: 12, thirds: 8, fourths: 0 },
  };
  for (const [size, values] of Object.entries(expected)) {
    const format = getLocoZwergenCupFormat(size);
    assert.equal(format.groupCount, values.groups);
    assert.equal(format.qualifiedCount, 32);
    assert.equal(format.bestThirds, values.thirds);
    assert.equal(format.bestFourths, values.fourths);
    assert.equal(format.firstRoundKey, 'round_of_32');
    assert.equal((format.groupCount * 2) + format.bestThirds + format.bestFourths, 32);
  }
});

test('expanded sizes do not change normal Night Cup or Bomber X Loco formats', () => {
  const settings = createSettingsDefault();
  const normalSizes = getAllowedSizes(settings, { meta: { eventMode: 'night_cup' } });
  const zwergenSizes = getAllowedSizes(settings, { meta: { eventMode: 'loco_zwergen_cup' } });
  const bomberSizes = getAllowedSizes(settings, { meta: { eventMode: 'bomber_x_loco' } });
  assert.equal(Math.max(...normalSizes), 32);
  assert.equal(Math.max(...zwergenSizes), 48);
  assert.deepEqual(bomberSizes, [6, 12, 18, 24, 30, 36, 42, 48]);
});

test('startup validation accepts a running 44-team Zwergen Cup before schedule sync', () => {
  const event = createEventDefault('saturday');
  event.cycle.eventDate = '2026-09-12';
  event.meta.eventMode = 'loco_zwergen_cup';
  event.format.size = 44;

  assert.deepEqual(validateEvent(event, 'saturday'), []);

  event.format.allowedSizes = [...LOCO_ZWERGEN_CUP_FORMAT_SIZES];
  assert.deepEqual(validateEvent(event, 'saturday'), []);
});

test('group posts explain every expanded Zwergen qualification rule correctly', () => {
  assert.equal(getQualificationText(36), '🏆 Weiterkommen: Platz 1 & 2 + die 9 besten Drittplatzierten + die 5 besten Viertplatzierten');
  assert.equal(getQualificationText(40), '🏆 Weiterkommen: Platz 1 & 2 + die 10 besten Drittplatzierten + die 2 besten Viertplatzierten');
  assert.equal(getQualificationText(44), '🏆 Weiterkommen: Platz 1 & 2 + die 10 besten Drittplatzierten');
  assert.equal(getQualificationText(48), '🏆 Weiterkommen: Platz 1 & 2 + die 8 besten Drittplatzierten');
  assert.equal(getQualificationText(32), '🏆 Weiterkommen: Platz 1 & 2');
});

test('48 team Zwergen field creates twelve complete groups A to L', () => {
  const participants = Array.from({ length: 48 }, (_, index) => ({
    type: 'team', teamId: `team-${index + 1}`, displayName: `Team ${index + 1}`,
  }));
  const groups = createGroups({
    eventKey: 'saturday', eventMode: 'loco_zwergen_cup',
    field: { groupCount: 12, participants },
    settings: { roles: { groupRoleIds: {} }, channels: { groupChannelIds: {} } },
    createdAt: '2026-09-12T22:00:00.000Z',
  });
  assert.deepEqual(Object.keys(groups), GROUP_KEYS);
  for (const group of Object.values(groups)) {
    assert.equal(group.slots.length, 4);
    assert.equal(group.matchdays.flatMap(day => day.matches).length, 6);
  }
});

test('every expanded format keeps all group winners and runners-up and creates a round of 32', () => {
  for (const size of [36, 40, 44, 48]) {
    const format = getLocoZwergenCupFormat(size);
    const groups = {};
    for (const groupKey of GROUP_KEYS.slice(0, format.groupCount)) {
      const slots = Array.from({ length: 4 }, (_, index) => ({
        slot: index + 1,
        participantKey: `team:${size}-${groupKey}-${index + 1}`,
        type: 'team',
        teamId: `${size}-${groupKey}-${index + 1}`,
        displayName: `Team ${size}-${groupKey}-${index + 1}`,
      }));
      groups[groupKey] = { groupKey, status: 'completed', slots, standings: [], matchdays: [] };
    }
    const event = {
      meta: { eventMode: 'loco_zwergen_cup' },
      format: { size },
      groups: { status: 'completed', groups },
    };
    const qualification = qualifyTeams(event);
    assert.equal(qualification.qualifiedTeams.length, 32);
    assert.equal(qualification.qualifiedTeams.filter(team => team.groupRank === 1).length, format.groupCount);
    assert.equal(qualification.qualifiedTeams.filter(team => team.groupRank === 2).length, format.groupCount);

    const bracket = buildKnockoutRounds({
      eventKey: 'saturday', qualifiedTeams: qualification.qualifiedTeams,
      createdAt: '2026-09-12T23:00:00.000Z',
    });
    assert.equal(bracket.firstRoundKey, 'round_of_32');
    assert.equal(bracket.rounds.round_of_32.matches.length, 16);
    assert.equal(bracket.rounds.round_of_16.matches.length, 8);
  }
});
