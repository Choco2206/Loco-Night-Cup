'use strict';
const assert = require('assert');
const { test } = require('node:test');
const { profileLink, resolveProfileLinks } = require('../src/domain/teams/user-profile-links');
const { syncListMessages, isOverviewBlock } = require('../src/domain/teams/team-overview');
test('fresh names, fallback hierarchy and escaped profile labels', async () => {
  let name = 'A*[B]';
  let count = 0;
  const guild = { members: { fetch: async options => { assert.strictEqual(options.force, true); count++; return options.user === '1' ? { displayName: name, user: { username: 'user' } } : null; } } };
  const client = { users: { fetch: async (id, options) => { assert.strictEqual(options.force, true); return id === '2' ? { globalName: 'Global', username: 'user' } : { username: 'Username' }; } } };
  const teams = [{ manager: { userId: '1' }, coManagers: [{ userId: '2' }, { userId: '3' }, { userId: '1' }] }];
  const before = JSON.stringify(teams);
  let links = await resolveProfileLinks(client, guild, teams);
  assert.strictEqual(links.get('1'), '[@A*[B]](https://discord.com/users/1)'.replace('[B]', '\\[B\\]'));
  assert.strictEqual(links.get('2'), profileLink('2', 'Global'));
  assert.strictEqual(links.get('3'), profileLink('3', 'Username'));
  name = 'New'; links = await resolveProfileLinks(client, guild, teams);
  assert.strictEqual(links.get('1'), profileLink('1', 'New'));
  assert.strictEqual(count, 6);
  assert.strictEqual(JSON.stringify(teams), before);
});
test('recover orphan blocks and reuse chronological order, preserve unrelated posts', async () => {
  const make = (id, time, content) => ({ id, createdTimestamp: time, author: { id: 'bot' }, content, edit: async function(payload) { this.content = payload.content; assert.deepStrictEqual(payload.allowedMentions.parse, []); assert.strictEqual(payload.flags, 4); return this; }, delete: async function() { this.deleted = true; } });
  const block = '🔴 **01 | Club**\n👑 **VM:** x\n🤝 **Co-VM:** Keine';
  const first = make('1', 1, block), orphan = make('2', 2, block), last = make('3', 3, block), unrelated = make('4', 4, 'Other');
  const page = new Map([first, orphan, last, unrelated].map(m => [m.id, m])); page.last = () => unrelated;
  const channel = { messages: { fetch: async () => page }, send: async () => { throw Error('Existing blocks should be reused'); } };
  assert.deepStrictEqual(await syncListMessages(channel, ['3', '1'], ['A', 'B'], 'bot'), ['1', '2']);
  assert.strictEqual(last.deleted, true); assert.strictEqual(unrelated.deleted, undefined);
});

test('recognize historical bold layouts without matching unrelated messages', () => {
  for (const content of [
    '🔴 **353 | Zürich X**\n👑 **VM:** <@123>\n🤝 **Co-VM:** Keine',
    '**🔴 353 | Zürich X**\n👑 **VM:** <@123>\n🤝 **Co-VM:** Keine',
    '**🔴 355 | ZwergenToGlory**\n👑 **VM**: <@123>\n🤝 **Co-VM**: Keine',
  ]) assert.strictEqual(isOverviewBlock({ content }), true);
  assert.strictEqual(isOverviewBlock({ content: 'Hallo VM: <@123>' }), false);
});

test('profile labels preserve pipes and underscores without added backslashes', () => {
  assert.strictEqual(profileLink('1', 'FC VM | Hasanii_LP'), '[@FC VM | Hasanii_LP](https://discord.com/users/1)');
});
