'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { applyReplacement } = require('../src/domain/checkins/halloween-replacement-service');
const { createEventDefault, createSettingsDefault } = require('../src/storage/defaults');
const { ensureEventCycle } = require('../src/domain/checkins/checkin-schedule');
const { attendanceCloseAt } = require('../src/domain/groups/attendance-service');
const { buildBomberXLocoPayload, buildBomberXLocoBlockerPayload } = require('../src/domain/checkins/bomber-x-loco-checkin');
const now = new Date('2026-10-30T18:00:00Z');
function eventFixture() {
  const event = createEventDefault('bomber_halloween');
  ensureEventCycle('bomber_halloween', event, createSettingsDefault(), now);
  event.status = 'draw_ready';
  event.format = { ...event.format, size: 6, lockedAt: '2026-10-30T17:30:00Z', participants: ['old', 'stay'].map(teamId => ({ type: 'team', teamId, displayName: teamId })), activeByeCount: 0 };
  event.checkin = { ...event.checkin, isOpen: false, entries: ['old', 'stay', 'next', 'last'].map(teamId => ({ teamId, checkedInAt: '2026-10-29T12:00:00Z' })), activeTeamIds: ['old', 'stay'], waitlistTeamIds: ['next', 'last'] };
  return event;
}
const args = { oldTeamId: 'old', newTeam: { id: 'next', clubName: 'Nachrücker' }, actorUserId: 'admin', now };

test('Halloween exchange keeps lock, size and byes, removes outgoing entry and promotes selected waitlist team without ban', () => {
  const event = eventFixture();
  const formatBefore = { size: event.format.size, lockedAt: event.format.lockedAt, activeByeCount: event.format.activeByeCount };
  applyReplacement(event, args);
  assert.deepEqual(event.checkin.activeTeamIds, ['next', 'stay']);
  assert.deepEqual(event.checkin.waitlistTeamIds, ['last']);
  assert.deepEqual(event.checkin.entries.map(e => e.teamId), ['next', 'stay', 'last']);
  assert.equal(event.format.participants[0].teamId, 'next');
  assert.deepEqual({ size: event.format.size, lockedAt: event.format.lockedAt, activeByeCount: event.format.activeByeCount }, formatBefore);
  assert.equal(event.checkin.isOpen, false);
  assert.deepEqual(event.checkin.lateLeaveBans, []);
  assert.equal(event.meta.halloweenReplacements[0].banCreated, false);
  const saved = structuredClone(event);
  assert.throws(() => applyReplacement(event, args), /nicht mehr/);
  assert.deepEqual(event, saved);
});

test('already assigned group and fixtures keep slots and match IDs while replacement must confirm attendance', () => {
  const event = eventFixture();
  const old = { type: 'team', teamId: 'old', participantKey: 'team:old', slot: 3, displayName: 'old' };
  const other = { type: 'team', teamId: 'stay', slot: 1 };
  event.groups.groups = { A: { groupKey: 'A', slots: [old, other], standings: [], attendance: { presentTeamIds: ['old', 'stay'] }, matchdays: [{ matchday: 1, matches: [{ id: 'match-keep', home: { ...old }, away: { ...other }, status: 'locked', result: null, reports: [] }] }] } };
  applyReplacement(event, args);
  const group = event.groups.groups.A;
  assert.equal(group.slots[0].slot, 3);
  assert.equal(group.slots[0].teamId, 'next');
  assert.equal(group.matchdays[0].matches[0].home.participantKey, 'team:next');
  assert.equal(group.matchdays[0].matches[0].id, 'match-keep');
  assert.equal(group.matchdays[0].matches[0].status, 'locked');
  assert.deepEqual(group.attendance.presentTeamIds, ['stay']);
});

test('external registered replacement works; stale or wrong-event exchanges fail before mutation', () => {
  const external = eventFixture();
  applyReplacement(external, { ...args, newTeam: { id: 'external', clubName: 'Extern' } });
  assert.equal(external.checkin.entries[0].teamId, 'external');
  assert.deepEqual(external.checkin.waitlistTeamIds, ['next', 'last']);
  for (const change of [e => { e.eventKey = 'friday'; }, e => { e.format.lockedAt = null; }, e => { e.checkin.activeTeamIds.push('next'); }]) {
    const event = eventFixture(); change(event); const before = structuredClone(event);
    assert.throws(() => applyReplacement(event, args)); assert.deepEqual(event, before);
  }
  assert.throws(() => applyReplacement(eventFixture(), { ...args, now: new Date('2026-10-30T20:00:00Z') }), /begonnen/);
  const played = eventFixture();
  played.groups.groups = { A: { matchdays: [{ matches: [{ reports: [{}] }] }] } };
  assert.throws(() => applyReplacement(played, args), /Spielergebnisse/);
});

test('Halloween schedule and cards use 20:00 draw, 20:55 attendance, 21:00 start, replacement button only on Halloween', () => {
  const event = eventFixture();
  assert.equal(event.schedule.drawAt, '2026-10-30T19:00:00.000Z');
  assert.equal(event.schedule.tournamentStartAt, '2026-10-30T20:00:00.000Z');
  assert.equal(attendanceCloseAt(event).toISOString(), '2026-10-30T19:55:00.000Z');
  const payload = buildBomberXLocoPayload(event, {});
  const text = payload.embeds.map(e => e.toJSON().description).join('\n');
  assert.match(text, /Paddy HSV\*\*: 20:00/); assert.match(text, /bis 20:55 Uhr/); assert.match(text, /Turnierstart: 21:00/);
  assert.ok(payload.components[0].toJSON().components.some(c => c.custom_id === 'halloween_replace:open'));
  assert.match(buildBomberXLocoBlockerPayload({ halloween: true }).embeds[0].toJSON().description, /20:00/);
  event.eventKey = 'friday';
  assert.ok(!buildBomberXLocoPayload(event, {}).components[0].toJSON().components.some(c => c.custom_id === 'halloween_replace:open'));
});

test('replacement UI rejects nonstaff and paginates active teams in private selectors', async () => {
  const original = Module._load;
  const modulePath = require.resolve('../src/domain/checkins/halloween-replacement-interactions');
  delete require.cache[modulePath];
  Module._load = function(request, parent, main) {
    if (parent?.filename === modulePath && request === '../../storage') return { FILES: { settings: 'unused' }, readJson: () => ({ roles: { cupLeadRoleIds: ['lead'] } }) };
    return original.call(this, request, parent, main);
  };
  let ui;
  try { ui = require(modulePath); } finally { Module._load = original; delete require.cache[modulePath]; }
  const interaction = { channelId: '1542823464434671676', user: { id: 'user' }, guild: { members: { fetch: async () => ({ permissions: { has: () => false }, roles: { cache: new Set() } }) } } };
  await assert.rejects(ui.assertStaff(interaction), /Nur Admins/);
  interaction.guild.members.fetch = async () => ({ permissions: { has: () => false }, roles: { cache: new Set(['lead']) } });
  await ui.assertStaff(interaction);
  const event = eventFixture(); event.checkin.activeTeamIds = Array.from({ length: 54 }, (_, i) => String(i));
  const page = ui.selection(event, { page: 2 });
  assert.equal(page.components[0].toJSON().components[0].options.length, 4);
  assert.ok(page.components.every(row => row.toJSON().components.every(c => c.custom_id.length <= 100)));
});
