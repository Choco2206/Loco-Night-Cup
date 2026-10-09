'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { test } = require('node:test');

test('Mein Team passes client and acknowledges before fetching names', async () => {
  const events = [];
  const client = { users: {} }, guild = { id: 'guild' };
  const team = { id: 'team', manager: { userId: '1' }, coManagers: [] };
  const snapshot = JSON.stringify(team);
  const links = new Map([['1', '[@Name](https://discord.com/users/1)']]);
  const mocks = {
    './user-profile-links': { resolveProfileLinks: async (receivedClient, receivedGuild, teams) => {
      assert.strictEqual(receivedClient, client);
      assert.strictEqual(receivedGuild, guild);
      assert.strictEqual(teams[0], team);
      assert.deepStrictEqual(events, ['defer']);
      events.push('fetch'); return links;
    } },
    '../../storage': { FILES: { settings: 'settings' }, readJson: () => ({}) },
    '../../storage/defaults': { createSettingsDefault: () => ({}) },
    './team-service': { findNonDeletedTeamByUserId: () => team },
    './team-validation': { requireGuild: () => {} },
    './team-components': { buildMyTeamPayload: (receivedTeam, id, receivedLinks) => {
      assert.strictEqual(receivedTeam, team); assert.strictEqual(id, '1'); assert.strictEqual(receivedLinks, links);
      return { embeds: ['profile embed'] };
    } },
  };
  const context = { require: name => mocks[name] || {}, module: { exports: {} }, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/domain/teams/team-interactions'), 'utf8'), context);
  const interaction = {
    customId: 'team_show_mine', user: { id: '1' }, guild,
    isButton: () => true,
    deferReply: async payload => { assert.strictEqual(payload.flags, 64); events.push('defer'); },
    editReply: async payload => { assert.strictEqual(payload.embeds[0], 'profile embed'); events.push('edit'); },
    reply: async () => { throw Error('Must defer before lookup'); },
  };
  assert.strictEqual(await context.module.exports.handleInteraction(interaction, client), true);
  assert.deepStrictEqual(events, ['defer', 'fetch', 'edit']);
  assert.strictEqual(JSON.stringify(team), snapshot);
});
