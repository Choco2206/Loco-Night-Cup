'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TOURNAMENT_FORMATS, isLeaguePhaseFormat } = require('../src/app/constants');
const { createSettingsDefault, createEventDefault } = require('../src/storage/defaults');
const { groupCountForSize } = require('../src/domain/events/event-format');
const { createGroups } = require('../src/domain/groups/group-draw');
const { createGroupMatchdays } = require('../src/domain/groups/group-matches');
const { getQualificationText } = require('../src/domain/groups/group-embeds');
const { qualifyTeams } = require('../src/domain/knockout/knockout-qualification');
const { buildKnockoutRounds } = require('../src/domain/knockout/knockout-bracket');
const { buildKnockoutState } = require('../src/domain/knockout/knockout-service');
const { createLeaguePhaseDraw } = require('../src/domain/league-phase/league-phase-draw');
const { validateEvent } = require('../src/validation/events.schema');

function participants(size) {
  return Array.from({ length: size }, (_, index) => ({ type: 'team', teamId: `team-${index}`, displayName: `Team ${index}` }));
}

function completedTwenty(wildcardGroup) {
  const event = createEventDefault('monday');
  event.format.size = 20;
  event.groups.status = 'completed';
  for (const groupKey of ['A', 'B', 'C', 'D', 'E']) {
    const slots = Array.from({ length: 4 }, (_, index) => ({
      slot: index + 1, type: 'team', teamId: `${groupKey}${index + 1}`,
      participantKey: `team:${groupKey}${index + 1}`, displayName: `${groupKey}${index + 1}`,
    }));
    const group = { groupKey, slots, status: 'completed' };
    group.matchdays = createGroupMatchdays({ eventKey: 'monday', group, createdAt: '2026-10-17T19:00:00Z' });
    for (const match of group.matchdays.flatMap(day => day.matches)) {
      const goals = groupKey === wildcardGroup ? 1 : 2;
      match.status = 'confirmed';
      match.result = {
        homeGoals: match.home.slot < match.away.slot ? goals : 0,
        awayGoals: match.away.slot < match.home.slot ? goals : 0,
      };
    }
    event.groups.groups[groupKey] = group;
  }
  return event;
}

function checkBracket(teams, protectSecondRound) {
  const bracket = buildKnockoutRounds({ eventKey: 'test', qualifiedTeams: teams, createdAt: '2026-10-17T19:00:00Z' });
  const matches = bracket.rounds[bracket.firstRoundKey].matches;
  const actual = matches.flatMap(match => [match.home.teamId, match.away.teamId]).sort();
  assert.deepEqual(actual, teams.map(team => team.teamId).sort());
  assert.equal(new Set(actual).size, teams.length);
  for (const match of matches) {
    assert.notEqual(match.home.groupKey, match.away.groupKey, 'no first-round group rematch');
    assert.ok(match.home.seed <= teams.length / 2);
    assert.ok(match.away.seed > teams.length / 2);
  }
  if (protectSecondRound) {
    for (let index = 0; index < matches.length; index += 2) {
      const branch = matches.slice(index, index + 2);
      assert.equal(branch[0].next.matchId, branch[1].next.matchId);
      assert.equal(new Set(branch.flatMap(match => [match.home.groupKey, match.away.groupKey])).size, 4,
        'all four possible second-round entrants come from different groups');
    }
  }
  assert.deepEqual(bracket, buildKnockoutRounds({ eventKey: 'test', qualifiedTeams: teams.slice().reverse(), createdAt: '2026-10-17T19:00:00Z' }));
  return bracket;
}

test('20 teams draw five complete groups; 14 and 18 remain leagues', () => {
  assert.equal(isLeaguePhaseFormat(20), false);
  for (const size of [14, 18]) {
    assert.equal(isLeaguePhaseFormat(size), true);
    assert.equal(createLeaguePhaseDraw({ eventKey: 'test', participants: participants(size) }).matchdays.length, 4);
  }
  assert.throws(() => createLeaguePhaseDraw({ eventKey: 'test', participants: participants(20) }), /14 oder 18/);
  assert.equal(groupCountForSize(20), 5);
  const groups = createGroups({ eventKey: 'test', field: { groupCount: groupCountForSize(20), participants: participants(20) }, settings: createSettingsDefault() });
  assert.deepEqual(Object.keys(groups), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(new Set(Object.values(groups).flatMap(group => group.slots.map(slot => slot.teamId))).size, 20);
  for (const group of Object.values(groups)) {
    assert.equal(group.slots.length, 4);
    assert.equal(group.matchdays.length, 3);
    assert.equal(group.matchdays.flatMap(day => day.matches).length, 6);
  }
  assert.match(getQualificationText(20), /Platz 1 bis 3 jeder Gruppe.*beste Viertplatzierte.*Achtelfinale/);
});

test('all five possible best fourths qualify with all top-three teams, protected through the quarterfinal', () => {
  for (const wildcard of ['A', 'B', 'C', 'D', 'E']) {
    const event = completedTwenty(wildcard);
    const { qualifiedTeams } = qualifyTeams(event);
    assert.equal(qualifiedTeams.length, 16);
    for (const groupKey of ['A', 'B', 'C', 'D', 'E']) {
      for (const rank of [1, 2, 3]) assert.ok(qualifiedTeams.some(team => team.teamId === `${groupKey}${rank}`));
    }
    assert.deepEqual(qualifiedTeams.filter(team => team.groupRank === 4).map(team => team.teamId), [`${wildcard}4`]);
    assert.equal(checkBracket(qualifiedTeams, true).firstRoundKey, 'round_of_16');
    assert.equal(buildKnockoutState({ eventKey: 'monday', event }).rounds.round_of_16.matches.length, 8);
  }
});

function seededTeams(groupCount, direct, wildcardGroups = []) {
  const teams = [];
  for (let rank = 1; rank <= direct; rank += 1) {
    for (let group = 0; group < groupCount; group += 1) {
      teams.push({ teamId: `${group}-${rank}`, displayName: `${group}-${rank}`, groupKey: String.fromCharCode(65 + group), groupRank: rank });
    }
  }
  for (const group of wildcardGroups) teams.push({ teamId: `${group}-${direct + 1}`, displayName: 'Wildcard', groupKey: String.fromCharCode(65 + group), groupRank: direct + 1 });
  return teams.map((team, index) => ({ ...team, seed: index + 1 }));
}

test('existing 8/12/16/24/28/32 formats preserve seed pots and avoid rematches wherever possible', () => {
  checkBracket(seededTeams(2, 2), false); // Only two groups: final rematches are unavoidable.
  for (let omitted = 0; omitted < 3; omitted += 1) {
    checkBracket(seededTeams(3, 2, [0, 1, 2].filter(group => group !== omitted)), false);
  }
  checkBracket(seededTeams(4, 2), true);
  for (let first = 0; first < 6; first += 1) {
    for (let second = first + 1; second < 6; second += 1) {
      checkBracket(seededTeams(6, 2, [0, 1, 2, 3, 4, 5].filter(group => group !== first && group !== second)), true);
    }
  }
  for (let first = 0; first < 7; first += 1) {
    for (let second = first + 1; second < 7; second += 1) checkBracket(seededTeams(7, 2, [first, second]), true);
  }
  checkBracket(seededTeams(8, 2), true);
});

test('league quarterfinal seeding stays 1-8, 4-5, 2-7, 3-6', () => {
  const teams = participants(8).map((team, index) => ({ ...team, groupKey: 'league', seed: index + 1 }));
  const bracket = buildKnockoutRounds({ eventKey: 'test', qualifiedTeams: teams });
  assert.deepEqual(bracket.rounds.quarter_final.matches.map(match => [match.home.seed, match.away.seed]), [[1, 8], [4, 5], [2, 7], [3, 6]]);
});

test('previously drawn 20-team leagues still pass startup validation', () => {
  const event = createEventDefault('monday');
  event.status = 'league_phase';
  event.format.size = 20;
  event.format.lockedAt = '2026-10-17T19:00:00Z';
  event.leaguePhase = { phaseType: 'league', participants: participants(20), matchdays: Array.from({ length: 4 }, () => ({ matches: [] })), standings: [] };
  assert.deepEqual(validateEvent(event, 'monday'), []);
  assert.equal(TOURNAMENT_FORMATS[20].qualifiedCount, 16);
});
