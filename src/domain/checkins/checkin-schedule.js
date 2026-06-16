'use strict';

const CHECKIN_EVENT_STATUSES = ['idle', 'checkin', 'cancelled', 'reset'];

function getProfileForEvent(eventKey, settings, event) {
  const profileKey = settings.timeProfiles?.eventProfiles?.[eventKey] || event.schedule?.profile || 'early';
  return settings.timeProfiles?.profiles?.[profileKey] || null;
}

function parseDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDeadlineAt(eventKey, event, settings) {
  if (event.schedule?.deadlineAt) {
    const explicit = new Date(event.schedule.deadlineAt);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }

  const eventDate = event.cycle?.eventDate;
  const profile = getProfileForEvent(eventKey, settings, event);
  const deadlineTime = profile?.deadlineTime || event.schedule?.deadlineTime;
  return parseDateTime(eventDate, deadlineTime);
}

function getLateWindowUntil(eventKey, event, settings) {
  if (event.schedule?.lateWindowUntil) {
    const explicit = new Date(event.schedule.lateWindowUntil);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }

  const eventDate = event.cycle?.eventDate;
  const profile = getProfileForEvent(eventKey, settings, event);
  const lateWindowUntilTime = profile?.lateWindowUntilTime || event.schedule?.lateWindowUntilTime;
  return parseDateTime(eventDate, lateWindowUntilTime);
}

function isAfterDeadline(eventKey, event, settings, now = new Date()) {
  const deadlineAt = getDeadlineAt(eventKey, event, settings);
  if (!deadlineAt) return false;
  return now.getTime() > deadlineAt.getTime();
}

function canUseCheckinStatus(status) {
  return CHECKIN_EVENT_STATUSES.includes(status);
}

function canAcceptCheckinActions(event) {
  if (!canUseCheckinStatus(event.status)) return false;
  if (event.status === 'cancelled' || event.status === 'reset') return false;
  return event.status === 'checkin' && event.checkin?.isOpen === true;
}

function getCheckinWindowLabel(eventKey, event, settings, now = new Date()) {
  if (event.status === 'cancelled') return 'Abgesagt';
  if (event.status === 'reset') return 'Reset';
  if (!event.checkin?.isOpen || event.status !== 'checkin') return 'Geschlossen';

  const deadlineAt = getDeadlineAt(eventKey, event, settings);
  const lateWindowUntil = getLateWindowUntil(eventKey, event, settings);
  if (deadlineAt && now <= deadlineAt) return 'Offen';
  if (lateWindowUntil && now <= lateWindowUntil) return 'Late Window';
  return 'Nach Deadline';
}

module.exports = {
  CHECKIN_EVENT_STATUSES,
  canAcceptCheckinActions,
  canUseCheckinStatus,
  getCheckinWindowLabel,
  getDeadlineAt,
  getLateWindowUntil,
  isAfterDeadline,
};
