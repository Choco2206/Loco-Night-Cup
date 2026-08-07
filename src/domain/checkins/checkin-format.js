'use strict';

const { findTeamById } = require('../teams/team-service');
const { findActiveBanForTeamOrManagers } = require('./checkin-ban-integration');
const { TOURNAMENT_FORMAT_SIZES } = require('../../app/constants');

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function isValidTournamentTeam(team, now = new Date()) {
  if (team?.status !== 'active') return false;
  if (team.registrationStatus !== 'complete') return false;
  return !findActiveBanForTeamOrManagers(team, team.manager?.userId, now);
}

function isValidTournamentTeamId(teamId, now = new Date()) {
  return isValidTournamentTeam(findTeamById(teamId), now);
}

function pruneInvalidCheckinEntries(event, now = new Date()) {
  event.checkin.entries = (event.checkin?.entries || []).filter(entry => isValidTournamentTeamId(entry.teamId, now));
  event.checkin.activeTeamIds = uniqueStrings(event.checkin?.activeTeamIds || []).filter(teamId => isValidTournamentTeamId(teamId, now));
  event.checkin.waitlistTeamIds = uniqueStrings(event.checkin?.waitlistTeamIds || []).filter(teamId => isValidTournamentTeamId(teamId, now));
  return event;
}

function getEntryTeamIds(event, now = new Date()) {
  return uniqueStrings((event.checkin?.entries || [])
    .map(entry => entry.teamId)
    .filter(teamId => isValidTournamentTeamId(teamId, now)));
}

function getManualByes(event) {
  if (!Array.isArray(event.byes)) return [];
  return event.byes.filter(bye => bye?.type === 'bye' && bye?.status === 'active');
}

function getManualByeCount(event) {
  return getManualByes(event).length;
}

function getAllowedSizes(settings, event) {
  const allowedSizes = Array.isArray(settings.tournament?.allowedSizes)
    ? settings.tournament.allowedSizes
    : event.format?.allowedSizes || TOURNAMENT_FORMAT_SIZES;
  return [...allowedSizes].filter(size => TOURNAMENT_FORMAT_SIZES.includes(Number(size))).map(Number).sort((a, b) => a - b);
}

function chooseFormatSize({ participantSlotCount, minimumParticipantSlots, allowedSizes }) {
  if (participantSlotCount < minimumParticipantSlots) return null;

  let selected = null;
  for (const size of [...allowedSizes].sort((a, b) => a - b)) {
    if (size <= participantSlotCount) selected = size;
  }

  return selected;
}

function recalculateFormatBeforeLock(event, settings) {
  const teamIds = getEntryTeamIds(event);
  const byeCount = getManualByeCount(event);
  const minimumParticipantSlots = Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
  const allowedSizes = getAllowedSizes(settings, event);
  const participantSlotCount = teamIds.length + byeCount;

  const size = chooseFormatSize({
    participantSlotCount,
    minimumParticipantSlots,
    allowedSizes,
  });

  const activeRealCount = size ? Math.min(teamIds.length, size) : teamIds.length;
  const activeTeamIds = teamIds.slice(0, activeRealCount);
  const waitlistTeamIds = teamIds.slice(activeRealCount);
  const activeByeCount = size ? Math.min(byeCount, Math.max(0, size - activeRealCount)) : 0;
  const waitlistByeCount = Math.max(0, byeCount - activeByeCount);

  event.format = {
    ...event.format,
    minimumRealTeams: minimumParticipantSlots,
    allowedSizes: [...allowedSizes],
    size,
    realTeamCount: teamIds.length,
    byeCount,
    activeByeCount,
    waitlistByeCount,
    waitlistCount: waitlistTeamIds.length + waitlistByeCount,
  };

  event.checkin.activeTeamIds = activeTeamIds;
  event.checkin.waitlistTeamIds = waitlistTeamIds;
  return event;
}

function preserveLockedFormat(event) {
  const entryIds = new Set(getEntryTeamIds(event));
  const activeTeamIds = uniqueStrings(event.checkin?.activeTeamIds || []).filter(teamId => entryIds.has(teamId));
  const existingWaitlistIds = uniqueStrings(event.checkin?.waitlistTeamIds || []).filter(teamId => entryIds.has(teamId));
  const waitlistSet = new Set(existingWaitlistIds);
  const byeCount = getManualByeCount(event);
  const lockedSize = Number(event.format?.size || 0);
  const availableActiveSlots = Math.max(0, lockedSize - activeTeamIds.length);
  const storedActiveByeCount = Number(event.format?.activeByeCount);
  const activeByeCount = Math.min(
    byeCount,
    availableActiveSlots,
    Number.isFinite(storedActiveByeCount) ? Math.max(0, storedActiveByeCount) : availableActiveSlots,
  );
  const waitlistByeCount = Math.max(0, byeCount - activeByeCount);

  for (const teamId of entryIds) {
    if (activeTeamIds.includes(teamId) || waitlistSet.has(teamId)) continue;
    existingWaitlistIds.push(teamId);
    waitlistSet.add(teamId);
  }

  event.checkin.activeTeamIds = activeTeamIds;
  event.checkin.waitlistTeamIds = existingWaitlistIds;
  event.format = {
    ...event.format,
    realTeamCount: entryIds.size,
    byeCount,
    activeByeCount,
    waitlistByeCount,
    waitlistCount: existingWaitlistIds.length + waitlistByeCount,
  };
  return event;
}

function recalculateCheckinFormat(event, settings, now = new Date()) {
  event.checkin = event.checkin || {};
  event.checkin.entries = Array.isArray(event.checkin.entries) ? event.checkin.entries : [];
  event.checkin.activeTeamIds = Array.isArray(event.checkin.activeTeamIds) ? event.checkin.activeTeamIds : [];
  event.checkin.waitlistTeamIds = Array.isArray(event.checkin.waitlistTeamIds) ? event.checkin.waitlistTeamIds : [];
  event.byes = Array.isArray(event.byes) ? event.byes : [];

  pruneInvalidCheckinEntries(event, now);

  if (event.format?.lockedAt) return preserveLockedFormat(event);
  return recalculateFormatBeforeLock(event, settings);
}

module.exports = {
  chooseFormatSize,
  getAllowedSizes,
  getEntryTeamIds,
  getManualByeCount,
  getManualByes,
  isValidTournamentTeam,
  isValidTournamentTeamId,
  recalculateCheckinFormat,
};
