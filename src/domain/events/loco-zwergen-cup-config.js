'use strict';

const LOCO_ZWERGEN_CUP_EVENT_DATE = '2026-09-12';
const LOCO_ZWERGEN_CUP_EVENT_MODE = 'loco_zwergen_cup';
const LOCO_ZWERGEN_CUP_CYCLE_KEY = `saturday_${LOCO_ZWERGEN_CUP_EVENT_DATE}`;

function isLocoZwergenCupDate(eventKey, eventDate) {
  return eventKey === 'saturday' && String(eventDate || '') === LOCO_ZWERGEN_CUP_EVENT_DATE;
}

function isLocoZwergenCupEvent(event) {
  return event?.meta?.eventMode === LOCO_ZWERGEN_CUP_EVENT_MODE;
}

module.exports = {
  LOCO_ZWERGEN_CUP_CYCLE_KEY,
  LOCO_ZWERGEN_CUP_EVENT_DATE,
  LOCO_ZWERGEN_CUP_EVENT_MODE,
  isLocoZwergenCupDate,
  isLocoZwergenCupEvent,
};
