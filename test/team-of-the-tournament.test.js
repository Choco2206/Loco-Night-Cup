'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FORMATION, MINIMUM_MATCHES, MINIMUM_TEAM_MATCH_RATIO, TOTT_SCORING,
  buildRankings, buildSelection, calculateTottPoints, confirmedEventMatches, normalizePosition, requiresEaCapture,
  selectEaMatch, tottOpportunityMatches,
} = require('../src/domain/team-of-the-tournament/team-of-the-tournament-service');
const { aggregatePlayers, auditRankingMessages, buildAwardsText, buildIntroText, buildTestPerformances, buildTestSelection, closingRatingsReady } = require('../src/domain/team-of-the-tournament/team-of-the-tournament-post');
const layout = require('../config/team-of-the-tournament-layout');
const bomberXLocoLayout = require('../config/bomber-x-loco-tott-layout');
const { AUTO_CLEANUP_DELAY_MS, isTeamOfTheTournamentSettled } = require('../src/domain/events/event-completion-policy');

test('uses the fixed 1-3-5-2 Team of the Tournament formation', () => {
  assert.deepEqual(FORMATION, { goalkeeper: 1, defender: 3, midfielder: 5, forward: 2 });
  assert.equal(MINIMUM_MATCHES, 2);
  assert.equal(MINIMUM_TEAM_MATCH_RATIO, 0.5);
});

test('keeps event data until the Team of the Tournament workflow is settled', () => {
  assert.equal(AUTO_CLEANUP_DELAY_MS, 75 * 60 * 1000);
  assert.equal(isTeamOfTheTournamentSettled({ knockout: { status: 'completed' }, ceremony: { teamOfTheTournament: { postStatus: 'pending' } } }), false);
  assert.equal(isTeamOfTheTournamentSettled({ knockout: { status: 'completed' }, ceremony: { teamOfTheTournament: { postStatus: 'posted' } } }), true);
  assert.equal(isTeamOfTheTournamentSettled({ knockout: { status: 'completed' }, ceremony: { teamOfTheTournament: { postStatus: 'skipped' } } }), true);
});

test('normalizes the four EA Clubs position groups', () => {
  assert.equal(normalizePosition('goalkeeper'), 'goalkeeper');
  assert.equal(normalizePosition('defender'), 'defender');
  assert.equal(normalizePosition('midfielder'), 'midfielder');
  assert.equal(normalizePosition('forward'), 'forward');
});

test('requires half of the team matches, rounded up, with a two-match safety minimum', () => {
  const rows = [];
  const add = (playerId, matchIndexes) => matchIndexes.forEach(index => rows.push({
    lncMatchId: `m${index}`, teamId: 'team-a', playerId, playerName: playerId,
    position: 'forward', rating: 8, goals: 0, assists: 0, manOfTheMatch: 0,
  }));
  add('all-five', [0, 1, 2, 3, 4]);
  add('eligible-three', [0, 1, 2]);
  add('ineligible-two', [0, 1]);
  const selection = buildSelection(rows);
  assert.deepEqual(selection.forward.map(player => player.playerId), ['all-five', 'eligible-three']);
});

test('allows two appearances when a team has the normal three group matches', () => {
  const rows = [];
  const add = (playerId, matchIndexes) => matchIndexes.forEach(index => rows.push({
    lncMatchId: `m${index}`, teamId: 'team-a', playerId, playerName: playerId,
    position: 'forward', rating, goals: 0, assists: 0, manOfTheMatch: 0,
  }));
  const rating = 8;
  add('all-three', [0, 1, 2]);
  add('eligible-two', [0, 1]);
  add('ineligible-one', [0]);
  const selection = buildSelection(rows);
  assert.deepEqual(selection.forward.map(player => player.playerId), ['all-three', 'eligible-two']);
});

test('uses fixed TOTT points and counts goalkeeper goals', () => {
  assert.equal(TOTT_SCORING.goalkeeper.goal, 10);
  const points = calculateTottPoints({
    ratingTotal: 8, goals: 1, assists: 0, cleanSheets: 1, tacklesMade: 0,
    passesMade: 0, saves: 4, manOfTheMatch: 0, wins: 1,
  }, 'goalkeeper');
  assert.equal(points, 28.2);
});

test('ranks total points first and PPG only as a tiebreaker', () => {
  const rows = [];
  const add = (playerId, ratings) => ratings.forEach((rating, index) => rows.push({
    lncMatchId: `m${index}`, teamId: 'team-a', playerId, playerName: playerId,
    position: 'forward', rating, goals: 0, assists: 0, manOfTheMatch: 0,
  }));
  add('consistent-run', [7, 7, 7, 7]);
  add('short-hot-run', [10, 10]);
  const selection = buildSelection(rows);
  assert.deepEqual(selection.forward.map(player => player.playerId), ['consistent-run', 'short-hot-run']);
  assert.equal(selection.forward[0].totalTottPoints, 28);
  assert.equal(selection.forward[1].tottPpg, 10);
});

test('derives wins for performances captured before the points-system update', () => {
  const performances = [0, 1].map(index => ({
    lncMatchId: `m${index}`, teamId: 'team-a', playerId: 'legacy', playerName: 'Legacy',
    position: 'forward', rating: 8, goals: 0, assists: 0, manOfTheMatch: 0,
  }));
  const tournamentMatches = [0, 1].map(index => ({
    id: `m${index}`, home: { teamId: 'team-a' }, away: { teamId: 'team-b' },
    result: { homeGoals: 1, awayGoals: 0 },
  }));
  const selection = buildSelection(performances, tournamentMatches);
  assert.equal(selection.forward[0].wins, 2);
  assert.equal(selection.forward[0].totalTottPoints, 18);
});

test('compensates a bye or missing EA match with the personal points average', () => {
  const performances = [0, 1].map(index => ({
    lncMatchId: `m${index}`, teamId: 'team-a', playerId: 'regular', playerName: 'Regular',
    position: 'forward', rating: 8, goals: 0, assists: 0, manOfTheMatch: 0,
  }));
  const opportunities = [0, 1, 2].map(index => ({
    id: `m${index}`, home: { type: 'team', teamId: 'team-a' }, away: { type: 'team', teamId: 'team-b' },
    status: 'confirmed', result: { homeGoals: 1, awayGoals: 0 },
  }));
  const selection = buildSelection(performances, opportunities);
  assert.equal(selection.forward[0].actualTottPoints, 18);
  assert.equal(selection.forward[0].compensationPoints, 9);
  assert.equal(selection.forward[0].totalTottPoints, 27);
  assert.equal(selection.forward[0].projectedMatches, 3);
});

test('recognizes byes as opportunities and skips EA capture for marked forfeits', () => {
  const event = {
    groups: { groups: { A: { matchdays: [{ matches: [
      { id: 'bye', status: 'bye', home: { type: 'team', teamId: 'a' }, away: { type: 'bye' } },
      { id: 'forfeit', status: 'confirmed', home: { type: 'team', teamId: 'a' }, away: { type: 'team', teamId: 'b' }, result: { homeGoals: 3, awayGoals: 0, matchPlayed: false } },
    ] }] } } },
  };
  assert.equal(tottOpportunityMatches(event).length, 2);
  assert.equal(requiresEaCapture(tottOpportunityMatches(event).find(match => match.id === 'forfeit')), false);
});

test('compensates only the innocent winner of an awarded match', () => {
  const performances = ['winner', 'no-show'].flatMap(teamId => [0, 1].map(index => ({
    lncMatchId: `played-${index}`, teamId, playerId: teamId, playerName: teamId,
    position: 'forward', rating: 8, goals: 0, assists: 0, manOfTheMatch: 0,
  })));
  const opportunities = [0, 1].map(index => ({
    id: `played-${index}`, home: { type: 'team', teamId: 'winner' }, away: { type: 'team', teamId: 'no-show' },
    status: 'confirmed', result: { homeGoals: 1, awayGoals: 0, matchPlayed: true },
  }));
  opportunities.push({
    id: 'awarded', home: { type: 'team', teamId: 'winner' }, away: { type: 'team', teamId: 'no-show' },
    status: 'confirmed', result: { homeGoals: 3, awayGoals: 0, matchPlayed: false },
  });
  const players = buildSelection(performances, opportunities).forward;
  assert.equal(players.find(player => player.teamId === 'winner').teamOpportunityMatches, 3);
  assert.equal(players.find(player => player.teamId === 'no-show').teamOpportunityMatches, 2);
});

test('keeps the complete ranking for the audit channel while selecting only the formation slots', () => {
  const rows = ['one', 'two', 'three'].flatMap((playerId, playerIndex) => [0, 1].map(matchIndex => ({
    lncMatchId: `m${matchIndex}`, teamId: 'team-a', playerId, playerName: playerId,
    position: 'forward', rating: 9 - playerIndex, goals: 0, assists: 0, manOfTheMatch: 0,
  })));
  assert.equal(buildRankings(rows).forward.length, 3);
  assert.equal(buildSelection(rows).forward.length, 2);
});

test('splits long audit rankings below the Discord message limit', () => {
  const players = Array.from({ length: 80 }, (_, index) => ({
    teamId: `team-${index}`, playerId: `player-${index}`, playerName: `Spieler ${index}`,
    matches: 5, actualTottPoints: 50, compensationPoints: index % 2 ? 10 : 0,
    totalTottPoints: index % 2 ? 60 : 50, tottPpg: 10,
  }));
  const messages = auditRankingMessages('⚽ STÜRMER-RANKING', players, new Set());
  assert.ok(messages.length > 1);
  assert.ok(messages.every(message => message.length <= 1900));
});

test('matches one linked club by oriented score and closest confirmation time', () => {
  const linkedTeam = { id: 'home', eaClub: { clubId: '101' } };
  const lncMatch = {
    home: { teamId: 'home' }, away: { teamId: 'away' },
    result: { homeGoals: 2, awayGoals: 1, confirmedAt: '2026-08-02T00:30:00.000Z' },
  };
  const matches = [
    { matchId: 'old', timestamp: '1785624000', clubs: { 101: { clubId: '101', goals: '2' }, 999: { goals: '1' } } },
    { matchId: 'right', timestamp: '1785630000', clubs: { 101: { clubId: '101', goals: '2' }, 999: { goals: '1' } } },
    { matchId: 'reversed', timestamp: '1785630300', clubs: { 101: { clubId: '101', goals: '1' }, 999: { goals: '2' } } },
  ];
  assert.equal(selectEaMatch(matches, lncMatch, [linkedTeam])?.matchId, 'right');
});

test('does not guess a one-linked-team match without an EA timestamp', () => {
  const linkedTeam = { id: 'home', eaClub: { clubId: '101' } };
  const lncMatch = { home: { teamId: 'home' }, away: { teamId: 'away' }, result: { homeGoals: 2, awayGoals: 1, confirmedAt: '2026-08-02T00:30:00.000Z' } };
  const matches = [{ matchId: 'unknown-time', clubs: { 101: { clubId: '101', goals: '2' }, 999: { goals: '1' } } }];
  assert.equal(selectEaMatch(matches, lncMatch, [linkedTeam]), null);
});

test('finds confirmed group, league and knockout matches for startup recovery without duplicates', () => {
  const match = id => ({ id, status: 'confirmed', result: { homeGoals: 1, awayGoals: 0 } });
  const shared = match('shared');
  const event = {
    groups: { groups: { A: { matchdays: [{ matches: [match('group'), shared] }] } } },
    leaguePhase: { matchdays: [{ matches: [match('league')] }] },
    knockout: { rounds: { final: { matches: [match('final'), shared] } } },
  };
  assert.deepEqual(confirmedEventMatches(event).map(entry => entry.id), ['group', 'shared', 'league', 'final']);
});

test('waits for every linked confirmed event match before posting the final selection', () => {
  const event = {
    groups: { groups: { A: { matchdays: [{ matches: [{ id: 'group', status: 'confirmed', result: { homeGoals: 1, awayGoals: 0 }, home: { teamId: 'missing' }, away: { teamId: 'missing-2' } }] }] } } },
    knockout: { rounds: {} },
    ceremony: { teamOfTheTournament: { capturedMatches: [] } },
  };
  // Unlinked teams never block the workflow; linked matches are covered by integration tests with stored teams.
  assert.equal(closingRatingsReady(event), true);
});

test('maps exactly eleven graphic slots to the 1-3-5-2 formation', () => {
  assert.equal(layout.reference.width, 1024);
  assert.equal(layout.reference.height, 1536);
  assert.equal(layout.slots.goalkeeper.length, 1);
  assert.equal(layout.slots.defender.length, 3);
  assert.equal(layout.slots.midfielder.length, 5);
  assert.equal(layout.slots.forward.length, 2);
  assert.deepEqual(layout.slots.goalkeeper[0], {
    logo: { centerX: 513, centerY: 1288, radius: 80 },
    name: { x: 386, y: 1361, width: 190, height: 56 },
    rating: { centerX: 601, centerY: 1389, radius: 34 },
  });
});

test('uses a separate serial-free Bomber X Loco Team of the Tournament layout', () => {
  assert.deepEqual(bomberXLocoLayout.reference, { width: 1022, height: 1536 });
  assert.equal(bomberXLocoLayout.serial, null);
  assert.equal(Object.values(bomberXLocoLayout.slots).flat().length, 11);
  assert.equal(layout.template, 'assets/team-of-the-tournament/team-of-the-tournament.png');
  assert.equal(bomberXLocoLayout.template, 'assets/bomber-x-loco/team-of-the-tournament.jpg');
});

test('builds eleven fictitious players for the admin graphic test', () => {
  const selection = buildTestSelection();
  assert.equal(Object.values(selection).flat().length, 11);
  assert.ok(Object.values(selection).flat().every(player => player.averageRating >= 6.5 && player.averageRating <= 9.9));
  assert.equal(buildTestPerformances(selection).length, 33);
  assert.match(buildIntroText({ test: true }), /@everyone/);
  assert.match(buildIntroText({ test: true }), /Loco DNA/);
  assert.match(buildIntroText({ variant: 'bomber_x_loco' }), /BOMBER X LOCO CUP/);
  assert.doesNotMatch(buildIntroText({ variant: 'bomber_x_loco' }), /Loco DNA/);
});

test('aggregates special awards only after three appearances', () => {
  const performances = [1, 2, 3].flatMap(match => ([
    { teamId: 'a', playerId: 'scorer', playerName: 'Scorer', rating: 8, goals: 1, assists: 0, tacklesMade: 0, saves: 0, cleanSheets: 0, passesMade: 10, manOfTheMatch: 1 },
    { teamId: 'b', playerId: 'helper', playerName: 'Helper', rating: 7.5, goals: 0, assists: 2, tacklesMade: 4, saves: 0, cleanSheets: 1, passesMade: 20, manOfTheMatch: 0 },
  ]));
  const players = aggregatePlayers(performances);
  assert.equal(players.length, 2);
  const awards = buildAwardsText(performances);
  assert.match(awards, /Top-TorschÃ¼tze.*Scorer/);
  assert.match(awards, /Assist-KÃ¶nig.*Helper/);
  assert.match(awards, /Top-AbrÃ¤umer.*Helper/);
});
