'use strict';

const assert = require('assert');
const { getKoLayout } = require('../utils/ko-image-renderer');

const expectedMatches = {
  royal_8_kings_round_1: 4,
  royal_8_kings_round_2: 2,
  royal_8_kings_final: 1,
  royal_8_shadows_round_1: 2,
  royal_8_shadows_round_2: 2,
  royal_8_shadows_round_3: 1,
  royal_8_shadows_final: 1,
  royal_16_kings_round_1: 8,
  royal_16_kings_round_2: 4,
  royal_16_kings_round_3: 2,
  royal_16_kings_final: 1,
  royal_16_shadows_round_1: 4,
  royal_16_shadows_round_2: 4,
  royal_16_shadows_round_3: 2,
  royal_16_shadows_round_4: 2,
  royal_16_shadows_round_5: 1,
  royal_16_shadows_final: 1,
  royal_32_kings_round_1: 16,
  royal_32_kings_round_2: 8,
  royal_32_kings_round_3: 4,
  royal_32_kings_round_4: 2,
  royal_32_kings_final: 1,
  royal_32_shadows_round_1: 8,
  royal_32_shadows_round_2: 8,
  royal_32_shadows_round_3: 4,
  royal_32_shadows_round_4: 4,
  royal_32_shadows_round_5: 2,
  royal_32_shadows_round_6: 2,
  royal_32_shadows_round_7: 1,
  royal_32_shadows_final: 1,
  royal_grand_final: 1,
  royal_grand_final_reset: 1,
};

for (const [phase, count] of Object.entries(expectedMatches)) {
  const { layout } = getKoLayout({ phase });
  assert.equal(layout.kind, 'round');
  assert.equal(layout.matches.length, count);
}

console.log('knockout-royale-images.test.js passed');
