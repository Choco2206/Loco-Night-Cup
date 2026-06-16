'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { findActiveBanForTeamOrManagers } = require('../checkins/checkin-ban-integration');

function uniqueEntryTeamIds(entries) {
  const seen = new Set();
  const ids = [];
  for (const entry of entries || []) {
    const teamId = String(entry?.teamId || '').trim();
    if (!teamId || seen.has(teamId)) continue;
    seen.add(teamId);
    ids.push(teamId);
  }
  return ids;
}

function getActiveManualByes(event) {
  return (event.byes || []).filter(bye => bye && bye.status !== 'removed');
}

function getAllowedSizes(settings, event) {
  const allowedSizes = Array.isArray(settings.tournament?.allowedSizes)
    ? settings.tournament.allowedSizes
    : event.format?.allowedSizes || [8, 16, 24, 32];
  return [...allowedSizes].filter(size => [8, 16, 24, 32].includes(size)).sort((a, b) => a - b);
}

function groupCountForSize(size) {
  return size / 4;
}

function isTeamEligibleForLock(team, now) {
  if (!team) return { ok: false, reason: 'not_found' };
  if (team.status !== 'active') return { ok: false, reason: 'not_active' };
  if (team.registrationStatus !== 'complete') return { ok: false, reason: 'incomplete' };
  if (findActiveBanForTeamOrManagers(team, team.manager?.userId, now)) return { ok: false, reason: 'banned' };
  return { ok: true, reason: null };
}

function collectValidRealTeams(event, now = new Date()) {
  const teamIds = uniqueEntryTeamIds(event.checkin?.entries || []);
  const teams = [];
  const skipped = [];

  for (const teamId of teamIds) {
    const team = findTeamById(teamId);
    const eligibility = isTeamEligibleForLock(team, now);
    if (eligibility.ok) {
      teams.push(team);
    } else {
      skipped.push({ teamId, reason: eligibility.reason });
    }
  }

  return { teams, skipped };
}

function choosePlayableFormat({ realTeamCount, byeCount, settings, event }) {
  const minimumRealTeams = Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
  if (realTeamCount < minimumRealTeams) return null;

  const allowedSizes = getAllowedSizes(settings, event).sort((a, b) => b - a);

  for (const size of allowedSizes) {
    const neededByes = Math.max(0, size - realTeamCount);
    const totalAvailableSlots = realTeamCount + byeCount;
    const maxByesForGroups = groupCountForSize(size);

    if (size > totalAvailableSlots) continue;
    if (neededByes > byeCount) continue;
    if (neededByes > maxByesForGroups) continue;
    return size;
  }

  return null;
}

function buildLockedParticipantField(event, now = new Date()) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const minimumRealTeams = Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
  const allowedSizes = getAllowedSizes(settings, event);
  const { teams, skipped } = collectValidRealTeams(event, now);
  const manualByes = getActiveManualByes(event);

  const size = choosePlayableFormat({
    realTeamCount: teams.length,
    byeCount: manualByes.length,
    settings,
    event,
  });

  if (!size) {
    throw new Error(`Format-Lock nicht moeglich: mindestens ${minimumRealTeams} gueltige echte Teams und ein spielbares Format aus 8, 16, 24 oder 32 Slots erforderlich.`);
  }

  const activeRealCount = Math.min(teams.length, size);
  const neededByeCount = size - activeRealCount;
  const activeTeams = teams.slice(0, activeRealCount);
  const waitlistTeams = teams.slice(activeRealCount);
  const activeByes = manualByes.slice(0, neededByeCount);
  const groupCount = groupCountForSize(size);

  if (activeByes.length > groupCount) {
    throw new Error('Format-Lock nicht moeglich: maximal ein Freilos pro Gruppe erlaubt.');
  }

  return {
    allowedSizes,
    minimumRealTeams,
    size,
    groupCount,
    activeTeams,
    waitlistTeams,
    activeByes,
    skipped,
    realTeamCount: activeTeams.length,
    checkedInRealTeamCount: teams.length,
    byeCount: activeByes.length,
  };
}

module.exports = {
  buildLockedParticipantField,
  choosePlayableFormat,
  collectValidRealTeams,
  getActiveManualByes,
  groupCountForSize,
};
