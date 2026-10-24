'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/domain/team-of-the-tournament/tott-tracker.js'), 'utf8');
function tracker(send) {
  const sandbox = { module: { exports: {} }, console: { warn() {}, info() {} }, require: name => {
    if (name === '../../storage') return { FILES: {}, readJson: () => ({ channels: {} }) };
    if (name.includes('defaults')) return { createSettingsDefault: () => ({}) };
    return { setEaDiagnostics() {} };
  } };
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.module.exports, client: { channels: { fetch: async () => ({ send }) } } };
}
test('long match diagnostics are sent in full without exceeding Discord limits', async () => {
  const sent = []; const h = tracker(async payload => sent.push(payload));
  await h.api.initTottTracker(h.client);
  const message = ['a'.repeat(1850), 'b'.repeat(2100), 'last line'].join('\n');
  assert.equal(await h.api.sendTracker(message), true);
  assert.ok(sent.length > 1);
  assert.ok(sent.every(payload => payload.content.length <= 1900 && payload.allowedMentions.parse.length === 0));
  assert.equal(sent.map(payload => payload.content).join('').replace(/\n/g, ''), message.replace(/\n/g, ''));
});
test('tracker reports a failed Discord send instead of claiming success', async () => {
  const h = tracker(async () => { throw new Error('unavailable'); });
  await h.api.initTottTracker(h.client);
  assert.equal(await h.api.sendTracker('diagnostic'), false);
});
