'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildStreamListPages, HEADER } = require('../src/domain/teams/team-stream-list');
const { isTeamMember, normalizeTwitchUrl, normalizeTwitchUrls } = require('../src/domain/teams/team-service');

test('normalizes Twitch channel names and direct links', () => {
  assert.equal(normalizeTwitchUrl('Alpha_United'), 'https://www.twitch.tv/alpha_united');
  assert.equal(normalizeTwitchUrl('https://twitch.tv/BlackWolves/'), 'https://www.twitch.tv/blackwolves');
  assert.equal(normalizeTwitchUrl(''), null);
  assert.throws(() => normalizeTwitchUrl('https://example.com/team'));
});

test('accepts up to three unique links and recognizes co-managers as team members', () => {
  assert.deepEqual(normalizeTwitchUrls(['alpha_one', 'alpha_two', 'alpha_two', 'alpha_three']), [
    'https://www.twitch.tv/alpha_one',
    'https://www.twitch.tv/alpha_two',
    'https://www.twitch.tv/alpha_three',
  ]);
  assert.throws(() => normalizeTwitchUrls(['team_one', 'team_two', 'team_three', 'team_four']));
  assert.equal(isTeamMember({ manager: { userId: '1' }, coManagers: [{ userId: '2' }] }, '2'), true);
});

test('sorts teams, excludes missing links, and only puts the header on page one', () => {
  const pages = buildStreamListPages([
    { clubName: 'Loco Squad', twitchUrls: ['https://www.twitch.tv/locosquad'] },
    { clubName: 'Ohne Stream', twitchUrls: [] },
    { clubName: 'Alpha United', twitchUrls: ['https://www.twitch.tv/alphaunited', 'https://www.twitch.tv/alphaunited2'] },
  ]);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].startsWith(HEADER));
  assert.ok(pages[0].indexOf('Alpha United') < pages[0].indexOf('Loco Squad'));
  assert.ok(!pages[0].includes('Ohne Stream'));
});

test('paginates without splitting a team entry', () => {
  const teams = Array.from({ length: 70 }, (_, index) => ({
    clubName: `Team ${String(index).padStart(2, '0')} ${'X'.repeat(20)}`,
    twitchUrls: [`https://www.twitch.tv/team_${String(index).padStart(2, '0')}`],
  }));
  const pages = buildStreamListPages(teams);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.length <= 2000));
  assert.ok(pages[0].startsWith(HEADER));
  assert.ok(pages.slice(1).every(page => !page.includes('# 📺 Team-Streams')));
  for (const team of teams) {
    assert.equal(pages.filter(page => page.includes(`**${team.clubName}**\n${team.twitchUrls[0]}`)).length, 1);
  }
});
