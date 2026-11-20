'use strict';

const GTA_CUP_KEY = 'loco_gta_vi';
const GTA_CUP_DATE = '2026-11-28';
const GTA_CUP_CHANNEL = '1573307716535984238';
const GTA_CUP_SIZES = [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48];

const GTA_CUP_FORMATS = {
  20: { groupCount: 5, qualifiedCount: 8, bestRunnersUp: 3, rule: 'winners_plus_3_best_runners_up' },
  36: { groupCount: 9, qualifiedCount: 16, bestRunnersUp: 7, rule: 'winners_plus_7_best_runners_up' },
  40: { groupCount: 10, qualifiedCount: 16, bestRunnersUp: 6, rule: 'winners_plus_6_best_runners_up' },
  44: { groupCount: 11, qualifiedCount: 32, bestThirds: 10, rule: 'top2_plus_10_best_thirds' },
  48: { groupCount: 12, qualifiedCount: 32, bestThirds: 8, rule: 'top2_plus_8_best_thirds' },
};

function replacesSaturdayCup(eventKey, eventDate) {
  return eventKey === 'saturday' && eventDate === GTA_CUP_DATE;
}

function isGtaCup(event) {
  return event?.eventKey === GTA_CUP_KEY;
}

module.exports = { GTA_CUP_KEY, GTA_CUP_DATE, GTA_CUP_CHANNEL, GTA_CUP_SIZES, GTA_CUP_FORMATS, isGtaCup, replacesSaturdayCup };
