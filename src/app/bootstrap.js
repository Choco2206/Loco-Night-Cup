'use strict';

const { initializeStorage, FILES, updateJson } = require('../storage');
const { createEventDefault } = require('../storage/defaults');
const { validateAllStorage } = require('../validation');
const { repairTeamRuntimeData } = require('../domain/teams/team-runtime-repair');
const {
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_FORMAT_SIZES,
  buildBomberXLocoSchedule,
} = require('../domain/events/bomber-x-loco-config');

function activateBomberXLocoEvent(now = new Date()) {
  const schedule = buildBomberXLocoSchedule(BOMBER_X_LOCO_EVENT_DATE);
  if (now.getTime() >= schedule.resetAt.getTime()) return false;

  updateJson(FILES.events.saturday, createEventDefault('saturday'), event => {
    const timestamp = now.toISOString();
    event.status = ['idle', 'checkin', 'checkin_open'].includes(event.status) ? 'checkin_open' : event.status;
    event.cycle = {
      ...(event.cycle || {}),
      cycleKey: schedule.cycleKey,
      eventDate: schedule.eventDate,
      timezone: schedule.timeZone,
    };
    event.schedule = {
      ...(event.schedule || {}),
      deadlineAt: schedule.deadlineAt.toISOString(),
      lateWindowUntil: schedule.lateWindowUntil.toISOString(),
      drawAt: schedule.drawAt.toISOString(),
      attendanceDeadlineAt: schedule.attendanceDeadlineAt.toISOString(),
      tournamentStartAt: schedule.tournamentStartAt.toISOString(),
      resetAt: schedule.resetAt.toISOString(),
    };
    event.format = {
      ...(event.format || {}),
      minimumRealTeams: 6,
      allowedSizes: [...BOMBER_X_LOCO_FORMAT_SIZES],
    };
    event.checkin = { ...(event.checkin || {}), isOpen: true, openedAt: event.checkin?.openedAt || timestamp, closedAt: null };
    event.reset = { ...(event.reset || {}), resetAt: schedule.resetAt.toISOString() };
    event.meta = { ...(event.meta || {}), eventMode: schedule.eventMode, updatedAt: timestamp };
    return event;
  });

  console.log('[bootstrap] Saturday-State als offiziellen Bomber X Loco Check-in aktiviert');
  return true;
}

function bootstrapPhaseOne() {
  initializeStorage();
  activateBomberXLocoEvent();
  repairTeamRuntimeData();
  validateAllStorage();

  return {
    ok: true,
    phase: 'phase-1-storage-foundation',
  };
}

module.exports = {
  activateBomberXLocoEvent,
  bootstrapPhaseOne,
};
