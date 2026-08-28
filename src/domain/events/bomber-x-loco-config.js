'use strict';

const BOMBER_X_LOCO_EVENT_DATE = '2026-09-19';
const BOMBER_X_LOCO_CHECKIN_CHANNEL_ID = '1542823464434671676';
const BOMBER_X_LOCO_FORMAT_SIZES = [6, 12, 18, 24, 30, 36, 42, 48];
const BOMBER_X_LOCO_GROUP_SIZE = 6;
const BOMBER_X_LOCO_MATCHDAYS = 5;

const BOMBER_X_LOCO_FORMATS = {
  6: { groupCount: 1, qualifiedCount: 4, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'semi_final', rule: 'top4' },
  12: { groupCount: 2, qualifiedCount: 8, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'quarter_final', rule: 'top4' },
  18: { groupCount: 3, qualifiedCount: 8, directPlaces: 2, wildcardPlace: 3, wildcardCount: 2, firstRoundKey: 'quarter_final', rule: 'top2_plus_2_best_thirds' },
  24: { groupCount: 4, qualifiedCount: 16, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'round_of_16', rule: 'top4' },
  30: { groupCount: 5, qualifiedCount: 16, directPlaces: 3, wildcardPlace: 4, wildcardCount: 1, firstRoundKey: 'round_of_16', rule: 'top3_plus_best_fourth' },
  36: { groupCount: 6, qualifiedCount: 16, directPlaces: 2, wildcardPlace: 3, wildcardCount: 4, firstRoundKey: 'round_of_16', rule: 'top2_plus_4_best_thirds' },
  42: { groupCount: 7, qualifiedCount: 32, directPlaces: 4, wildcardPlace: 5, wildcardCount: 4, firstRoundKey: 'round_of_32', rule: 'top4_plus_4_best_fifths' },
  48: { groupCount: 8, qualifiedCount: 32, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'round_of_32', rule: 'top4' },
};

function isBomberXLocoDate(eventKey, eventDate) {
  return eventKey === 'saturday' && eventDate === BOMBER_X_LOCO_EVENT_DATE;
}

function isBomberXLocoEvent(event) {
  return event?.meta?.eventMode === 'bomber_x_loco';
}

function buildBomberXLocoSchedule(eventDate = BOMBER_X_LOCO_EVENT_DATE) {
  const offset = '+02:00';
  return {
    cycleKey: `saturday_${eventDate}`,
    eventDate,
    timeZone: 'Europe/Berlin',
    deadlineAt: new Date(`${eventDate}T20:30:00${offset}`),
    lateWindowUntil: new Date(`${eventDate}T20:45:00${offset}`),
    drawAt: new Date(`${eventDate}T20:50:00${offset}`),
    tournamentStartAt: new Date(`${eventDate}T21:00:00${offset}`),
    resetAt: new Date('2026-09-20T07:00:00+02:00'),
    eventMode: 'bomber_x_loco',
  };
}

function getBomberXLocoFormat(formatSize) {
  return BOMBER_X_LOCO_FORMATS[Number(formatSize)] || null;
}

module.exports = {
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_FORMAT_SIZES,
  BOMBER_X_LOCO_FORMATS,
  BOMBER_X_LOCO_GROUP_SIZE,
  BOMBER_X_LOCO_MATCHDAYS,
  buildBomberXLocoSchedule,
  getBomberXLocoFormat,
  isBomberXLocoDate,
  isBomberXLocoEvent,
};
