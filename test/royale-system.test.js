'use strict';

const assert = require('assert');
const { autoConfirmRoyaleFirstReport, buildRoyaleBracket, recordRoyaleResult, submitRoyaleReport } = require('../src/domain/royale/royale-bracket');
const { calculateRoyaleCheckin, chooseRoyaleFormat } = require('../src/domain/royale/royale-format');
const { buildRoyaleSchedule, getLastSaturday, getRoyaleEventDate, isRoyaleEventDate } = require('../src/domain/royale/royale-schedule');
const { getPlannedSchedule } = require('../src/domain/checkins/checkin-schedule');
const { getAllowedSizes } = require('../src/domain/checkins/checkin-format');
const { createSettingsDefault } = require('../src/storage/defaults');
const { createEventDefault } = require('../src/storage/defaults');
const { validateEvent } = require('../src/validation/events.schema');
const { buildRoyaleCeremonyText } = require('../src/domain/royale/royale-ceremony');
const { roundTiming } = require('../src/domain/royale/royale-rounds');
const { royalePendingDescriptors } = require('../src/domain/results/result-confirmation-service');

assert.equal(getLastSaturday(2026, 8), '2026-08-29');
assert.equal(getRoyaleEventDate(2026, 8), '2026-08-22');
assert.equal(getRoyaleEventDate(2026, 9), '2026-09-26');
assert.equal(isRoyaleEventDate('2026-08-22'), true);
assert.equal(isRoyaleEventDate('2026-08-29'), false);

const saturdayPlan = getPlannedSchedule('saturday', {}, createSettingsDefault(), new Date('2026-08-20T12:00:00.000Z'));
assert.equal(saturdayPlan.eventMode, 'knockout_royale');
assert.equal(saturdayPlan.eventDate, '2026-08-22');
assert.equal(saturdayPlan.drawAt.toISOString(), '2026-08-22T22:05:00.000Z');
assert.deepEqual(getAllowedSizes(createSettingsDefault(), { meta: { eventMode: 'knockout_royale' }, format: { allowedSizes: [8, 16, 32] } }), [8, 16, 32]);

const royaleSaturday = createEventDefault('saturday');
royaleSaturday.meta.eventMode = 'knockout_royale';
royaleSaturday.format.allowedSizes = [8, 16, 32];
assert.deepEqual(validateEvent(royaleSaturday, 'saturday'), []);

const ceremonyText = buildRoyaleCeremonyText({
  clubName: 'Wolfsrudel FC',
  manager: { userId: '1001' },
  coManagers: [{ userId: '1002' }, { userId: '1003' }],
}, 23);
assert.ok(ceremonyText.startsWith('@everyone'));
assert.ok(ceremonyText.includes('**Wolfsrudel FC**'));
assert.ok(ceremonyText.includes('<@1001>'));
assert.ok(ceremonyText.includes('<@1002>, <@1003>'));
assert.ok(ceremonyText.includes('#23'));

const august = buildRoyaleSchedule('2026-08-22');
assert.equal(august.checkinOpenAt, '2026-08-15T05:00:00.000Z');
assert.equal(august.deadlineAt, '2026-08-22T21:45:00.000Z');
assert.equal(august.lateWindowUntil, '2026-08-22T22:00:00.000Z');
assert.equal(august.bracketAt, '2026-08-22T22:05:00.000Z');
assert.equal(august.tournamentStartAt, '2026-08-22T22:15:00.000Z');
assert.equal(august.firstReleaseUntil, '2026-08-22T22:20:00.000Z');

const preparedTiming = roundTiming({ schedule: august }, {}, new Date('2026-08-22T22:05:00.000Z'));
assert.equal(preparedTiming.released, false);
assert.equal(preparedTiming.openedAt, null);
assert.equal(preparedTiming.reminderAt, '2026-08-22T22:40:00.000Z');
const releasedTiming = roundTiming({ schedule: august }, { ...preparedTiming }, new Date('2026-08-22T22:15:00.000Z'));
assert.equal(releasedTiming.released, true);
assert.equal(releasedTiming.openedAt, '2026-08-22T22:15:00.000Z');
assert.equal(releasedTiming.reminderAt, '2026-08-22T22:40:00.000Z');

assert.equal(chooseRoyaleFormat(7), null);
assert.equal(chooseRoyaleFormat(8), 8);
assert.equal(chooseRoyaleFormat(15), 8);
assert.equal(chooseRoyaleFormat(16), 16);
assert.equal(chooseRoyaleFormat(31), 16);
assert.equal(chooseRoyaleFormat(32), 32);
assert.equal(chooseRoyaleFormat(40), 32);
const checkin = calculateRoyaleCheckin(Array.from({ length: 21 }, (_, index) => ({ teamId: index + 1 })));
assert.equal(checkin.size, 16);
assert.equal(checkin.activeEntries.length, 16);
assert.equal(checkin.waitlistEntries.length, 5);
assert.equal(checkin.nextMilestone, 32);

function teams(size) {
  return Array.from({ length: size }, (_, index) => ({ teamId: `team-${index + 1}`, displayName: `Team ${index + 1}` }));
}

for (const size of [8, 16, 32]) {
  const bracket = buildRoyaleBracket({ teams: teams(size) });
  assert.equal(bracket.rounds.kings_round_1.matches.length, size / 2);
  assert.equal(bracket.rounds.shadows_round_1.matches.length, size / 4);
  assert.equal(bracket.rounds.kings_final.matches.length, 1);
  assert.equal(bracket.rounds.shadows_final.matches.length, 1);
  assert.equal(bracket.rounds.grand_final.matches.length, 1);
  assert.equal(bracket.rounds.grand_final_reset.status, 'not_needed');
  assert.match(bracket.rounds.kings_round_2.matches[0].home.displayName, /^Sieger Pfad des Königs/);
}

const parallel = buildRoyaleBracket({ teams: teams(8) });
for (const match of parallel.rounds.kings_round_1.matches) recordRoyaleResult(parallel, { roundKey: 'kings_round_1', matchId: match.id, homeGoals: 1, awayGoals: 0 });
assert.equal(parallel.rounds.kings_round_2.status, 'open');
assert.equal(parallel.rounds.shadows_round_1.status, 'open');
assert.equal(parallel.rounds.shadows_round_2.status, 'locked');

function nextOpenMatch(bracket) {
  for (const round of Object.values(bracket.rounds)) {
    const match = round.matches.find(item => item.status === 'open');
    if (match) return { roundKey: round.roundKey, match };
  }
  return null;
}

const completed = buildRoyaleBracket({ teams: teams(8) });
let guard = 0;
while (completed.status !== 'completed' && guard < 100) {
  const open = nextOpenMatch(completed);
  assert.ok(open, 'Es muss bis zum Turnierende immer ein offenes Spiel geben.');
  recordRoyaleResult(completed, { roundKey: open.roundKey, matchId: open.match.id, homeGoals: 1, awayGoals: 0 });
  guard += 1;
}
assert.equal(completed.status, 'completed');
assert.equal(completed.eliminatedTeamIds.length, 7);
assert.ok(completed.championTeamId);
assert.equal(completed.rounds.grand_final_reset.status, 'not_needed');

const resetBracket = buildRoyaleBracket({ teams: teams(8) });
guard = 0;
while (resetBracket.rounds.grand_final.matches[0].status !== 'open' && guard < 100) {
  const open = nextOpenMatch(resetBracket);
  recordRoyaleResult(resetBracket, { roundKey: open.roundKey, matchId: open.match.id, homeGoals: 1, awayGoals: 0 });
  guard += 1;
}
const grandFinal = resetBracket.rounds.grand_final.matches[0];
recordRoyaleResult(resetBracket, { roundKey: 'grand_final', matchId: grandFinal.id, homeGoals: 0, awayGoals: 1 });
assert.equal(resetBracket.rounds.grand_final_reset.status, 'open');
const reset = resetBracket.rounds.grand_final_reset.matches[0];
recordRoyaleResult(resetBracket, { roundKey: 'grand_final_reset', matchId: reset.id, homeGoals: 1, awayGoals: 0 });
assert.equal(resetBracket.status, 'completed');

const reports = buildRoyaleBracket({ teams: teams(8) });
const reportMatch = reports.rounds.kings_round_1.matches[0];
assert.equal(submitRoyaleReport(reports, { roundKey: 'kings_round_1', matchId: reportMatch.id, reporterTeamId: reportMatch.home.teamId, homeGoals: 2, awayGoals: 1 }).status, 'pending_confirmation');
assert.equal(submitRoyaleReport(reports, { roundKey: 'kings_round_1', matchId: reportMatch.id, reporterTeamId: reportMatch.away.teamId, homeGoals: 1, awayGoals: 2 }).status, 'admin_decision_required');
assert.equal(submitRoyaleReport(reports, { roundKey: 'kings_round_1', matchId: reportMatch.id, reporterTeamId: reportMatch.away.teamId, homeGoals: 2, awayGoals: 1 }).status, 'confirmed');

const automatic = buildRoyaleBracket({ teams: teams(8) });
const automaticMatch = automatic.rounds.kings_round_1.matches[0];
submitRoyaleReport(automatic, { roundKey: 'kings_round_1', matchId: automaticMatch.id, reporterTeamId: automaticMatch.home.teamId, homeGoals: 4, awayGoals: 2 });
automatic.rounds.kings_round_1.resultsChannelId = 'royale-results-1';
const restartEntries = royalePendingDescriptors({ bracket: automatic });
assert.equal(restartEntries.length, 1);
assert.equal(restartEntries[0].descriptor.phase, 'royale');
assert.equal(restartEntries[0].channelId, 'royale-results-1');
assert.equal(autoConfirmRoyaleFirstReport(automatic, { roundKey: 'kings_round_1', matchId: automaticMatch.id, now: new Date(new Date(automaticMatch.confirmation.expiresAt).getTime() - 1) }), null);
const automaticOutcome = autoConfirmRoyaleFirstReport(automatic, { roundKey: 'kings_round_1', matchId: automaticMatch.id, now: new Date(new Date(automaticMatch.confirmation.expiresAt).getTime() + 1) });
assert.equal(automaticOutcome.status, 'confirmed');
assert.deepEqual(automaticMatch.result, { homeGoals: 4, awayGoals: 2 });

console.log('royale-system.test.js passed');
