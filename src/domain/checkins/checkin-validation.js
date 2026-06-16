'use strict';

const { findNonDeletedTeamByUserId, isTeamMember } = require('../teams/team-service');
const { findActiveBanForTeamOrManagers } = require('./checkin-ban-integration');
const { canAcceptCheckinActions, canUseCheckinStatus } = require('./checkin-schedule');

function assertEventSupportsPhaseThree(event) {
  if (!canUseCheckinStatus(event.status)) {
    throw new Error('Dieses Event ist nicht im Check-in-Modus.');
  }
}

function assertCheckinActionAllowed(event) {
  assertEventSupportsPhaseThree(event);
  if (!canAcceptCheckinActions(event)) {
    throw new Error('Der Check-in ist aktuell geschlossen.');
  }
}

function getEligibleTeamForUser(userId) {
  const team = findNonDeletedTeamByUserId(userId);
  if (!team) throw new Error('Du bist aktuell in keinem registrierten Team als VM oder Co-VM eingetragen.');
  if (!isTeamMember(team, userId)) throw new Error('Du darfst dieses Team nicht einchecken.');
  if (team.status !== 'active') throw new Error('Nur aktive Teams duerfen einchecken.');
  if (team.registrationStatus !== 'complete') throw new Error('Dein Team ist noch unvollstaendig. Bitte lade zuerst ein Teamlogo hoch.');
  return team;
}

function assertTeamHasNoActiveBan({ team, actorUserId, now }) {
  const activeBan = findActiveBanForTeamOrManagers(team, actorUserId, now);
  if (!activeBan) return;

  if (activeBan.type === 'team') {
    throw new Error('Dieses Team ist aktuell gesperrt und darf nicht einchecken.');
  }

  if (activeBan.type === 'actor') {
    throw new Error('Du bist aktuell gesperrt und darfst kein Team einchecken.');
  }

  throw new Error('Ein aktueller VM oder Co-VM dieses Teams ist gesperrt. Das Team darf nicht einchecken.');
}

module.exports = {
  assertCheckinActionAllowed,
  assertEventSupportsPhaseThree,
  assertTeamHasNoActiveBan,
  getEligibleTeamForUser,
};
