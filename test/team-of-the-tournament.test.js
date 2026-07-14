'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveMatch } = require('../src/domain/team-of-the-tournament/match-resolver');
const { selectTeam, formatRating } = require('../src/domain/team-of-the-tournament/selection');
const { normalizePosition } = require('../src/domain/team-of-the-tournament/position-normalizer');
const { EaProClubsProvider, normalizeMatch } = require('../src/domain/team-of-the-tournament/providers/ea-pro-clubs-provider');
const { searchClubConnections, verifyClubConnection } = require('../src/domain/team-of-the-tournament/pro-clubs-service');
const { buildProClubModal, buildProClubSearchPayload } = require('../src/domain/teams/team-components');
const { buildTottAdminMenu, mockSelection } = require('../src/domain/team-of-the-tournament/admin-tools');
const { POSTING_STALE_MS } = require('../src/domain/team-of-the-tournament/publication');

function match(matchId, homeId = '1', awayId = '2', homeGoals = 2, awayGoals = 1) {
  return { matchId, timestamp: '2026-07-14T18:00:00.000Z', matchType: 'friendlyMatch', home: { club: { clubId: homeId }, goals: homeGoals }, away: { club: { clubId: awayId }, goals: awayGoals } };
}
const job = { confirmedAt: '2026-07-14T18:05:00.000Z', home: { proClubId: '1' }, away: { proClubId: '2' }, result: { homeGoals: 2, awayGoals: 1 } };

test('resolves a unique direct match', () => assert.equal(resolveMatch([match('ea-1')], job).status, 'found'));
test('handles reversed home and away', () => assert.equal(resolveMatch([match('ea-1', '2', '1', 1, 2)], job).status, 'found'));
test('marks equal candidates ambiguous', () => assert.equal(resolveMatch([match('a'), match('b')], job).status, 'ambiguous'));
test('prevents duplicate EA match ids', () => assert.equal(resolveMatch([match('a')], job, new Set(['a'])).status, 'duplicate_match'));
test('normalizes the four EA position groups', () => { assert.equal(normalizePosition('goalkeeper').group, 'goalkeeper'); assert.equal(normalizePosition('defender').group, 'defender'); assert.equal(normalizePosition('midfielder').group, 'midfielder'); assert.equal(normalizePosition('forward').group, 'forward'); });
test('formats German rating', () => assert.equal(formatRating(8.56), '8,6'));

test('selects a deterministic complete 3-5-2', () => {
  const positions = ['goalkeeper', 'defender', 'defender', 'defender', 'midfielder', 'midfielder', 'midfielder', 'midfielder', 'midfielder', 'forward', 'forward'];
  const players = positions.flatMap((position, index) => [1, 2].map(game => ({ isHuman: true, playerName: `Player${index}`, proClubId: String(index % 2), discordTeamId: `team${index % 2}`, position, normalizedPosition: normalizePosition(position), rating: 9 - index / 20 + game / 100, minutes: 90 })));
  const result = selectTeam([{ phase: 'groups', players }]);
  assert.equal(Object.values(result.slots).filter(Boolean).length, 11);
  assert.equal(new Set(Object.values(result.slots).map(player => player?.key)).size, 11);
});

test('falls back to one appearance only for an incomplete pool', () => {
  const performance = { isHuman: true, playerName: 'Keeper', proClubId: '1', discordTeamId: 'team1', position: 'goalkeeper', normalizedPosition: normalizePosition('goalkeeper'), rating: 8.6 };
  const result = selectTeam([{ phase: 'groups', players: [performance] }]);
  assert.equal(result.slots.TW.playerName, 'Keeper');
  assert.ok(result.fallbacks.includes('goalkeeper'));
});

function eaRaw() { return { matchId: 'm1', timestamp: 1784052000, clubs: { '10': { details: { clubId: '10', name: 'Alpha' }, goals: '2', goalsAgainst: '1' }, '20': { details: { clubId: '20', name: 'Beta' }, goals: '1', goalsAgainst: '2' } }, players: { '10': { aggregate: { rating: '99' }, p1: { playername: 'One', pos: 'forward', rating: '8.7', goals: '2', assists: '0', secondsPlayed: '900', gameTime: '1', mom: '1' }, p0: { playername: 'Bench', pos: 'forward', rating: '10', secondsPlayed: '0', gameTime: '0' } }, '20': { p2: { playername: 'Two', pos: 'goalkeeper', rating: '7.5', secondsPlayed: '900', gameTime: '1', saves: '4' } } } }; }
test('parses the verified EA JSON and ignores aggregate/zero minutes', () => { const parsed = normalizeMatch(eaRaw()); assert.equal(parsed.matchId, 'm1'); assert.equal(parsed.home.club.name, 'Alpha'); assert.deepEqual(parsed.home.players.filter(player => player.isHuman).map(player => player.playerId), ['p1']); assert.equal(parsed.home.players.some(player => player.playerName === undefined), false); });
test('uses the dynamic club id in the request URL', async () => { let url; const provider = new EaProClubsProvider({ fetch: async input => { url = String(input); return { ok: true, headers: { get: () => 'application/json' }, json: async () => [eaRaw()] }; } }); await provider.getRecentFriendlyMatches('98765', 'common-gen5', 10); assert.match(url, /clubIds=98765/); assert.doesNotMatch(url, /46978/); });
test('verifies a club only when it occurs in the response', async () => { const provider = { getRecentFriendlyMatches: async () => [normalizeMatch(eaRaw())] }; const result = await verifyClubConnection({ clubId: '10', platform: 'common-gen5', provider }); assert.equal(result.clubName, 'Alpha'); await assert.rejects(() => verifyClubConnection({ clubId: '999', provider }), /kommt.*nicht vor/); });
test('searches EA clubs by name and removes duplicate club ids', async () => { const provider = { searchClubsByName: async () => [{ clubId: '10', name: 'Alpha' }, { clubId: '10', name: 'Alpha' }, { clubId: '20', name: 'Alpha United' }] }; const result = await searchClubConnections({ clubName: 'Alpha', provider }); assert.deepEqual(result.map(club => club.clubId), ['10', '20']); assert.equal(result[0].platform, 'common-gen5'); });
test('club connection UI asks for a name and offers unambiguous results', () => { const team = { id: 'team-1', clubName: 'Discord Team', proClub: null }; const modal = buildProClubModal(team); assert.equal(modal.components[0].components[0].data.custom_id, 'club_name'); const payload = buildProClubSearchPayload(team, [{ clubId: '10', clubName: 'Alpha', platform: 'common-gen5' }]); const option = payload.components[0].components[0].options[0].data; assert.equal(option.value, '10:common-gen5'); assert.match(option.description, /10/); });
test('same player id remains one player after a display-name change', () => { const base = { isHuman: true, playerId: '42', proClubId: '10', normalizedPosition: normalizePosition('forward'), rating: 8, secondsPlayed: 900 }; const result = selectTeam([{ players: [{ ...base, playerName: 'Old' }, { ...base, playerName: 'New', rating: 9 }] }]); assert.equal(result.players.length, 1); assert.equal(result.players[0].average, 8.5); });
test('visible admin TOTT menu exposes all six requested actions', () => { const menu = buildTottAdminMenu(); const options = menu.components[0].components[0].options; assert.equal(options.length, 6); assert.deepEqual(options.map(option => option.data.value), ['mock','preview','selection','ea_test','jobs','manual']); });
test('mock renderer selection uses 1/3/5/2 and eleven unique players', () => { const result = mockSelection(); assert.equal(Object.values(result.slots).filter(Boolean).length, 11); assert.equal(new Set(Object.values(result.slots).map(player => player.key)).size, 11); assert.deepEqual(Object.values(result.slots).reduce((counts, player) => { counts[player.primaryGroup] = (counts[player.primaryGroup] || 0) + 1; return counts; }, {}), { goalkeeper: 1, defender: 3, midfielder: 5, forward: 2 }); });
test('posting recovery timeout is conservative and explicit', () => assert.equal(POSTING_STALE_MS, 15 * 60 * 1000));
