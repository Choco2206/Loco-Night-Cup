'use strict';

const CHECKIN_EVENT_STATUSES = ['idle', 'checkin', 'cancelled', 'reset'];

const EVENT_WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function getProfileForEvent(eventKey, settings, event = {}) {
  const profileKey = settings.timeProfiles?.eventProfiles?.[eventKey] || event.schedule?.profile || 'early';
  return settings.timeProfiles?.profiles?.[profileKey] || null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateOnly(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getEventDateValue(eventKey, event = {}, now = new Date()) {
  if (event.cycle?.eventDate) return event.cycle.eventDate;

  const targetDay = EVENT_WEEKDAY_INDEX[eventKey];
  if (targetDay === undefined) return null;

  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const diffDays = (targetDay - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diffDays);
  return toDateOnly(date);
}

function parseDateTime(dateValue, timeValue, addDay = false) {
  if (!dateValue || !timeValue) return null;
  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (addDay) parsed.setDate(parsed.getDate() + 1);
  return parsed;
}

function getScheduleDate(eventKey, event, settings, explicitField, profileField, scheduleField, addDayField = false, now = new Date()) {
  if (event.schedule?.[explicitField]) {
    const explicit = new Date(event.schedule[explicitField]);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }

  const profile = getProfileForEvent(eventKey, settings, event);
  const dateValue = getEventDateValue(eventKey, event, now);
  const timeValue = profile?.[profileField] || event.schedule?.[scheduleField];
  const addDay = addDayField && profile?.startIsNextDay === true;
  return parseDateTime(dateValue, timeValue, addDay);
}

function getDeadlineAt(eventKey, event, settings, now = new Date()) {
  return getScheduleDate(eventKey, event, settings, 'deadlineAt', 'deadlineTime', 'deadlineTime', false, now);
}

function getLateWindowUntil(eventKey, event, settings, now = new Date()) {
  return getScheduleDate(
    eventKey,
    event,
    settings,
    'lateWindowUntil',
    'lateWindowUntilTime',
    'lateWindowUntilTime',
    false,
    now
  );
}

function getDrawAt(eventKey, event, settings, now = new Date()) {
  return getScheduleDate(eventKey, event, settings, 'drawAt', 'drawTime', 'drawTime', false, now);
}

function getTournamentStartAt(eventKey, event, settings, now = new Date()) {
  return getScheduleDate(
    eventKey,
    event,
    settings,
    'tournamentStartAt',
    'tournamentStartTime',
    'tournamentStartTime',
    true,
    now
  );
}

function isAfterDeadline(eventKey, event, settings, now = new Date()) {
  const deadlineAt = getDeadlineAt(eventKey, event, settings, now);
  if (!deadlineAt) return false;
  return now.getTime() > deadlineAt.getTime();
}

function canUseCheckinStatus(status) {
  return CHECKIN_EVENT_STATUSES.includes(status);
}

function getCheckinWindowState(eventKey, event, settings, now = new Date()) {
  if (event.status === 'cancelled') {
    return { label: 'Abgesagt', phase: 'cancelled', canJoin: false, canLeave: false };
  }

  if (event.status === 'reset') {
    return { label: 'Reset', phase: 'reset', canJoin: false, canLeave: false };
  }

  if (!canUseCheckinStatus(event.status)) {
    return { label: 'Geschlossen', phase: 'closed', canJoin: false, canLeave: false };
  }

  if (event.status === 'checkin' && event.checkin?.isOpen === true) {
    return { label: 'Offen', phase: 'manual_open', canJoin: true, canLeave: true };
  }

  const deadlineAt = getDeadlineAt(eventKey, event, settings, now);
  const lateWindowUntil = getLateWindowUntil(eventKey, event, settings, now);

  if (lateWindowUntil) {
    if (deadlineAt && now.getTime() <= deadlineAt.getTime()) {
      return { label: 'Offen', phase: 'regular', canJoin: true, canLeave: true };
    }

    if (now.getTime() <= lateWindowUntil.getTime()) {
      return { label: 'Late Window', phase: 'late', canJoin: true, canLeave: true };
    }

    return { label: 'Geschlossen', phase: 'closed_after_late', canJoin: false, canLeave: true };
  }

  return { label: 'Geschlossen', phase: 'closed', canJoin: false, canLeave: true };
}

function canAcceptCheckinActions(eventKey, event, settings, now = new Date()) {
  return getCheckinWindowState(eventKey, event, settings, now).canJoin;
}

function getCheckinWindowLabel(eventKey, event, settings, now = new Date()) {
  return getCheckinWindowState(eventKey, event, settings, now).label;
}

module.exports = {
  CHECKIN_EVENT_STATUSES,
  canAcceptCheckinActions,
  canUseCheckinStatus,
  getCheckinWindowLabel,
  getCheckinWindowState,
  getDeadlineAt,
  getDrawAt,
  getEventDateValue,
  getLateWindowUntil,
  getProfileForEvent,
  getTournamentStartAt,
  isAfterDeadline,
};
