'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/domain/team-of-the-tournament/ea-clubs-client.js'), 'utf8');
function client(fetchImpl, options = {}) {
  const context = { module: { exports: {} }, URL, AbortController, setTimeout, clearTimeout,
    fetch: fetchImpl, ...options };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
test('seven simultaneous club queries are serialized with the configured minimum gap', async () => {
  let active = 0; let peak = 0; const starts = [];
  const api = client(async () => {
    active++; peak = Math.max(peak, active); starts.push(Date.now());
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return { ok: true, json: async () => [] };
  });
  await Promise.all(Array.from({ length: 7 }, (_, i) => api.getFriendlyMatches(String(i))));
  assert.equal(peak, 1);
  assert.equal(starts.length, 7);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 740);
});
test('concurrent fresh requests for the same club share one EA request', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return { ok: true, json: async () => [] }; });
  await Promise.all(Array.from({ length: 7 }, () => api.getFriendlyMatches('101', 'common-gen5', 50, { fresh: true })));
  assert.equal(calls, 1);
});
test('unexpected EA payloads are errors rather than misleading zero-game histories', async () => {
  const api = client(async () => ({ ok: true, json: async () => ({ error: 'unavailable' }) }));
  await assert.rejects(api.getFriendlyMatches('101'), /keine gültige Spielliste/);
});
test('a 429 Retry-After also pauses subsequent queued clubs', async () => {
  let first = true; let limitedAt = 0; const subsequent = [];
  const api = client(async () => {
    if (first) {
      first = false; limitedAt = Date.now();
      return { ok: false, status: 429, headers: { get: () => '1' } };
    }
    subsequent.push(Date.now());
    return { ok: true, json: async () => [] };
  });
  await Promise.all([api.getFriendlyMatches('101'), api.getFriendlyMatches('102')]);
  assert.ok(subsequent.every(at => at - limitedAt >= 990));
});
