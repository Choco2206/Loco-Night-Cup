'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GTA_CUP_KEY, GTA_CUP_SIZES } = require('../src/domain/events/loco-gta-cup-config');
const { createEventDefault, createSettingsDefault } = require('../src/storage/defaults');
const { ensureEventCycle } = require('../src/domain/checkins/checkin-schedule');
const { chooseFormatSize, getAllowedSizes } = require('../src/domain/checkins/checkin-format');
const { buildCheckinMessagePayload } = require('../src/domain/checkins/checkin-components');
const { buildGtaPaymentPayload, buildTeamSelection } = require('../src/domain/checkins/gta-cup-payment-panel');
const { createGroups } = require('../src/domain/groups/group-draw');
const { qualifyTeams } = require('../src/domain/knockout/knockout-qualification');
const { buildKnockoutRounds } = require('../src/domain/knockout/knockout-bracket');
const { validateEvent } = require('../src/validation/events.schema');

test('GTA Cup check-in has its own date, payment information and four-team increments', () => {
  const settings = createSettingsDefault();
  const event = createEventDefault(GTA_CUP_KEY);
  ensureEventCycle(GTA_CUP_KEY, event, settings, new Date('2026-11-20T12:00:00Z'));
  assert.deepEqual(validateEvent(event, GTA_CUP_KEY), []);
  assert.equal(event.cycle.eventDate, '2026-11-28');
  assert.equal(event.schedule.tournamentStartAt, '2026-11-28T23:15:00.000Z');
  assert.deepEqual(getAllowedSizes(settings, event), GTA_CUP_SIZES);
  for (const [count, size] of [[7, null], [11, 8], [12, 12], [47, 44], [48, 48], [51, 48]]) {
    assert.equal(chooseFormatSize({ participantSlotCount: count, minimumParticipantSlots: 8, allowedSizes: GTA_CUP_SIZES }), size);
  }
  const payload = buildCheckinMessagePayload(GTA_CUP_KEY, event, settings);
  assert.match(payload.embeds.at(-1).toJSON().description, /5 € Teilnahmegebühr.*erstatt/);
  const paymentPanel = buildGtaPaymentPayload(event, settings);
  assert.equal(paymentPanel.embeds[0].toJSON().title, 'Freigabeliste (0)');
  assert.equal(paymentPanel.components[0].toJSON().components.length, 3);
});

test('all GTA Cup formats create complete four-team groups and the promised knockout fields', () => {
  const settings = createSettingsDefault();
  const expected = [4, 8, 8, 8, 16, 16, 16, 16, 16, 32, 32];
  GTA_CUP_SIZES.forEach((size, index) => {
    const event = createEventDefault(GTA_CUP_KEY);
    event.format.size = size;
    const participants = Array.from({ length: size }, (_, teamIndex) => ({
      type: 'team', teamId: `gta-test-${teamIndex}`, displayName: `GTA Test ${teamIndex}`,
    }));
    const groups = createGroups({ eventKey: GTA_CUP_KEY, field: { groupCount: size / 4, participants }, settings });
    for (const group of Object.values(groups)) {
      assert.equal(group.slots.length, 4);
      assert.equal(group.matchdays.length, 3);
      group.status = 'completed';
    }
    event.groups = { status: 'completed', groups };
    const qualification = qualifyTeams(event);
    assert.equal(qualification.qualifiedCount, expected[index]);
    assert.equal(qualification.qualifiedTeams.filter(team => team.groupRank === 4).length, 0);
    if (size >= 44) {
      assert.equal(qualification.qualifiedTeams.filter(team => team.groupRank === 3).length, size === 44 ? 10 : 8);
    }
    const bracket = buildKnockoutRounds({ eventKey: GTA_CUP_KEY, qualifiedTeams: qualification.qualifiedTeams });
    const round = bracket.rounds[bracket.firstRoundKey];
    assert.equal(round.matches.length, expected[index] / 2);
    if (size >= 44) assert.equal(bracket.firstRoundKey, 'round_of_32');
    for (const match of round.matches) assert.notEqual(match.home.groupKey, match.away.groupKey);
  });
});

test('pending registrations are excluded from check-in and rejection clears the request', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const settings = createSettingsDefault();
  const event = createEventDefault(GTA_CUP_KEY);
  ensureEventCycle(GTA_CUP_KEY, event, settings, now);
  const base = require.resolve('../src/domain/checkins/checkin-service');
  const repository = require('../src/domain/checkins/checkin-repository');
  const validation = require('../src/domain/checkins/checkin-validation');
  const originalUpdate = repository.updateEventData;
  const originalLookup = validation.getEligibleTeamForUser;

  try {
    repository.updateEventData = (key, update) => {
      assert.equal(key, GTA_CUP_KEY);
      return update(event);
    };
    validation.getEligibleTeamForUser = userId => ({ id: userId });
    delete require.cache[base];
    const { checkInTeam, reviewGtaCupPayment } = require(base);
    assert.equal(checkInTeam({ eventKey: GTA_CUP_KEY, userId: 'gta-team-1', now }).pendingPayment, true);
    assert.equal(checkInTeam({ eventKey: GTA_CUP_KEY, userId: 'gta-team-1', now }).changed, false);
    assert.equal(event.checkin.entries.length, 0);
    assert.equal(event.checkin.pendingPaymentEntries.length, 1);
    reviewGtaCupPayment({ eventKey: GTA_CUP_KEY, reference: 'gta-team-1', approved: false, actorUserId: 'admin', now });
    assert.equal(event.checkin.entries.length, 0);
    assert.equal(event.checkin.pendingPaymentEntries.length, 0);
  } finally {
    repository.updateEventData = originalUpdate;
    validation.getEligibleTeamForUser = originalLookup;
    delete require.cache[base];
  }
});

test('payment review and withdrawal menus preserve registration order across pages', () => {
  const entries = Array.from({ length: 55 }, (_, i) => ({
    teamId: `gta-page-${i + 1}`,
    checkedInAt: new Date(Date.UTC(2026, 10, 20, 12, i)).toISOString(),
  })).reverse();
  const event = { checkin: { entries, pendingPaymentEntries: entries } };
  for (const action of ['approve', 'reject', 'withdraw']) {
    for (const [page, count] of [[0, 25], [1, 25], [2, 5]]) {
      const payload = buildTeamSelection(event, action, page);
      const [menu, navigation] = payload.components.map(row => row.toJSON().components);
      assert.equal(menu[0].options.length, count);
      assert.equal(menu[0].options[0].value, `gta-page-${page * 25 + 1}`);
      assert.equal(Boolean(navigation[0].disabled), page === 0);
      assert.equal(Boolean(navigation[1].disabled), page === 2);
    }
    assert.match(buildTeamSelection({ checkin: {} }, action, 99).content, /leer|kein Team/);
  }
});
