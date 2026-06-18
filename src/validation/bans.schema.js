'use strict';

const { BAN_REASONS, BAN_STATUSES } = require('../app/constants');
const {
  requireArray,
  requireIsoDateOrNull,
  requireNonNegativeInteger,
  requireObject,
  requireOneOf,
  requireSnowflakeOrNull,
} = require('./common');

function validateBans(data) {
  const errors = [];
  if (!requireObject(errors, data, 'bans root')) return errors;
  if (data.version !== 1) errors.push('version must be 1');
  if (!requireArray(errors, data.bans, 'bans')) return errors;

  const activeTeamBans = new Set();
  const seenBanIds = new Set();

  data.bans.forEach((ban, index) => {
    const path = `bans[${index}]`;
    if (!requireObject(errors, ban, path)) return;

    if (!ban.id || typeof ban.id !== 'string') errors.push(`${path}.id is required`);
    if (seenBanIds.has(ban.id)) errors.push(`${path}.id must be unique`);
    seenBanIds.add(ban.id);

    requireOneOf(errors, ban.status, BAN_STATUSES, `${path}.status`);
    requireOneOf(errors, ban.reason, BAN_REASONS, `${path}.reason`);
    requireNonNegativeInteger(errors, ban.durationDays, `${path}.durationDays`);

    if (requireObject(errors, ban.team, `${path}.team`)) {
      if (!ban.team.teamId || typeof ban.team.teamId !== 'string') errors.push(`${path}.team.teamId is required`);
      if (!ban.team.clubNameSnapshot || typeof ban.team.clubNameSnapshot !== 'string') {
        errors.push(`${path}.team.clubNameSnapshot is required`);
      }

      if (ban.status === 'active') {
        if (activeTeamBans.has(ban.team.teamId)) errors.push(`${path}.team.teamId already has an active ban`);
        activeTeamBans.add(ban.team.teamId);
      }
    }

    if (requireArray(errors, ban.affectedUsers, `${path}.affectedUsers`)) {
      ban.affectedUsers.forEach((user, userIndex) => {
        const userPath = `${path}.affectedUsers[${userIndex}]`;
        if (!requireObject(errors, user, userPath)) return;
        requireSnowflakeOrNull(errors, user.userId, `${userPath}.userId`);
        if (!['manager', 'co_manager'].includes(user.role)) errors.push(`${userPath}.role must be manager or co_manager`);
      });
    }

    requireIsoDateOrNull(errors, ban.createdAt, `${path}.createdAt`);
    requireIsoDateOrNull(errors, ban.startsAt, `${path}.startsAt`);
    requireIsoDateOrNull(errors, ban.expiresAt, `${path}.expiresAt`);
    requireIsoDateOrNull(errors, ban.resolvedAt, `${path}.resolvedAt`);
    requireSnowflakeOrNull(errors, ban.resolvedByUserId, `${path}.resolvedByUserId`);

    if (ban.createdByUserId !== 'system') {
      requireSnowflakeOrNull(errors, ban.createdByUserId, `${path}.createdByUserId`);
    }

    if (ban.startsAt && ban.expiresAt && Date.parse(ban.expiresAt) <= Date.parse(ban.startsAt)) {
      errors.push(`${path}.expiresAt must be after startsAt`);
    }

    if (ban.status === 'revoked') {
      if (!ban.resolvedAt) errors.push(`${path}.resolvedAt is required for revoked bans`);
      if (!ban.resolvedByUserId) errors.push(`${path}.resolvedByUserId is required for revoked bans`);
      if (!ban.resolutionReason) errors.push(`${path}.resolutionReason is required for revoked bans`);
    }

    if (requireObject(errors, ban.effects, `${path}.effects`)) {
      if (ban.effects.blocksCheckin !== true) errors.push(`${path}.effects.blocksCheckin must be true`);
      if (ban.effects.blocksParticipation !== true) errors.push(`${path}.effects.blocksParticipation must be true`);
      if (ban.effects.removeExistingCheckins !== true) errors.push(`${path}.effects.removeExistingCheckins must be true`);
    }
  });

  return errors;
}

module.exports = {
  validateBans,
};
