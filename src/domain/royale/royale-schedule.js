'use strict';

const TIME_ZONE = 'Europe/Berlin';
const SPECIAL_EVENT_DATES = Object.freeze({
  '2026-08': '2026-08-22',
});

function pad2(value) {
  return String(value).padStart(2, '0');
}

function dateValue(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function getLastSaturday(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const offset = (lastDay.getUTCDay() - 6 + 7) % 7;
  return dateValue(year, month, lastDay.getUTCDate() - offset);
}

function getRoyaleEventDate(year, month, overrides = SPECIAL_EVENT_DATES) {
  const key = `${year}-${pad2(month)}`;
  return overrides[key] || getLastSaturday(year, month);
}

function isRoyaleEventDate(eventDate, overrides = SPECIAL_EVENT_DATES) {
  const match = String(eventDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  return getRoyaleEventDate(Number(match[1]), Number(match[2]), overrides) === eventDate;
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
  return sign * (Number(match.groups.hours || 0) * 60 + Number(match.groups.minutes || 0));
}

function parseBerlinDateTime(value, time, addDay = false) {
  const [year, month, day] = value.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute);
  let parsed = new Date(utcMs - getTimeZoneOffsetMinutes(TIME_ZONE, new Date(utcMs)) * 60000);
  parsed = new Date(utcMs - getTimeZoneOffsetMinutes(TIME_ZONE, parsed) * 60000);
  if (addDay) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}

function addDays(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return dateValue(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function buildRoyaleSchedule(eventDate, { checkinLeadDays = 7 } = {}) {
  return {
    eventKey: 'knockout_royale',
    cycleKey: `knockout_royale_${eventDate}`,
    eventDate,
    timezone: TIME_ZONE,
    checkinOpenAt: parseBerlinDateTime(addDays(eventDate, -checkinLeadDays), '07:00').toISOString(),
    deadlineAt: parseBerlinDateTime(eventDate, '23:45').toISOString(),
    lateWindowUntil: parseBerlinDateTime(eventDate, '00:00', true).toISOString(),
    bracketAt: parseBerlinDateTime(eventDate, '00:05', true).toISOString(),
    tournamentStartAt: parseBerlinDateTime(eventDate, '00:15', true).toISOString(),
    firstReleaseUntil: parseBerlinDateTime(eventDate, '00:20', true).toISOString(),
    resetAt: parseBerlinDateTime(eventDate, '07:00', true).toISOString(),
  };
}

function getNextRoyaleSchedule(now = new Date(), options = {}) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  let year = Number(values.year);
  let month = Number(values.month);
  let schedule = buildRoyaleSchedule(getRoyaleEventDate(year, month, options.overrides), options);
  if (now.getTime() >= new Date(schedule.resetAt).getTime()) {
    month += 1;
    if (month === 13) { month = 1; year += 1; }
    schedule = buildRoyaleSchedule(getRoyaleEventDate(year, month, options.overrides), options);
  }
  return schedule;
}

module.exports = {
  SPECIAL_EVENT_DATES,
  TIME_ZONE,
  buildRoyaleSchedule,
  getLastSaturday,
  getNextRoyaleSchedule,
  getRoyaleEventDate,
  isRoyaleEventDate,
};
