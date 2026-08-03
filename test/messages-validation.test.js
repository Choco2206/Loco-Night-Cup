'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMessagesDefault } = require('../src/storage/defaults');
const { validateMessages } = require('../src/validation/messages.schema');
const { LEAGUE_PHASE_VIDEO_CHANNEL_NAME } = require('../src/app/constants');

test('accepts league as the live schedule phase during an active league event', () => {
  const messages = createMessagesDefault();
  messages.liveSchedule.phase = 'league';
  assert.deepEqual(validateMessages(messages), []);
});

test('uses a dedicated Größenvideo channel for the league phase', () => {
  assert.equal(LEAGUE_PHASE_VIDEO_CHANNEL_NAME, 'größenvideo-ligaphase');
});
