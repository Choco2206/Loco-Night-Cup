'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const layout = require('../config/fc27-ceremony-layout');
const { ROOT_DIR } = require('../src/storage');
const { DAYS, REQUIRED_TEAM_COUNT, spreadTeams, teamsForDay } = require('../src/domain/admin/fc27-ceremony-graphics-test');

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
