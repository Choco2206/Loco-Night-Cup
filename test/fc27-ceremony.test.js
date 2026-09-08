'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const layout = require('../config/fc27-ceremony-layout');
const specialAwardsLayout = require('../config/special-awards-fc27-layout');
const championLayout = require('../config/power-ranking-champion-fc27-layout');
const { ROOT_DIR } = require('../src/storage');
const { DAYS, REQUIRED_TEAM_COUNT, buildFc27TestAwards, buildFc27TestChampion, spreadTeams, teamsForDay } = require('../src/domain/admin/fc27-ceremony-graphics-test');

test('FC 27 ceremony series defines one measured square slot per placement and day', () => {
  assert.equal(DAYS.length, 7);
  for (const dayKey of DAYS) {
    const day = layout.days[dayKey];
    assert.ok(day, `missing layout for ${dayKey}`);
    assert.ok(fs.existsSync(path.join(ROOT_DIR, day.template)), `missing template for ${dayKey}`);
    for (const placement of ['first', 'second', 'third']) {
      const slot = day.placements[placement];
      assert.ok(slot, `missing ${placement} slot for ${dayKey}`);
      assert.equal(slot.width, slot.height, `${dayKey} ${placement} slot must be square`);
      assert.ok(slot.centerX - slot.width / 2 >= 0);
      assert.ok(slot.centerX + slot.width / 2 <= layout.reference.width);
      assert.ok(slot.centerY - slot.height / 2 >= 0);
      assert.ok(slot.centerY + slot.height / 2 <= layout.reference.height);
    }
  }
});

test('FC 27 ceremony test assigns 21 different teams across the seven days', () => {
  const teams = Array.from({ length: 42 }, (_, index) => ({ id: `team-${index}`, clubName: `Team ${index}` }));
  const selected = spreadTeams(teams, REQUIRED_TEAM_COUNT);
  assert.equal(selected.length, 21);
  assert.equal(new Set(selected.map(team => team.id)).size, 21);
  const assigned = DAYS.flatMap((day, index) => Object.values(teamsForDay(selected, index)));
  assert.equal(new Set(assigned.map(team => team.id)).size, 21);
});

test('FC 27 Special Awards use eight measured slots and eight different test teams', () => {
  assert.deepEqual(specialAwardsLayout.reference, { width: 1536, height: 1024 });
  assert.ok(fs.existsSync(path.join(ROOT_DIR, specialAwardsLayout.template)));
  assert.deepEqual(specialAwardsLayout.awards.map(slot => slot.key).sort(), [
    'assists', 'averageRating', 'cleanSheets', 'goals',
    'manOfTheMatch', 'passesMade', 'saves', 'tacklesMade',
  ]);
  assert.ok(specialAwardsLayout.awards.every(slot => slot.logo.length === 6));
  const teams = Array.from({ length: 8 }, (_, index) => ({ id: `award-team-${index}` }));
  const awards = buildFc27TestAwards(teams);
  assert.equal(Object.keys(awards).length, 8);
  assert.equal(new Set(Object.values(awards).map(award => award.teamId)).size, 8);
});

test('FC 27 Power Ranking Champion uses separately measured dynamic fields', () => {
  assert.deepEqual(championLayout.reference, { width: 1254, height: 1254 });
  assert.ok(fs.existsSync(path.join(ROOT_DIR, championLayout.template)));
  const fields = [
    championLayout.logo,
    championLayout.teamName,
    championLayout.points,
    ...Object.values(championLayout.stats),
    championLayout.calendarWeek,
    championLayout.dateRange,
  ];
  for (const field of fields) {
    assert.ok(field.x >= 0 && field.y >= 0);
    assert.ok(field.x + field.width <= championLayout.reference.width);
    assert.ok(field.y + field.height <= championLayout.reference.height);
  }
  assert.deepEqual(buildFc27TestChampion({ id: 'team-27', clubName: 'FC Test 27' }), {
    teamId: 'team-27', teamName: 'FC Test 27', points: 50, wins: 3, finalAppearances: 5, cups: 7,
  });
});
