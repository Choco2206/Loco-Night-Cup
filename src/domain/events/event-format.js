'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { TOURNAMENT_FORMAT_SIZES, isLeaguePhaseFormat } = require('../../app/constants');
const { findTeamById } = require('../teams/team-service');
const { findActiveBanForTeamOrManagers } = require('../checkins/checkin-ban-integration');
const {
  BOMBER_X_LOCO_FORMAT_SIZES,
  BOMBER_X_LOCO_GROUP_SIZE,
  isBomberXLocoEvent,
} = require('./bomber-x-loco-config');

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
  return (event.byes || []).filter(bye => bye?.type === 'bye' && bye.status === 'active');
}

function getAllowedSizes(settings, event) {
  if (isBomberXLocoEvent(event)) return [...BOMBER_X_LOCO_FORMAT_SIZES];
  const allowedSizes = Array.isArray(settings.tournament?.allowedSizes)
    ? settings.tournament.allowedSizes
    : event.format?.allowedSizes || TOURNAMENT_FORMAT_SIZES;
  return [...allowedSizes].filter(size => TOURNAMENT_FORMAT_SIZES.includes(Number(size))).map(Number).sort((a, b) => a - b);
}

function groupCountForSize(size, event = null) {
  if (isBomberXLocoEvent(event)) return Number(size) / BOMBER_X_LOCO_GROUP_SIZE;
  return isLeaguePhaseFormat(size) ? 0 : Number(size) / 4;
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
    if (eligibility.ok) teams.push(team);
    else skipped.push({ teamId, reason: eligibility.reason });
  }
  return { teams, skipped };
}

function minimumParticipantSlots(settings, event) {
  return isBomberXLocoEvent(event)
    ? 6
    : Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
}

function choosePlayableFormat({ realTeamCount, byeCount, settings, event }) {
  const minimum = minimumParticipantSlots(settings, event);
  const participantSlotCount = realTeamCount + byeCount;
  if (participantSlotCount < minimum) return null;
  const allowedSizes = getAllowedSizes(settings, event).sort((a, b) => b - a);
  for (const size of allowedSizes) {
    if (size <= participantSlotCount) return size;
  }
  return null;
}

function buildLockedParticipantField(event, now = new Date()) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const minimum = minimumParticipantSlots(settings, event);
  const allowedSizes = getAllowedSizes(settings, event);
  const { teams, skipped } = collectValidRealTeams(event, now);
  const manualByes = getActiveManualByes(event);
  const size = choosePlayableFormat({ realTeamCount: teams.length, byeCount: manualByes.length, settings, event });

  if (!size) {
    throw new Error(`Format-Lock nicht möglich: mindestens ${minimum} gültige Teams und ein spielbares Format aus ${allowedSizes.join(', ')} Slots erforderlich.`);
  }

  const activeRealCount = Math.min(teams.length, size);
  const activeManualByeCount = Math.min(manualByes.length, Math.max(0, size - activeRealCount));
  const activeTeams = teams.slice(0, activeRealCount);
  const waitlistTeams = teams.slice(activeRealCount);
  const activeByes = manualByes.slice(0, activeManualByeCount);
  const waitlistByes = manualByes.slice(activeManualByeCount);
  const groupCount = groupCountForSize(size, event);

  const participants = [
    ...activeTeams.map(team => ({ type: 'team', teamId: String(team.id), displayName: team.clubName, isTestTeam: team.isTestTeam === true })),
    ...activeByes.map(bye => ({ type: 'bye', byeId: String(bye.id), displayName: bye.displayName || bye.label || 'Freilos' })),
  ];

  if (participants.length !== size) {
    throw new Error('Format-Lock nicht möglich: Teilnehmerliste enthält nicht genug Teams oder manuell gesetzte Freilose.');
  }

  return {
    allowedSizes,
    minimumRealTeams: minimum,
    size,
    groupCount,
    participants,
    activeTeams,
    waitlistTeams,
    activeByes,
    waitlistByes,
    skipped,
    realTeamCount: activeTeams.length,
    checkedInRealTeamCount: teams.length,
    byeCount: activeByes.length,
    activeByeCount: activeByes.length,
    waitlistByeCount: waitlistByes.length,
  };
}

module.exports = {
  buildLockedParticipantField,
  choosePlayableFormat,
  collectValidRealTeams,
  getActiveManualByes,
  groupCountForSize,
};
