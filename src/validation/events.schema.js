'use strict';

const {
  EVENT_KEYS,
  EVENT_PROFILE_BY_KEY,
  EVENT_STATUSES,
  TOURNAMENT_FORMAT_SIZES,
  isLeaguePhaseFormat,
} = require('../app/constants');
const {
  hasNoDuplicates,
  requireArray,
  requireIsoDateOrNull,
  requireNonNegativeInteger,
  requireObject,
  requireOneOf,
} = require('./common');

function validateEvent(data, expectedEventKey = null) {
  const errors = [];
  if (!requireObject(errors, data, 'event root')) return errors;

  if (data.version !== 1) errors.push('version must be 1');
  requireOneOf(errors, data.eventKey, EVENT_KEYS, 'eventKey');
  requireOneOf(errors, data.status, EVENT_STATUSES, 'status');

  if (expectedEventKey && data.eventKey !== expectedEventKey) {
    errors.push(`eventKey must match file name: ${expectedEventKey}`);
  }

  if (requireObject(errors, data.cycle, 'cycle')) {
    if (data.cycle.cycleKey !== null && typeof data.cycle.cycleKey !== 'string') errors.push('cycle.cycleKey must be string or null');
    if (data.cycle.eventDate !== null && typeof data.cycle.eventDate !== 'string') errors.push('cycle.eventDate must be string or null');
    if (data.cycle.timezone !== 'Europe/Berlin') errors.push('cycle.timezone must be Europe/Berlin');
  }

  if (requireObject(errors, data.schedule, 'schedule')) {
    const expectedProfile = EVENT_PROFILE_BY_KEY[data.eventKey];
    if (data.schedule.profile !== expectedProfile) errors.push(`schedule.profile must be ${expectedProfile}`);
    ['checkinOpenAt', 'deadlineAt', 'lateWindowUntil', 'drawAt', 'tournamentStartAt', 'resetAt'].forEach(field => {
      requireIsoDateOrNull(errors, data.schedule[field], `schedule.${field}`);
    });
  }

  if (requireObject(errors, data.format, 'format')) {
    if (data.format.minimumRealTeams !== 8) errors.push('format.minimumRealTeams must be 8');
    if (JSON.stringify(data.format.allowedSizes) !== JSON.stringify(TOURNAMENT_FORMAT_SIZES)) {
      errors.push(`format.allowedSizes must be [${TOURNAMENT_FORMAT_SIZES.join(',')}]`);
    }
    if (data.format.size !== null && !TOURNAMENT_FORMAT_SIZES.includes(data.format.size)) {
      errors.push(`format.size must be null or one of ${TOURNAMENT_FORMAT_SIZES.join(', ')}`);
    }
  }

  if (requireObject(errors, data.checkin, 'checkin')) {
    if (!requireArray(errors, data.checkin.entries, 'checkin.entries')) return errors;
    if (!requireArray(errors, data.checkin.activeTeamIds, 'checkin.activeTeamIds')) return errors;
    if (!requireArray(errors, data.checkin.waitlistTeamIds, 'checkin.waitlistTeamIds')) return errors;
    if (!requireArray(errors, data.checkin.lateLeaveBans, 'checkin.lateLeaveBans')) return errors;

    const entryTeamIds = data.checkin.entries.map(entry => entry.teamId).filter(Boolean);
    if (!hasNoDuplicates(entryTeamIds)) errors.push('checkin.entries must contain each team only once per event');

    const active = new Set(data.checkin.activeTeamIds.map(String));
    data.checkin.waitlistTeamIds.map(String).forEach(teamId => {
      if (active.has(teamId)) errors.push(`team ${teamId} cannot be both active and waitlisted`);
    });
  }

  if (!requireArray(errors, data.byes, 'byes')) return errors;
  data.byes.forEach((bye, index) => {
    const path = `byes[${index}]`;
    if (!requireObject(errors, bye, path)) return;
    if (!bye.id || typeof bye.id !== 'string') errors.push(`${path}.id is required`);
    if (!['active', 'removed'].includes(bye.status)) errors.push(`${path}.status must be active or removed`);
  });

  if (requireObject(errors, data.groups, 'groups') && typeof data.groups.groups !== 'object') {
    errors.push('groups.groups must be an object');
  }

  if (data.leaguePhase !== undefined && requireObject(errors, data.leaguePhase, 'leaguePhase')) {
    requireArray(errors, data.leaguePhase.participants, 'leaguePhase.participants');
    requireArray(errors, data.leaguePhase.matchdays, 'leaguePhase.matchdays');
    requireArray(errors, data.leaguePhase.standings, 'leaguePhase.standings');
    if (data.leaguePhase.phaseType === 'league') {
      if (!isLeaguePhaseFormat(data.format.size)) errors.push('leaguePhase requires locked format.size 14, 18 or 20');
      if (data.leaguePhase.participants.length !== data.format.size) errors.push('leaguePhase.participants must match format.size');
      if (data.leaguePhase.matchdays.length !== 4) errors.push('leaguePhase.matchdays must contain 4 matchdays');
    }
  }

  if (requireObject(errors, data.knockout, 'knockout')) {
    if (!requireObject(errors, data.knockout.source, 'knockout.source')) return errors;
    if (data.knockout.source.avoidSameGroupRematches !== true) {
      errors.push('knockout.source.avoidSameGroupRematches must be true');
    }
  }

  if (requireObject(errors, data.ceremony, 'ceremony')) {
    requireIsoDateOrNull(errors, data.ceremony.postedAt, 'ceremony.postedAt');
    if (data.ceremony.teamAchievements !== undefined && requireObject(errors, data.ceremony.teamAchievements, 'ceremony.teamAchievements')) {
      requireIsoDateOrNull(errors, data.ceremony.teamAchievements.appliedAt, 'ceremony.teamAchievements.appliedAt');
    }
    if (data.ceremony.teamStats !== undefined && requireObject(errors, data.ceremony.teamStats, 'ceremony.teamStats')) {
      requireIsoDateOrNull(errors, data.ceremony.teamStats.appliedAt, 'ceremony.teamStats.appliedAt');
      requireArray(errors, data.ceremony.teamStats.participantTeamIds, 'ceremony.teamStats.participantTeamIds');
      requireNonNegativeInteger(errors, data.ceremony.teamStats.matchCount, 'ceremony.teamStats.matchCount');
    }
  }

  if (requireObject(errors, data.reset, 'reset')) {
    requireIsoDateOrNull(errors, data.reset.resetAt, 'reset.resetAt');
    requireIsoDateOrNull(errors, data.reset.completedAt, 'reset.completedAt');
    if (data.reset.keepStats !== true) errors.push('reset.keepStats must be true');
  }

  return errors;
}

module.exports = {
  validateEvent,
};
