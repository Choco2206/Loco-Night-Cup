'use strict';

const { isTeamMember, listVisibleTeams } = require('../teams/team-service');
const { findActiveBanForTeamOrManagers } = require('./checkin-ban-integration');
const { canAcceptCheckinActions, canUseCheckinStatus } = require('./checkin-schedule');

const BAN_REASON_LABELS = {
  late_withdrawal: 'Abmeldung nach Deadline',
  no_show: 'No-Show',
  tournament_left: 'Turnier verlassen',
  disrespect: 'Beleidigung/Respektlosigkeit',
  insult: 'Beleidigung/Respektlosigkeit',
  admin: 'Sonstige Admin-Sperre',
  admin_other: 'Sonstige Admin-Sperre',
};

function assertEventSupportsPhaseThree(event) {
  if (!canUseCheckinStatus(event.status)) {
    throw new Error('Dieses Event ist nicht im Check-in-Modus.');
  }
}

function assertCheckinActionAllowed({ eventKey, event, settings, now = new Date() }) {
  assertEventSupportsPhaseThree(event);
  if (!canAcceptCheckinActions(eventKey, event, settings, now)) {
    throw new Error('Der Check-in ist aktuell geschlossen.');
  }
}

function getEligibleTeamForUser(userId) {
  const teams = listVisibleTeams();
  const memberships = teams.filter(team => isTeamMember(team, userId));

  if (!memberships.length) {
    throw new Error('Du hast kein vollstaendiges Team. Nur VM oder Co-VM koennen einchecken.');
  }

  const activeTeam = memberships.find(team => team.status === 'active') || memberships[0];
  if (!isTeamMember(activeTeam, userId)) throw new Error('Nur VM oder Co-VM koennen einchecken.');
  if (activeTeam.status !== 'active') throw new Error('Nur aktive Teams duerfen einchecken.');
  if (activeTeam.registrationStatus !== 'complete') {
    throw new Error('Dieses Team ist noch unvollstaendig. Bitte lade zuerst ein Logo hoch.');
  }

  return activeTeam;
}

function formatBanReason(reason) {
  const key = String(reason || '').trim();
  if (!key) return 'Nicht angegeben';
  if (BAN_REASON_LABELS[key]) return BAN_REASON_LABELS[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatBanExpiration(expiresAt) {
  if (!expiresAt) return 'unbegrenzt';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'unbekannt';
  return date.toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildBanCheckinMessage(team, activeBan) {
  const ban = activeBan?.ban || activeBan;
  return [
    '🚫 Dein Team ist aktuell für den Loco Night Cup gesperrt.',
    '',
    `Team: ${team?.clubName || 'Unbekanntes Team'}`,
    `Grund: ${formatBanReason(ban?.reason)}`,
    `Sperre bis: ${formatBanExpiration(ban?.expiresAt)}`,
    '',
    'Während dieser Sperre können VM und Co-VMs nicht am Check-in teilnehmen.',
  ].join('\n');
}

function assertTeamHasNoActiveBan({ team, actorUserId, now }) {
  const activeBan = findActiveBanForTeamOrManagers(team, actorUserId, now);
  if (!activeBan) return;

  throw new Error(buildBanCheckinMessage(team, activeBan));
}

module.exports = {
  assertCheckinActionAllowed,
  assertEventSupportsPhaseThree,
  assertTeamHasNoActiveBan,
  getEligibleTeamForUser,
};
