'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getBomberXLocoQualificationText } = require('../src/domain/groups/group-embeds');
const { BOMBER_X_LOCO_FORMAT_SIZES } = require('../src/domain/events/bomber-x-loco-config');
const { createEventDefault } = require('../src/storage/defaults');
const { validateEvent } = require('../src/validation/events.schema');

test('describes every Bomber X Loco qualification rule for the live table', () => {
  const expected = {
    6: '🏆 Weiterkommen: Platz 1 bis 4',
    12: '🏆 Weiterkommen: Platz 1 bis 4',
    18: '🏆 Weiterkommen: Platz 1 bis 2 + die 2 besten Drittplatzierten',
    24: '🏆 Weiterkommen: Platz 1 bis 4',
    30: '🏆 Weiterkommen: Platz 1 bis 3 + der beste Viertplatzierte',
    36: '🏆 Weiterkommen: Platz 1 bis 2 + die 4 besten Drittplatzierten',
    42: '🏆 Weiterkommen: Platz 1 bis 4 + die 4 besten Fünftplatzierten',
    48: '🏆 Weiterkommen: Platz 1 bis 4',
  };

  for (const [formatSize, text] of Object.entries(expected)) {
    assert.equal(getBomberXLocoQualificationText(formatSize), text);
  }
});

test('startup validation accepts the live 48-team Bomber X Loco event', () => {
  const event = createEventDefault('saturday');
  event.meta.eventMode = 'bomber_x_loco';
  event.cycle.eventDate = '2026-09-19';
  event.format.minimumRealTeams = 6;
  event.format.allowedSizes = [...BOMBER_X_LOCO_FORMAT_SIZES];
  event.format.size = 48;

  assert.deepEqual(validateEvent(event, 'saturday'), []);
});
