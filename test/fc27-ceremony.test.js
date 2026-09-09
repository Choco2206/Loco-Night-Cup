'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const layout = require('../config/fc27-ceremony-layout');
const specialAwardsLayout = require('../config/special-awards-fc27-layout');
const championLayout = require('../config/power-ranking-champion-fc27-layout');
const liveTableLayout = require('../config/live-table-fc27-layout');
const groupScheduleLayout = require('../config/group-schedule-fc27-layout');
const koLayout = require('../config/ko-image-layouts-fc27');
const { ROOT_DIR } = require('../src/storage');
const { getKoLayout } = require('../utils/ko-image-renderer');
const { TEMPLATE: KO_PROGRESSION_TEMPLATE, TEMPLATE_4: KO_PROGRESSION_4_TEMPLATE, TEMPLATE_8: KO_PROGRESSION_8_TEMPLATE, renderKoProgression4, renderKoProgression8, renderKoProgression16 } = require('../utils/ko-progression-renderer');
const { loadCanvasImage } = require('../utils/canvas-image-loader');
const { TEST_VARIANTS } = require('../src/domain/knockout/knockout-image-test');
const { DAYS, REQUIRED_TEAM_COUNT, buildFc27TestAwards, buildFc27TestChampion, buildFc27TestGroup, buildFc27KoMatches, buildFc27ProgressionRounds, buildFc27Progression4Rounds, buildFc27Progression8Rounds, spreadTeams, teamsForDay } = require('../src/domain/admin/fc27-ceremony-graphics-test');

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
  assert.equal(specialAwardsLayout.awards.find(slot => slot.key === 'averageRating').logo[1][0], 634);
  for (const key of ['assists', 'saves', 'passesMade']) {
    const xs = specialAwardsLayout.awards.find(slot => slot.key === key).logo.map(([x]) => x);
    assert.equal(Math.min(...xs), 1145);
    assert.equal(Math.max(...xs), 1256);
  }
  const teams = Array.from({ length: 8 }, (_, index) => ({ id: `award-team-${index}` }));
  const awards = buildFc27TestAwards(teams);
  assert.equal(Object.keys(awards).length, 8);
  assert.equal(new Set(Object.values(awards).map(award => award.teamId)).size, 8);
});

test('canvas image loader normalizes a JPEG when the direct decoder rejects it', async () => {
  let calls = 0;
  const canvasApi = {
    async loadImage(source) {
      calls += 1;
      if (calls === 1) throw new Error('Unsupported marker type 0x77');
      assert.ok(Buffer.isBuffer(source));
      return { width: 1536, height: 1024 };
    },
  };
  const image = await loadCanvasImage(canvasApi, path.join(ROOT_DIR, specialAwardsLayout.template));
  assert.deepEqual(image, { width: 1536, height: 1024 });
  assert.equal(calls, 2);
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

test('FC 27 live table uses four measured rows and separate group and qualification fields', () => {
  assert.deepEqual(liveTableLayout.reference, { width: 1672, height: 941 });
  assert.ok(fs.existsSync(path.join(ROOT_DIR, liveTableLayout.template)));
  assert.equal(liveTableLayout.rowY.length, 4);
  assert.ok(liveTableLayout.groupName.maxWidth > 0);
  assert.ok(liveTableLayout.qualification.maxWidth > liveTableLayout.groupName.maxWidth);
  assert.ok(liveTableLayout.rowY.every(y => y > 0 && y < liveTableLayout.reference.height));
});

test('FC 27 matches use three matchdays with two measured encounters each', () => {
  assert.deepEqual(groupScheduleLayout.reference, { width: 1024, height: 1536 });
  assert.ok(fs.existsSync(path.join(ROOT_DIR, groupScheduleLayout.template)));
  assert.equal(groupScheduleLayout.rows.length, 6);
  for (const row of groupScheduleLayout.rows) {
    assert.equal(row.leftLogo.width, row.leftLogo.height);
    assert.equal(row.rightLogo.width, row.rightLogo.height);
    assert.equal(row.leftLogo.width, row.rightLogo.width);
  }
  const teams = Array.from({ length: 4 }, (_, index) => ({ id: `match-team-${index}`, clubName: `Match Team ${index}` }));
  const group = buildFc27TestGroup(teams);
  assert.equal(group.matchdays.length, 3);
  assert.ok(group.matchdays.every(day => day.matches.length === 2));
  assert.equal(new Set(group.matchdays.flatMap(day => day.matches).flatMap(match => [match.home.teamId, match.away.teamId])).size, 4);
});

test('FC 27 K.O. series contains eight separately measured inactive templates', () => {
  const expectedCounts = {
    qualification_4: 4,
    qualification_8: 8,
    qualification_16: 16,
    round_of_16: 8,
    quarter_final: 4,
    semi_final: 2,
    third_place: 1,
    final: 1,
  };
  for (const [key, count] of Object.entries(expectedCounts)) {
    const selected = koLayout[key];
    assert.ok(fs.existsSync(path.join(ROOT_DIR, selected.template)), `missing FC 27 K.O. template for ${key}`);
    assert.deepEqual(selected.reference, key.startsWith('qualification_')
      ? { width: 1536, height: 1024 }
      : { width: 1024, height: 1536 });
    assert.equal((selected.slots || selected.matches).length, count);
    const resolved = getKoLayout({
      phase: key.startsWith('qualification_') ? 'qualification_overview' : key,
      qualifiedTeamCount: key.startsWith('qualification_') ? count : 0,
      variant: 'fc27',
    });
    assert.equal(resolved.layout.template, selected.template);
    assert.ok(TEST_VARIANTS[`fc27_${key}`]);
  }
});

test('FC 27 K.O. test matches use registered team-shaped participants and confirmed scores', () => {
  const teams = Array.from({ length: 16 }, (_, index) => ({ id: `ko-team-${index}`, clubName: `K.O. Team ${index}` }));
  const matches = buildFc27KoMatches(teams, 8);
  assert.equal(matches.length, 8);
  assert.equal(new Set(matches.flatMap(match => [match.home.teamId, match.away.teamId])).size, 16);
  assert.ok(matches.every(match => match.status === 'confirmed' && match.result));
});

test('FC 27 Road to Glory renders all 16 teams, results and the serial number dynamically', async () => {
  const teams = Array.from({ length: 16 }, (_, index) => ({ id: `progression-team-${index}`, clubName: `Progression Team ${index}` }));
  const rounds = buildFc27ProgressionRounds(teams);
  assert.equal(rounds.round_of_16.matches.length, 8);
  assert.equal(rounds.quarter_final.matches.length, 4);
  assert.equal(rounds.semi_final.matches.length, 2);
  assert.equal(rounds.final.matches.length, 1);
  assert.equal(rounds.third_place.matches.length, 1);
  assert.ok(fs.existsSync(path.join(ROOT_DIR, KO_PROGRESSION_TEMPLATE)));
  const rendered = await renderKoProgression16({ rounds, serialNumber: 27, eventId: 'fc27-test', version: 1 });
  assert.equal(rendered.width, 1792);
  assert.equal(rendered.height, 1344);
  assert.ok(rendered.buffer.length > 100000);
  assert.equal(rendered.template, KO_PROGRESSION_TEMPLATE);
});

test('FC 27 Road to Glory renders the 8-team quarter-final variant dynamically', async () => {
  const teams = Array.from({ length: 8 }, (_, index) => ({ id: `progression-8-team-${index}`, clubName: `Quarter Team ${index}` }));
  const rounds = buildFc27Progression8Rounds(teams);
  assert.equal(rounds.quarter_final.matches.length, 4);
  assert.equal(rounds.semi_final.matches.length, 2);
  assert.equal(rounds.final.matches.length, 1);
  assert.equal(rounds.third_place.matches.length, 1);
  assert.ok(fs.existsSync(path.join(ROOT_DIR, KO_PROGRESSION_8_TEMPLATE)));
  const rendered = await renderKoProgression8({ rounds, serialNumber: 27, eventId: 'fc27-quarter-test', version: 1 });
  assert.equal(rendered.width, 1792);
  assert.equal(rendered.height, 1344);
  assert.ok(rendered.buffer.length > 100000);
  assert.equal(rendered.template, KO_PROGRESSION_8_TEMPLATE);
});

test('FC 27 Road to Glory renders the 4-team semi-final variant dynamically', async () => {
  const teams = Array.from({ length: 4 }, (_, index) => ({ id: `progression-4-team-${index}`, clubName: `Semi Team ${index}` }));
  const rounds = buildFc27Progression4Rounds(teams);
  assert.equal(rounds.semi_final.matches.length, 2);
  assert.equal(rounds.final.matches.length, 1);
  assert.equal(rounds.third_place.matches.length, 1);
  assert.ok(fs.existsSync(path.join(ROOT_DIR, KO_PROGRESSION_4_TEMPLATE)));
  const rendered = await renderKoProgression4({ rounds, serialNumber: 27, eventId: 'fc27-semi-test', version: 1 });
  assert.equal(rendered.width, 1792);
  assert.equal(rendered.height, 1344);
  assert.ok(rendered.buffer.length > 100000);
  assert.equal(rendered.template, KO_PROGRESSION_4_TEMPLATE);
});

test('FC 27 elimination-round logos use the individually measured logo fields', () => {
  assert.deepEqual(koLayout.round_of_16.matches[0].home.logo, {
    centerX: 76, centerY: 522, width: 70, height: 70,
  });
  assert.deepEqual(koLayout.round_of_16.matches[0].away.logo, {
    centerX: 949, centerY: 522, width: 70, height: 70,
  });

  const expectedCenters = {
    quarter_final: [554, 719, 881, 1040],
    semi_final: [614, 813],
    third_place: [555],
    final: [724],
  };
  for (const [key, centers] of Object.entries(expectedCenters)) {
    const match = koLayout[key].matches[0];
    assert.equal(match.home.logo.centerX, 85);
    assert.equal(match.away.logo.centerX, 939);
    assert.deepEqual(koLayout[key].matches.map(row => row.home.logo.centerY), centers);
    assert.deepEqual(koLayout[key].matches.map(row => row.away.logo.centerY), centers);
  }
});
