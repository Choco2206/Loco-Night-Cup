'use strict';

const LOCO_ZWERGEN_CUP_EVENT_DATE = '2026-09-12';
const LOCO_ZWERGEN_CUP_EVENT_MODE = 'loco_zwergen_cup';
const LOCO_ZWERGEN_CUP_CYCLE_KEY = `saturday_${LOCO_ZWERGEN_CUP_EVENT_DATE}`;
const LOCO_ZWERGEN_CUP_FORMAT_SIZES = [8, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48];

const LOCO_ZWERGEN_CUP_FORMATS = Object.freeze({
  36: { groupCount: 9, qualifiedCount: 32, bestThirds: 9, bestFourths: 5, firstRoundKey: 'round_of_32', rule: 'top2_plus_all_thirds_plus_5_best_fourths' },
  40: { groupCount: 10, qualifiedCount: 32, bestThirds: 10, bestFourths: 2, firstRoundKey: 'round_of_32', rule: 'top2_plus_all_thirds_plus_2_best_fourths' },
  44: { groupCount: 11, qualifiedCount: 32, bestThirds: 10, bestFourths: 0, firstRoundKey: 'round_of_32', rule: 'top2_plus_10_best_thirds' },
  48: { groupCount: 12, qualifiedCount: 32, bestThirds: 8, bestFourths: 0, firstRoundKey: 'round_of_32', rule: 'top2_plus_8_best_thirds' },
});

function isLocoZwergenCupDate(eventKey, eventDate) {
  return eventKey === 'saturday' && String(eventDate || '') === LOCO_ZWERGEN_CUP_EVENT_DATE;
}

function isLocoZwergenCupEvent(event) {
  return event?.meta?.eventMode === LOCO_ZWERGEN_CUP_EVENT_MODE;
}

function getLocoZwergenCupFormat(formatSize) {
  return LOCO_ZWERGEN_CUP_FORMATS[Number(formatSize)] || null;
}

module.exports = {
  LOCO_ZWERGEN_CUP_CYCLE_KEY,
  LOCO_ZWERGEN_CUP_EVENT_DATE,
  LOCO_ZWERGEN_CUP_EVENT_MODE,
  LOCO_ZWERGEN_CUP_FORMAT_SIZES,
  LOCO_ZWERGEN_CUP_FORMATS,
  getLocoZwergenCupFormat,
  isLocoZwergenCupDate,
  isLocoZwergenCupEvent,
};
