'use strict';

const { isTeamMember, listVisibleTeams } = require('../teams/team-service');
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
  const teams = listVisibleTeams();
  const memberships = teams.filter(team => isTeamMember(team, userId));

  if (!memberships.length) {
    throw new Error('Du hast kein vollständiges Team. Nur VM oder Co-VM können einchecken.');
  }

  const activeTeam = memberships.find(team => team.status === 'active') || memberships[0];
  if (!isTeamMember(activeTeam, userId)) throw new Error('Nur VM oder Co-VM können einchecken.');
  if (activeTeam.status !== 'active') throw new Error('Nur aktive Teams dürfen einchecken.');
  if (activeTeam.registrationStatus !== 'complete') {
    throw new Error('Dieses Team ist noch unvollständig. Bitte lade zuerst ein Logo hoch.');
  }

  return activeTeam;
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
