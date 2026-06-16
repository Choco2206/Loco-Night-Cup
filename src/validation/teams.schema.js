'use strict';

const { REGISTRATION_STATUSES, TEAM_STATUSES } = require('../app/constants');
const {
  hasNoDuplicates,
  requireArray,
  requireIsoDateOrNull,
  requireNonNegativeInteger,
  requireObject,
  requireOneOf,
  requireSnowflakeOrNull,
} = require('./common');

const STAT_FIELDS = [
  'matches',
  'wins',
  'draws',
  'losses',
  'goalsFor',
  'goalsAgainst',
  'goalDifference',
  'tournamentWins',
  'finalAppearances',
  'thirdPlaceFinishes',
];

function validateTeam(team, index, seenTeamIds, seenActiveNames, seenActiveUsers, errors) {
  const path = `teams[${index}]`;
  if (!requireObject(errors, team, path)) return;

  if (!team.id || typeof team.id !== 'string') errors.push(`${path}.id is required`);
  if (seenTeamIds.has(team.id)) errors.push(`${path}.id must be unique`);
  seenTeamIds.add(team.id);

  requireOneOf(errors, team.status, TEAM_STATUSES, `${path}.status`);
  requireOneOf(errors, team.registrationStatus, REGISTRATION_STATUSES, `${path}.registrationStatus`);

  if (typeof team.clubName !== 'string' || team.clubName.trim().length < 2) {
    errors.push(`${path}.clubName is required`);
  }

  if (typeof team.normalizedClubName !== 'string' || !team.normalizedClubName.trim()) {
    errors.push(`${path}.normalizedClubName is required`);
  }

  if (team.status !== 'deleted') {
    if (seenActiveNames.has(team.normalizedClubName)) {
      errors.push(`${path}.normalizedClubName must be unique for non-deleted teams`);
    }
    seenActiveNames.add(team.normalizedClubName);
  }

  if (team.registrationStatus === 'complete' && !team.logo) {
    errors.push(`${path}.logo is required when registrationStatus is complete`);
  }

  if (team.logo !== null && team.logo !== undefined) {
    if (requireObject(errors, team.logo, `${path}.logo`)) {
      if (typeof team.logo.fileName !== 'string') errors.push(`${path}.logo.fileName is required`);
      if (typeof team.logo.path !== 'string') errors.push(`${path}.logo.path is required`);
      requireIsoDateOrNull(errors, team.logo.uploadedAt, `${path}.logo.uploadedAt`);
      requireSnowflakeOrNull(errors, team.logo.uploadedByUserId, `${path}.logo.uploadedByUserId`);
    }
  }

  if (team.status !== 'leaderless') {
    if (!requireObject(errors, team.manager, `${path}.manager`)) return;
    requireSnowflakeOrNull(errors, team.manager.userId, `${path}.manager.userId`);
    requireIsoDateOrNull(errors, team.manager.addedAt, `${path}.manager.addedAt`);
  }

  if (!requireArray(errors, team.coManagers, `${path}.coManagers`)) return;

  const managerId = team.manager?.userId ? String(team.manager.userId) : null;
  const coManagerIds = [];

  team.coManagers.forEach((coManager, coIndex) => {
    const coPath = `${path}.coManagers[${coIndex}]`;
    if (!requireObject(errors, coManager, coPath)) return;
    requireSnowflakeOrNull(errors, coManager.userId, `${coPath}.userId`);
    requireIsoDateOrNull(errors, coManager.addedAt, `${coPath}.addedAt`);
    requireSnowflakeOrNull(errors, coManager.addedByUserId, `${coPath}.addedByUserId`);
    if (coManager.userId) coManagerIds.push(String(coManager.userId));
  });

  if (!hasNoDuplicates(coManagerIds)) errors.push(`${path}.coManagers must not contain duplicate users`);
  if (managerId && coManagerIds.includes(managerId)) errors.push(`${path}.coManagers must not contain the manager`);

  if (team.status !== 'deleted') {
    [managerId, ...coManagerIds].filter(Boolean).forEach(userId => {
      if (seenActiveUsers.has(userId)) errors.push(`${path} user ${userId} is already assigned to another non-deleted team`);
      seenActiveUsers.add(userId);
    });
  }

  if (requireObject(errors, team.stats, `${path}.stats`)) {
    STAT_FIELDS.forEach(field => requireNonNegativeInteger(errors, team.stats[field], `${path}.stats.${field}`));
    if (Number.isInteger(team.stats.goalsFor) && Number.isInteger(team.stats.goalsAgainst)) {
      const diff = team.stats.goalsFor - team.stats.goalsAgainst;
      if (team.stats.goalDifference !== diff) errors.push(`${path}.stats.goalDifference must equal goalsFor - goalsAgainst`);
    }
  }

  if (requireObject(errors, team.meta, `${path}.meta`)) {
    requireIsoDateOrNull(errors, team.meta.createdAt, `${path}.meta.createdAt`);
    requireSnowflakeOrNull(errors, team.meta.createdByUserId, `${path}.meta.createdByUserId`);
    requireIsoDateOrNull(errors, team.meta.updatedAt, `${path}.meta.updatedAt`);
    requireIsoDateOrNull(errors, team.meta.deletedAt, `${path}.meta.deletedAt`);
    requireSnowflakeOrNull(errors, team.meta.deletedByUserId, `${path}.meta.deletedByUserId`);

    if (team.status === 'deleted' && !team.meta.deletedAt) errors.push(`${path}.meta.deletedAt is required for deleted teams`);
    if (team.status === 'deleted' && !team.meta.deletedByUserId) errors.push(`${path}.meta.deletedByUserId is required for deleted teams`);
  }
}

function validateTeams(data) {
  const errors = [];
  if (!requireObject(errors, data, 'teams root')) return errors;
  if (data.version !== 1) errors.push('version must be 1');
  if (!requireArray(errors, data.teams, 'teams')) return errors;

  const seenTeamIds = new Set();
  const seenActiveNames = new Set();
  const seenActiveUsers = new Set();

  data.teams.forEach((team, index) => {
    validateTeam(team, index, seenTeamIds, seenActiveNames, seenActiveUsers, errors);
  });

  return errors;
}

module.exports = {
  validateTeams,
};
