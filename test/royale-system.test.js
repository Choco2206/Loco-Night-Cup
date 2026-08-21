'use strict';

const assert = require('assert');
const { buildRoyaleBracket, recordRoyaleResult, submitRoyaleReport } = require('../src/domain/royale/royale-bracket');
const { calculateRoyaleCheckin, chooseRoyaleFormat } = require('../src/domain/royale/royale-format');
const { buildRoyaleSchedule, getLastSaturday, getRoyaleEventDate } = require('../src/domain/royale/royale-schedule');

assert.equal(getLastSaturday(2026, 8), '2026-08-29');
assert.equal(getRoyaleEventDate(2026, 8), '2026-08-22');
assert.equal(getRoyaleEventDate(2026, 9), '2026-09-26');

const august = buildRoyaleSchedule('2026-08-22');
assert.equal(august.checkinOpenAt, '2026-08-15T05:00:00.000Z');
assert.equal(august.deadlineAt, '2026-08-22T21:45:00.000Z');
assert.equal(august.lateWindowUntil, '2026-08-22T22:00:00.000Z');
assert.equal(august.bracketAt, '2026-08-22T22:05:00.000Z');
assert.equal(august.tournamentStartAt, '2026-08-22T22:15:00.000Z');
assert.equal(august.firstReleaseUntil, '2026-08-22T22:20:00.000Z');

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
}

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
assert.equal(submitRoyaleReport(reports, { roundKey: 'kings_round_1', matchId: reportMatch.id, reporterTeamId: reportMatch.home.teamId, homeGoals: 2, awayGoals: 1 }).status, 'pending');
assert.equal(submitRoyaleReport(reports, { roundKey: 'kings_round_1', matchId: reportMatch.id, reporterTeamId: reportMatch.away.teamId, homeGoals: 1, awayGoals: 2 }).status, 'admin_decision_required');
assert.equal(submitRoyaleReport(reports, { roundKey: 'kings_round_1', matchId: reportMatch.id, reporterTeamId: reportMatch.away.teamId, homeGoals: 2, awayGoals: 1 }).status, 'confirmed');

console.log('royale-system.test.js passed');
