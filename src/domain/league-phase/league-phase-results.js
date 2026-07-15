'use strict';

const { updateEventData } = require('../events/event-repository');
const groupResults = require('../groups/group-results');

function leagueGroup(event) {
  return event.leaguePhase?.phaseType === 'league' ? event.leaguePhase : null;
}

function getLeagueMatches(phase) { return (phase?.matchdays || []).flatMap(day => day.matches || []); }
function isLeagueComplete(phase) { return getLeagueMatches(phase).every(match => match.status === 'confirmed'); }

function qualifyLeagueTopEight(event) {
  return (event.leaguePhase?.standings || [])
    .filter(row => row.teamId)
    .slice(0, 8)
    .map((row, index) => ({ ...row, seed: index + 1, groupKey: 'league', groupRank: index + 1 }));
}

function replaceLeagueParticipant({ eventKey, participantKeyValue, replacementParticipant }) {
  let outcome;
  updateEventData(eventKey, event => {
    const phase = leagueGroup(event);
    if (!phase) throw new Error('Ligaphase wurde nicht gefunden.');
    const slot = phase.slots.find(item => item.participantKey === participantKeyValue);
    if (!slot) throw new Error('Ligaphasen-Startplatz wurde nicht gefunden.');
    const next = { ...replacementParticipant, slot: slot.slot, participantKey: `team:${replacementParticipant.teamId}` };
    Object.assign(slot, next);
    phase.participants = phase.slots;
    for (const match of getLeagueMatches(phase)) {
      if (match.status === 'confirmed') continue;
      if (match.home?.participantKey === participantKeyValue) match.home = { ...next };
      if (match.away?.participantKey === participantKeyValue) match.away = { ...next };
    }
    groupResults.recalculateGroupStandings(phase);
    outcome = { event, phase, replacementParticipant: next };
    return event;
  });
  return outcome;
}

module.exports = { getLeagueMatches, isLeagueComplete, leagueGroup, qualifyLeagueTopEight, replaceLeagueParticipant };
