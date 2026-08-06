'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  INTERNAL_CHANNEL_ID,
  assignmentComponents,
  availabilityComponents,
  balancedGroupAssignments,
  createCycleState,
  dateTitle,
  infoEmbed,
} = require('../src/domain/tournament-leadership');
const { toDateOnly } = require('../src/domain/checkins/checkin-schedule');

test('exports the Berlin date helper required by startup reconciliation', () => {
  assert.equal(typeof toDateOnly, 'function');
  assert.equal(toDateOnly(new Date('2026-08-05T22:30:00.000Z'), 'Europe/Berlin'), '2026-08-06');
});

test('uses the configured internal tournament-leadership channel', () => {
  assert.equal(INTERNAL_CHANNEL_ID, '1534523164783280158');
});

test('info embeds always link the configured rulebook channel', () => {
  const embed = infoEmbed('Gruppe A', ['123'], { channels: { rulebookChannelId: '1517040886007992452' } }).toJSON();
  assert.equal(embed.fields.find(field => field.name === 'Regelwerk').value, '<#1517040886007992452>');
});

test('KO info uses one shared phase channel and no recurring channel ordering', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/domain/tournament-leadership/tournament-leadership-service'), 'utf8');
  assert.match(source, /name: 'nightcup-info-ko-phase'/);
  assert.match(source, /withLock\(`info:\$\{state\.cycleKey\}`/);
  assert.doesNotMatch(source, /async function orderChannels/);
});

test('formats a German weekday and short date', () => {
  assert.equal(dateTitle('2026-08-05'), 'Mittwoch, 05.08.26');
});

test('creates restart-safe initial state for one event cycle', () => {
  const state = createCycleState('wednesday', '2026-08-05', 'wednesday_2026-08-05', '2026-08-05T20:00:00.000Z');
  assert.equal(state.status, 'active');
  assert.equal(state.availability.status, 'open');
  assert.equal(state.assignment.status, 'not_created');
  assert.deepEqual(state.infoChannels, { groups: {}, league: null, knockout: null });
});

test('availability exposes exactly one yes and one no button', () => {
  const state = createCycleState('wednesday', '2026-08-05', 'cycle', '2026-08-05T20:00:00.000Z');
  const json = availabilityComponents(state)[0].toJSON();
  assert.deepEqual(json.components.map(button => button.label), ['Ja', 'Nein']);
  assert.deepEqual(json.components.map(button => button.custom_id), ['tl_availability:cycle:yes', 'tl_availability:cycle:no']);
});

test('closed availability disables both buttons', () => {
  const state = createCycleState('wednesday', '2026-08-05', 'cycle', '2026-08-05T20:00:00.000Z');
  state.availability.status = 'closed';
  assert.ok(availabilityComponents(state)[0].toJSON().components.every(button => button.disabled));
});

test('group assignment creates dynamic group buttons plus one KO button', () => {
  const state = createCycleState('wednesday', '2026-08-05', 'cycle', '2026-08-05T20:00:00.000Z');
  state.assignment = { ...state.assignment, status: 'active', type: 'groups' };
  const event = { groups: { groups: { A: {}, B: {}, C: {}, D: {}, E: {}, F: {} } } };
  const rows = assignmentComponents(state, event).map(row => row.toJSON());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.flatMap(row => row.components).map(button => button.label), ['Gruppe A', 'Gruppe B', 'Gruppe C', 'Gruppe D', 'Gruppe E', 'Gruppe F', 'K.O.-Phase']);
});

test('league assignment combines league and KO in one message', () => {
  const state = createCycleState('wednesday', '2026-08-05', 'cycle', '2026-08-05T20:00:00.000Z');
  state.assignment = { ...state.assignment, status: 'active', type: 'league' };
  const buttons = assignmentComponents(state, {}).flatMap(row => row.toJSON().components);
  assert.deepEqual(buttons.map(button => button.label), ['Liga', 'K.O.-Phase']);
});

test('locked assignment disables every assignment button', () => {
  const state = createCycleState('wednesday', '2026-08-05', 'cycle', '2026-08-05T20:00:00.000Z');
  state.assignment = { ...state.assignment, status: 'locked', type: 'league' };
  assert.ok(assignmentComponents(state, {}).flatMap(row => row.toJSON().components).every(button => button.disabled));
});

test('automatic group assignment distributes groups evenly', () => {
  const assigned = balancedGroupAssignments(['A', 'B', 'C', 'D', 'E'], {}, ['10', '20']);
  const counts = Object.values(assigned).reduce((result, id) => ({ ...result, [id]: (result[id] || 0) + 1 }), {});
  assert.equal(Object.keys(assigned).length, 5);
  assert.equal(Math.abs(counts['10'] - counts['20']), 1);
});

test('automatic group assignment preserves manual choices', () => {
  const assigned = balancedGroupAssignments(['A', 'B', 'C'], { A: '99' }, ['10', '20', '99']);
  assert.equal(assigned.A, '99');
  assert.equal(Object.keys(assigned).length, 3);
});

test('automatic group assignment leaves areas open without eligible users', () => {
  assert.deepEqual(balancedGroupAssignments(['A', 'B'], {}, []), {});
});
