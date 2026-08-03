Exit code: 0
Wall time: 1.3 seconds
Output:
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { enqueueCoalesced } = require('../src/app/async-coalescer');

test('coalesces a burst into one refresh using the latest task', async () => {
  const calls = [];
  const first = enqueueCoalesced('burst-test', async () => calls.push('old'), 5);
  const second = enqueueCoalesced('burst-test', async () => calls.push('latest'), 5);
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['latest']);
});

test('serializes a refresh requested while another refresh is running', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = enqueueCoalesced('serial-test', async () => { calls.push('first-start'); await gate; calls.push('first-end'); }, 0);
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = enqueueCoalesced('serial-test', async () => calls.push('second'), 0);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['first-start', 'first-end', 'second']);
});

