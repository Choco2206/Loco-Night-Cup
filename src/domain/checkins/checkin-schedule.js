'use strict';

const CHECKIN_EVENT_STATUSES = [
  'idle',
  'checkin',
  'checkin_open',
  'deadline_reached',
  'checkin_closed',
  'draw_ready',
  'cancelled',
  'reset',
];

const EVENT_WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DEFAULT_TIMEZONE = 'Europe/Berlin';

function getTimeZone(settings, event = {}) {
  return event.cycle?.timezone || settings.timeProfiles?.timezone || DEFAULT_TIMEZONE;
}

function getProfileForEvent(eventKey, settings, event = {}) {
  const profileKey = settings.timeProfiles?.eventProfiles?.[eventKey] || event.schedule?.profile || 'early';
  return settings.timeProfiles?.profiles?.[profileKey] || null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateOnly(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getZonedWeekday(date, timeZone = DEFAULT_TIMEZONE) {
  const value = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value);
}

function isActiveCycle(event = {}) {
  if (event.cycle?.eventDate) return true;
  if (event.status && !['idle', 'reset', 'cancelled', 'completed'].includes(event.status)) return true;
  if (event.checkin?.isOpen === true) return true;
  if ((event.checkin?.entries || []).length) return true;
  if ((event.checkin?.activeTeamIds || []).length) return true;
  if ((event.checkin?.waitlistTeamIds || []).length) return true;
  if (event.format?.lockedAt) return true;
  if (event.groups?.status && event.groups.status !== 'not_created') return true;
  if (event.knockout?.status && event.knockout.status !== 'not_created') return true;
  return false;
}

function getEventDateValue(eventKey, event = {}, now = new Date(), settings = {}) {
  const timeZone = getTimeZone(settings, event);
  if (event.cycle?.eventDate) {
    const resetAt = getCycleResetAt(event.cycle.eventDate, timeZone);
    if (!resetAt || now.getTime() < resetAt.getTime()) return event.cycle.eventDate;
  }

  return getCurrentCycleDateValue(eventKey, event, now, settings);
}

function getCurrentCycleDateValue(eventKey, event = {}, now = new Date(), settings = {}) {
  const targetDay = EVENT_WEEKDAY_INDEX[eventKey];
  if (targetDay === undefined) return null;

  const timeZone = getTimeZone(settings, event);
  const zonedDay = getZonedWeekday(now, timeZone);
  const previousDiffDays = -((zonedDay - targetDay + 7) % 7);
  const previousDate = new Date(now);
  previousDate.setUTCDate(previousDate.getUTCDate() + previousDiffDays);
  const previousDateValue = toDateOnly(previousDate, timeZone);
  const resetAt = getCycleResetAt(previousDateValue, timeZone);

  if (resetAt && now.getTime() < resetAt.getTime()) return previousDateValue;

  const nextDate = new Date(previousDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 7);
  return toDateOnly(nextDate, timeZone);
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  }).formatToParts(date);
  const zone = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT';
  const match = zone.match(/^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/);
  if (!match) return 0;
  const sign = match.groups.sign === '-' ? -1 : 1;
  const hours = Number(match.groups.hours || 0);
  const minutes = Number(match.groups.minutes || 0);
  return sign * (hours * 60 + minutes);
}

function parseDateTime(dateValue, timeValue, addDay = false, timeZone = DEFAULT_TIMEZONE) {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = getTimeZoneOffsetMinutes(timeZone, new Date(utcMs));
  let parsed = new Date(utcMs - offset * 60 * 1000);
  offset = getTimeZoneOffsetMinutes(timeZone, parsed);
  parsed = new Date(utcMs - offset * 60 * 1000);
  if (addDay) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}

function getCycleResetAt(eventDate, timeZone = DEFAULT_TIMEZONE) {
  return parseDateTime(eventDate, '07:00', true, timeZone);
}

function getScheduleDate(eventKey, event, settings, explicitField, profileField, scheduleField, addDayField = false, now = new Date()) {
  if (event.schedule?.[explicitField]) {
    const explicit = new Date(event.schedule[explicitField]);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }

  const profile = getProfileForEvent(eventKey, settings, event);
  const dateValue = getEventDateValue(eventKey, event, now, settings);
  const timeValue = profile?.[profileField] || event.schedule?.[scheduleField];
  const addDay = addDayField && profile?.startIsNextDay === true;
  return parseDateTime(dateValue, timeValue, addDay, getTimeZone(settings, event));
}

function buildCycleKey(eventKey, eventDate) {
  return eventDate ? `${eventKey}_${eventDate}` : null;
}

function getPlannedSchedule(eventKey, event, settings, now = new Date()) {
  const profile = getProfileForEvent(eventKey, settings, event);
  const eventDate = getEventDateValue(eventKey, event, now, settings);
  const timeZone = getTimeZone(settings, event);
  const deadlineAt = parseDateTime(eventDate, profile?.deadlineTime || event.schedule?.deadlineTime, false, timeZone);
  const lateWindowUntil = parseDateTime(eventDate, profile?.lateWindowUntilTime || event.schedule?.lateWindowUntilTime, false, timeZone);
  const drawAt = parseDateTime(eventDate, profile?.drawTime || event.schedule?.drawTime, false, timeZone);
  const tournamentStartAt = parseDateTime(
    eventDate,
    profile?.tournamentStartTime || event.schedule?.tournamentStartTime,
    profile?.startIsNextDay === true,
    timeZone
  );
  const resetAt = getCycleResetAt(eventDate, timeZone);

  return {
    cycleKey: buildCycleKey(eventKey, eventDate),
    eventDate,
    timeZone,
    deadlineAt,
    lateWindowUntil,
    drawAt,
    tournamentStartAt,
    resetAt,
  };
}

function ensureEventCycle(eventKey, event, settings, now = new Date()) {
  const previousEventDate = event.cycle?.eventDate || null;
  const previousResetAt = previousEventDate ? getCycleResetAt(previousEventDate, getTimeZone(settings, event)) : null;
  const planned = getPlannedSchedule(eventKey, event, settings, now);
  if (!planned.eventDate) return false;
  const switchedCycle = Boolean(previousEventDate && previousEventDate !== planned.eventDate && previousResetAt && now.getTime() >= previousResetAt.getTime());

  let changed = false;
  event.cycle = event.cycle || {};
  event.schedule = event.schedule || {};
  event.reset = event.reset || {};

  const next = {
    cycleKey: planned.cycleKey,
    eventDate: planned.eventDate,
    timezone: planned.timeZone,
    deadlineAt: planned.deadlineAt?.toISOString() || null,
    lateWindowUntil: planned.lateWindowUntil?.toISOString() || null,
    drawAt: planned.drawAt?.toISOString() || null,
    tournamentStartAt: planned.tournamentStartAt?.toISOString() || null,
    resetAt: planned.resetAt?.toISOString() || null,
  };

  if (event.cycle.cycleKey !== next.cycleKey) {
    event.cycle.cycleKey = next.cycleKey;
    changed = true;
  }
  if (event.cycle.eventDate !== next.eventDate) {
    event.cycle.eventDate = next.eventDate;
    changed = true;
  }
  if (event.cycle.timezone !== next.timezone) {
    event.cycle.timezone = next.timezone;
    changed = true;
  }

  for (const field of ['deadlineAt', 'lateWindowUntil', 'drawAt', 'tournamentStartAt', 'resetAt']) {
    if (event.schedule[field] !== next[field]) {
      event.schedule[field] = next[field];
      changed = true;
    }
  }

  if (event.reset.resetAt !== next.resetAt) {
    event.reset.resetAt = next.resetAt;
    changed = true;
  }

  if (switchedCycle) {
    resetToOpenCheckinCycle(event);
    changed = true;
  } else if (planned.deadlineAt && now.getTime() < planned.deadlineAt.getTime() && !['checkin', 'checkin_open'].includes(event.status)) {
    resetToOpenCheckinCycle(event);
    changed = true;
  }

  return changed;
}

function resetToOpenCheckinCycle(event) {
  event.status = 'checkin_open';
  event.format = {
    ...(event.format || {}),
    size: null,
    realTeamCount: 0,
    byeCount: 0,
    activeByeCount: 0,
    waitlistByeCount: 0,
    waitlistCount: 0,
    lockedAt: null,
    lockedByUserId: null,
    participants: [],
  };
  event.checkin = {
    ...(event.checkin || {}),
    isOpen: true,
    closedAt: null,
    entries: [],
    activeTeamIds: [],
    waitlistTeamIds: [],
    lateLeaveBans: [],
  };
  event.byes = [];
  event.groups = {
    status: 'not_created',
    drawnAt: null,
    drawnBy: null,
    groups: {},
  };
  event.knockout = {
    status: 'not_created',
    createdAt: null,
    source: { qualifiedRule: null, avoidSameGroupRematches: true },
    rounds: {},
  };
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
  if (['checkin_closed', 'draw_ready', 'groups', 'groups_running'].includes(event.status)) {
    return { label: 'Geschlossen', phase: event.status, canJoin: false, canLeave: false };
  }

  if (event.status === 'cancelled') {
    return { label: 'Abgesagt', phase: 'cancelled', canJoin: false, canLeave: false };
  }

  if (event.status === 'reset') {
    return { label: 'Reset', phase: 'reset', canJoin: false, canLeave: false };
  }

  if (!canUseCheckinStatus(event.status)) {
    return { label: 'Geschlossen', phase: 'closed', canJoin: false, canLeave: false };
  }

  const deadlineAt = getDeadlineAt(eventKey, event, settings, now);
  const lateWindowUntil = getLateWindowUntil(eventKey, event, settings, now);
  const isExplicitlyOpen = event.status === 'idle' ? true : event.checkin?.isOpen !== false;

  if (lateWindowUntil) {
    if (deadlineAt && now.getTime() <= deadlineAt.getTime()) {
      const isOpen = isExplicitlyOpen;
      return { label: isOpen ? 'Offen' : 'Geschlossen', phase: 'regular', canJoin: isOpen, canLeave: isOpen };
    }

    if (now.getTime() <= lateWindowUntil.getTime()) {
      const isOpen = isExplicitlyOpen;
      return { label: isOpen ? 'Late Window' : 'Geschlossen', phase: 'late', canJoin: isOpen, canLeave: isOpen };
    }

    return { label: 'Geschlossen', phase: 'closed_after_late', canJoin: false, canLeave: false };
  }

  if (event.status === 'checkin' && event.checkin?.isOpen === true) {
    return { label: 'Offen', phase: 'manual_open', canJoin: true, canLeave: true };
  }

  return { label: 'Geschlossen', phase: 'closed', canJoin: false, canLeave: false };
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
  getCycleResetAt,
  getPlannedSchedule,
  getLateWindowUntil,
  getProfileForEvent,
  getTournamentStartAt,
  ensureEventCycle,
  isAfterDeadline,
  parseDateTime,
};
