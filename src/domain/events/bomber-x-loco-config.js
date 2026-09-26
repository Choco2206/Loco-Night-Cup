'use strict';

const BOMBER_X_LOCO_EVENT_DATE = '2026-09-25';
const BOMBER_X_LOCO_EVENT_KEY = 'friday';
const BOMBER_X_LOCO_CHECKIN_CHANNEL_ID = '1542823464434671676';
const BOMBER_X_LOCO_FORMAT_SIZES = [6, 12, 18, 24, 30, 36, 42, 48, 54, 60];
const BOMBER_X_LOCO_GROUP_SIZE = 6;
const BOMBER_X_LOCO_MATCHDAYS = 5;
const BOMBER_X_LOCO_REGISTRATION_DEADLINE_TIME = '18:30';
const BOMBER_X_LOCO_DRAW_TIME = '20:00';
const BOMBER_X_LOCO_ATTENDANCE_DEADLINE_TIME = '20:55';
const BOMBER_X_LOCO_TOURNAMENT_START_TIME = '21:00';
const HALLOWEEN_EVENT_KEY = 'bomber_halloween';
const HALLOWEEN_EVENT_DATE = '2026-10-30';
const HALLOWEEN_CHECKIN_CHANNEL_ID = '1542823464434671676';

const BOMBER_X_LOCO_FORMATS = {
  6: { groupCount: 1, qualifiedCount: 4, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'semi_final', rule: 'top4' },
  12: { groupCount: 2, qualifiedCount: 8, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'quarter_final', rule: 'top4' },
  18: { groupCount: 3, qualifiedCount: 8, directPlaces: 2, wildcardPlace: 3, wildcardCount: 2, firstRoundKey: 'quarter_final', rule: 'top2_plus_2_best_thirds' },
  24: { groupCount: 4, qualifiedCount: 16, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'round_of_16', rule: 'top4' },
  30: { groupCount: 5, qualifiedCount: 16, directPlaces: 3, wildcardPlace: 4, wildcardCount: 1, firstRoundKey: 'round_of_16', rule: 'top3_plus_best_fourth' },
  36: { groupCount: 6, qualifiedCount: 16, directPlaces: 2, wildcardPlace: 3, wildcardCount: 4, firstRoundKey: 'round_of_16', rule: 'top2_plus_4_best_thirds' },
  42: { groupCount: 7, qualifiedCount: 32, directPlaces: 4, wildcardPlace: 5, wildcardCount: 4, firstRoundKey: 'round_of_32', rule: 'top4_plus_4_best_fifths' },
  48: { groupCount: 8, qualifiedCount: 32, directPlaces: 4, wildcardPlace: null, wildcardCount: 0, firstRoundKey: 'round_of_32', rule: 'top4' },
  54: { groupCount: 9, qualifiedCount: 32, directPlaces: 3, wildcardPlace: 4, wildcardCount: 5, firstRoundKey: 'round_of_32', rule: 'top3_plus_5_best_fourths' },
  60: { groupCount: 10, qualifiedCount: 32, directPlaces: 3, wildcardPlace: 4, wildcardCount: 2, firstRoundKey: 'round_of_32', rule: 'top3_plus_2_best_fourths' },
};

function isBomberXLocoDate(eventKey, eventDate) {
  return (eventKey === BOMBER_X_LOCO_EVENT_KEY && eventDate === BOMBER_X_LOCO_EVENT_DATE)
    || (eventKey === HALLOWEEN_EVENT_KEY && eventDate === HALLOWEEN_EVENT_DATE);
}

function isBomberXLocoEvent(event) {
  return event?.meta?.eventMode === 'bomber_x_loco';
}

function buildBomberXLocoSchedule(eventDate = BOMBER_X_LOCO_EVENT_DATE, eventKey = BOMBER_X_LOCO_EVENT_KEY) {
  const halloween = eventKey === HALLOWEEN_EVENT_KEY;
  const offset = halloween ? '+01:00' : '+02:00';
  const drawTime = halloween ? '19:00' : BOMBER_X_LOCO_DRAW_TIME;
  const attendanceTime = halloween ? '20:15' : BOMBER_X_LOCO_ATTENDANCE_DEADLINE_TIME;
  const resetDate = new Date(`${eventDate}T07:00:00${offset}`);
  resetDate.setUTCDate(resetDate.getUTCDate() + 1);
  return {
    cycleKey: `${eventKey}_${eventDate}`,
    eventDate,
    timeZone: 'Europe/Berlin',
    deadlineAt: new Date(`${eventDate}T${BOMBER_X_LOCO_REGISTRATION_DEADLINE_TIME}:00${offset}`),
    // Kein Late-Check-in: die Late-Grenze liegt absichtlich exakt auf dem Anmeldeschluss.
    lateWindowUntil: new Date(`${eventDate}T${BOMBER_X_LOCO_REGISTRATION_DEADLINE_TIME}:00${offset}`),
    drawAt: new Date(`${eventDate}T${drawTime}:00${offset}`),
    attendanceDeadlineAt: new Date(`${eventDate}T${attendanceTime}:00${offset}`),
    tournamentStartAt: new Date(`${eventDate}T${BOMBER_X_LOCO_TOURNAMENT_START_TIME}:00${offset}`),
    resetAt: resetDate,
    eventMode: 'bomber_x_loco',
  };
}

function getBomberXLocoFormat(formatSize) {
  return BOMBER_X_LOCO_FORMATS[Number(formatSize)] || null;
}

module.exports = {
  BOMBER_X_LOCO_ATTENDANCE_DEADLINE_TIME,
  BOMBER_X_LOCO_CHECKIN_CHANNEL_ID,
  BOMBER_X_LOCO_DRAW_TIME,
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_EVENT_KEY,
  BOMBER_X_LOCO_FORMAT_SIZES,
  BOMBER_X_LOCO_FORMATS,
  BOMBER_X_LOCO_GROUP_SIZE,
  BOMBER_X_LOCO_MATCHDAYS,
  BOMBER_X_LOCO_REGISTRATION_DEADLINE_TIME,
  BOMBER_X_LOCO_TOURNAMENT_START_TIME,
  HALLOWEEN_CHECKIN_CHANNEL_ID,
  HALLOWEEN_EVENT_DATE,
  HALLOWEEN_EVENT_KEY,
  buildBomberXLocoSchedule,
  getBomberXLocoFormat,
  isBomberXLocoDate,
  isBomberXLocoEvent,
};
