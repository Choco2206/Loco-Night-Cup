'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('./checkin-repository');
const { recalculateCheckinFormat } = require('./checkin-format');
const { createLateWithdrawalBan } = require('./checkin-ban-integration');
const {
  assertCheckinActionAllowed,
  assertEventSupportsPhaseThree,
  assertTeamHasNoActiveBan,
  getEligibleTeamForUser,
} = require('./checkin-validation');
const { isAfterDeadline } = require('./checkin-schedule');

function nowIso(now = new Date()) {
  return now.toISOString();
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function hasTeamEntry(event, teamId) {
  return (event.checkin?.entries || []).some(entry => String(entry.teamId) === String(teamId));
}

function ensureCheckinShape(event) {
  event.checkin = event.checkin || {};
  event.checkin.entries = Array.isArray(event.checkin.entries) ? event.checkin.entries : [];
  event.checkin.activeTeamIds = Array.isArray(event.checkin.activeTeamIds) ? event.checkin.activeTeamIds : [];
  event.checkin.waitlistTeamIds = Array.isArray(event.checkin.waitlistTeamIds) ? event.checkin.waitlistTeamIds : [];
  event.checkin.lateLeaveBans = Array.isArray(event.checkin.lateLeaveBans) ? event.checkin.lateLeaveBans : [];
  event.format = event.format || {};
  return event;
}

function removeTeamFromEvent(event, teamId) {
  ensureCheckinShape(event);
  const id = String(teamId);
  const before = event.checkin.entries.length;
  event.checkin.entries = event.checkin.entries.filter(entry => String(entry.teamId) !== id);
  event.checkin.activeTeamIds = event.checkin.activeTeamIds.filter(entryTeamId => String(entryTeamId) !== id);
  event.checkin.waitlistTeamIds = event.checkin.waitlistTeamIds.filter(entryTeamId => String(entryTeamId) !== id);
  return before !== event.checkin.entries.length;
}

function checkInTeam({ eventKey, userId, now = new Date() }) {
  const settings = readSettings();
  const team = getEligibleTeamForUser(userId);
  assertTeamHasNoActiveBan({ team, actorUserId: userId, now });

  let result;
  updateEventData(eventKey, event => {
    ensureCheckinShape(event);
    assertCheckinActionAllowed({ eventKey, event, settings, now });

    if (hasTeamEntry(event, team.id)) {
      recalculateCheckinFormat(event, settings);
      result = { changed: false, alreadyCheckedIn: true, team, event };
      return event;
    }

    const timestamp = nowIso(now);
    event.checkin.entries.push({
      teamId: String(team.id),
      checkedInByUserId: String(userId),
      checkedInAt: timestamp,
    });
    event.meta = { ...event.meta, updatedAt: timestamp };

    recalculateCheckinFormat(event, settings);
    result = { changed: true, alreadyCheckedIn: false, team, event };
    return event;
  });

  return result;
}

function withdrawTeam({ eventKey, userId, now = new Date() }) {
  const settings = readSettings();
  const team = getEligibleTeamForUser(userId);
  const event = readEventData(eventKey);
  ensureCheckinShape(event);
  assertEventSupportsPhaseThree(event);

  if (event.status === 'cancelled' || event.status === 'reset') {
    throw new Error('Bei diesem Event ist keine Abmeldung moeglich.');
  }

  if (!hasTeamEntry(event, team.id)) {
    return { changed: false, wasCheckedIn: false, lateWithdrawal: false, team, event };
  }

  if (isAfterDeadline(eventKey, event, settings, now)) {
    const ban = createLateWithdrawalBan({ team, eventKey, actorUserId: userId, settings, now });
    const affectedEventKeys = removeTeamFromAllEvents({ teamId: team.id, settings, now });

    updateEventData(eventKey, current => {
      ensureCheckinShape(current);
      current.checkin.lateLeaveBans.push({
        banId: ban.id,
        teamId: String(team.id),
        createdAt: nowIso(now),
        createdByUserId: String(userId),
      });
      return current;
    });

    return {
      changed: true,
      wasCheckedIn: true,
      lateWithdrawal: true,
      ban,
      affectedEventKeys,
      team,
    };
  }

  let updatedEvent;
  updateEventData(eventKey, current => {
    removeTeamFromEvent(current, team.id);
    recalculateCheckinFormat(current, settings);
    current.meta = { ...current.meta, updatedAt: nowIso(now) };
    updatedEvent = current;
    return current;
  });

  return { changed: true, wasCheckedIn: true, lateWithdrawal: false, team, event: updatedEvent };
}

function removeTeamFromAllEvents({ teamId, settings = readSettings(), now = new Date() }) {
  const affectedEventKeys = [];

  for (const eventKey of EVENT_KEYS) {
    updateEventData(eventKey, event => {
      const changed = removeTeamFromEvent(event, teamId);
      if (!changed) return event;

      recalculateCheckinFormat(event, settings);
      event.meta = { ...event.meta, updatedAt: nowIso(now) };
      affectedEventKeys.push(eventKey);
      return event;
    });
  }

  return affectedEventKeys;
}

function refreshEventFormat(eventKey) {
  const settings = readSettings();
  return updateEventData(eventKey, event => recalculateCheckinFormat(event, settings));
}

function getPublicCheckinState(eventKey) {
  const settings = readSettings();
  const event = refreshEventFormat(eventKey);
  return { event, settings };
}

module.exports = {
  checkInTeam,
  getPublicCheckinState,
  hasTeamEntry,
  refreshEventFormat,
  removeTeamFromAllEvents,
  withdrawTeam,
};
