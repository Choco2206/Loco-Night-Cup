'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getBomberXLocoQualificationText } = require('../src/domain/groups/group-embeds');

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
