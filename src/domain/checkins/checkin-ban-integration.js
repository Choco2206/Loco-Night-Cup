'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createBansDefault } = require('../../storage/defaults');
const { addTeamBan, findActiveBanForTeamOrManagers } = require('../bans/ban-service');

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function createBanId() {
  return `ban_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readBansData() {
  return readJson(FILES.bans, createBansDefault());
}

function isBanActive(ban, now = new Date()) {
  if (!ban || ban.status !== 'active') return false;
  const startsAt = ban.startsAt ? new Date(ban.startsAt) : null;
  const expiresAt = ban.expiresAt ? new Date(ban.expiresAt) : null;
  if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > now.getTime()) return false;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

function getBanTargetTeamId(ban) {
  return ban.targets?.teamId || ban.target?.teamId || ban.teamId || null;
}

function getBanTargetUserIds(ban) {
  const ids = [];
  if (Array.isArray(ban.targets?.userIds)) ids.push(...ban.targets.userIds);
  if (ban.targets?.managerUserId) ids.push(ban.targets.managerUserId);
  if (Array.isArray(ban.targets?.coManagerUserIds)) ids.push(...ban.targets.coManagerUserIds);
  if (Array.isArray(ban.target?.userIds)) ids.push(...ban.target.userIds);
  if (ban.target?.userId) ids.push(ban.target.userId);
  if (ban.userId) ids.push(ban.userId);
  return [...new Set(ids.map(String))];
}

function findActiveTeamBan(teamId, now = new Date()) {
  if (!teamId) return null;
  return readBansData().bans.find(ban => {
    return isBanActive(ban, now) && String(getBanTargetTeamId(ban)) === String(teamId);
  }) || null;
}

function findActiveUserBan(userId, now = new Date()) {
  if (!userId) return null;
  const id = String(userId);
  return readBansData().bans.find(ban => {
    return isBanActive(ban, now) && getBanTargetUserIds(ban).includes(id);
  }) || null;
}

function getCurrentTeamUserIds(team) {
  const ids = [];
  if (team?.manager?.userId) ids.push(String(team.manager.userId));
  for (const coManager of team?.coManagers || []) {
    if (coManager?.userId) ids.push(String(coManager.userId));
  }
  return [...new Set(ids)];
}

function findActiveBanForTeamOrManagersLegacy(team, actorUserId, now = new Date()) {
  const teamBan = findActiveTeamBan(team?.id, now);
  if (teamBan) return { type: 'team', ban: teamBan };

  const actorBan = findActiveUserBan(actorUserId, now);
  if (actorBan) return { type: 'actor', ban: actorBan };

  for (const userId of getCurrentTeamUserIds(team)) {
    const userBan = findActiveUserBan(userId, now);
    if (userBan) return { type: 'team_member', userId, ban: userBan };
  }

  return null;
}

function createLateWithdrawalBan({ team, eventKey, actorUserId, settings, now = new Date() }) {
  const durationDays = Number(settings.bans?.durationsDays?.late_withdrawal || 7);
  const ban = addTeamBan(team, 'late_withdrawal', actorUserId, durationDays);

  updateJson(FILES.bans, createBansDefault(), data => {
    const target = (data.bans || []).find(entry => String(entry.id) === String(ban.id));
    if (target) {
      target.source = {
        type: 'deadline_withdrawal',
        eventKey,
      };
    }
    return data;
  });

  return ban;
}

module.exports = {
  createLateWithdrawalBan,
  findActiveBanForTeamOrManagers,
  findActiveBanForTeamOrManagersLegacy,
  findActiveTeamBan,
  findActiveUserBan,
  getCurrentTeamUserIds,
  isBanActive,
};
