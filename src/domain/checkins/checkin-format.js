'use strict';

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

function getEntryTeamIds(event) {
  return uniqueStrings((event.checkin?.entries || []).map(entry => entry.teamId));
}

function getManualByeCount(event) {
  return Array.isArray(event.byes) ? event.byes.length : 0;
}

function chooseFormatSize({ realTeamCount, byeCount, minimumRealTeams, allowedSizes }) {
  if (realTeamCount < minimumRealTeams) return null;

  const totalSlots = realTeamCount + byeCount;
  const sizes = [...allowedSizes].sort((a, b) => a - b);
  let selected = null;

  for (const size of sizes) {
    if (size <= totalSlots) selected = size;
  }

  return selected;
}

function recalculateFormatBeforeLock(event, settings) {
  const teamIds = getEntryTeamIds(event);
  const byeCount = getManualByeCount(event);
  const minimumRealTeams = Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
  const allowedSizes = Array.isArray(settings.tournament?.allowedSizes)
    ? settings.tournament.allowedSizes
    : event.format?.allowedSizes || [8, 16, 24, 32];

  const size = chooseFormatSize({
    realTeamCount: teamIds.length,
    byeCount,
    minimumRealTeams,
    allowedSizes,
  });

  const activeCapacity = size ? Math.max(0, size - byeCount) : teamIds.length;
  const activeTeamIds = teamIds.slice(0, activeCapacity);
  const waitlistTeamIds = teamIds.slice(activeCapacity);

  event.format = {
    ...event.format,
    minimumRealTeams,
    allowedSizes: [...allowedSizes],
    size,
    realTeamCount: teamIds.length,
    byeCount,
    waitlistCount: waitlistTeamIds.length,
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
    byeCount: getManualByeCount(event),
    waitlistCount: existingWaitlistIds.length,
  };
  return event;
}

function recalculateCheckinFormat(event, settings) {
  event.checkin = event.checkin || {};
  event.checkin.entries = Array.isArray(event.checkin.entries) ? event.checkin.entries : [];
  event.checkin.activeTeamIds = Array.isArray(event.checkin.activeTeamIds) ? event.checkin.activeTeamIds : [];
  event.checkin.waitlistTeamIds = Array.isArray(event.checkin.waitlistTeamIds) ? event.checkin.waitlistTeamIds : [];

  if (event.format?.lockedAt) return preserveLockedFormat(event);
  return recalculateFormatBeforeLock(event, settings);
}

module.exports = {
  getEntryTeamIds,
  getManualByeCount,
  recalculateCheckinFormat,
};
