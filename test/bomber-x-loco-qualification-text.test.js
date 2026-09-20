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
    54: '🏆 Weiterkommen: Platz 1 bis 3 + die 5 besten Viertplatzierten',
    60: '🏆 Weiterkommen: Platz 1 bis 3 + die 2 besten Viertplatzierten',
  };

  for (const [formatSize, text] of Object.entries(expected)) {
    assert.equal(getBomberXLocoQualificationText(formatSize), text);
  }
});

test('startup validation accepts the live 54- and 60-team Bomber X Loco event', () => {
  const event = createEventDefault('friday');
  event.meta.eventMode = 'bomber_x_loco';
  event.cycle.eventDate = '2026-09-25';
  event.format.minimumRealTeams = 6;
  event.format.allowedSizes = [...BOMBER_X_LOCO_FORMAT_SIZES];
  event.format.size = 54;
  assert.deepEqual(validateEvent(event, 'friday'), []);

  event.format.size = 60;
  assert.deepEqual(validateEvent(event, 'friday'), []);
});
