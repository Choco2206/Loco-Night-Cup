'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LEGACY_RANKING_CHANNEL_ID, compareLegacyTeams, getLegacyRanking, rankingPages, snapshotTeam } = require('../src/domain/legacy-ranking');

function team(overrides = {}) {
  return { id: 'team-1', clubName: 'Loco Squad', status: 'active', history: { cupsPlayed: 7, titles: { gold: 2, silver: 1, bronze: 0 }, matches: { played: 12, wins: 8, draws: 2, losses: 2, goalsFor: 30, goalsAgainst: 14 } }, ...overrides };
}

test('uses the requested Legacy Ranking channel', () => assert.equal(LEGACY_RANKING_CHANNEL_ID, '1534844186803830835'));
test('calculates classic football points from persistent match history', () => { const value = snapshotTeam(team()); assert.equal(value.points, 26); assert.equal(value.goalDifference, 16); });
test('retains cups and games as separate columns', () => { const value = snapshotTeam(team()); assert.equal(value.cups, 7); assert.equal(value.played, 12); });
test('derives final appearances from gold and silver finishes', () => assert.equal(snapshotTeam(team()).finalAppearances, 3));
test('sorts by points before every tiebreaker', () => assert.ok(compareLegacyTeams({ points: 10 }, { points: 9 }) < 0));
test('sorts equal points by goal difference and goals scored', () => { assert.ok(compareLegacyTeams({ points: 10, goalDifference: 5 }, { points: 10, goalDifference: 4 }) < 0); assert.ok(compareLegacyTeams({ points: 10, goalDifference: 5, goalsFor: 20 }, { points: 10, goalDifference: 5, goalsFor: 19 }) < 0); });
test('ranks historical snapshots including deleted teams', () => { const ranking = getLegacyRanking({ teams: { a: snapshotTeam(team()), b: snapshotTeam(team({ id: 'team-2', clubName: 'Historisches Team', status: 'deleted', history: { cupsPlayed: 1, titles: {}, matches: { played: 1, wins: 0, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 2 } } })) } }); assert.equal(ranking.length, 2); assert.equal(ranking[0].teamName, 'Loco Squad'); });
test('renders a heroic mobile-safe table with points explanation', () => { const pages = rankingPages([{ ...snapshotTeam(team()), rank: 1 }], '2026-08-06T12:00:00.000Z'); assert.match(pages[0], /LOCO LEGACY RANKING/); assert.match(pages[0], /Geschichte des Loco Night Cups/); assert.match(pages[0], /Platz in der Ewigkeit/); assert.match(pages[0], /Sieg 3 Punkte/); assert.match(pages[0], /CUPS\s+SP/); assert.ok(pages.every(page => page.length <= 2000)); });
