'use strict';

const { readEventData, updateEventData } = require('./checkin-repository');
const { findTeamById, listVisibleTeams } = require('../teams/team-service');
const { isValidTournamentTeam } = require('./checkin-format');
const { recalculateGroupStandings } = require('../groups/group-results');
const { HALLOWEEN_EVENT_KEY, HALLOWEEN_EVENT_DATE, buildBomberXLocoSchedule } = require('../events/bomber-x-loco-config');

function assertEditable(event, now = new Date()) {
  if (event.eventKey !== HALLOWEEN_EVENT_KEY || event.cycle?.eventDate !== HALLOWEEN_EVENT_DATE) throw new Error('Diese Aktion gilt nur für den Bomber X Loco Halloween Cup.');
  if (!event.format?.lockedAt || !event.format?.size) throw new Error('Das Teilnehmerfeld ist noch nicht gelockt.');
  if (!['checkin', 'checkin_closed', 'draw_ready', 'groups', 'groups_running'].includes(event.status)) throw new Error('Das Teilnehmerfeld kann in dieser Turnierphase nicht ersetzt werden.');
  if (now >= buildBomberXLocoSchedule(HALLOWEEN_EVENT_DATE, HALLOWEEN_EVENT_KEY).tournamentStartAt) throw new Error('Das Turnier hat bereits begonnen. Bitte den bestehenden Nachrücker-Dialog in der Gruppe verwenden.');
  const groups = Object.values(event.groups?.groups || {});
  if (groups.some(group => (group.matchdays || []).some(day => (day.matches || []).some(match => match.result || match.reports?.length || match.adminDecision || match.confirmedBy?.length)))) {
    throw new Error('Es liegen bereits Spielergebnisse oder Meldungen vor. Bitte den Nachrücker-Dialog in der Gruppe verwenden.');
  }
}

function replacementCandidates(event, all = false, now = new Date()) {
  assertEditable(event, now);
  const active = new Set((event.checkin?.activeTeamIds || []).map(String));
  const ids = all ? listVisibleTeams().map(team => String(team.id)) : (event.checkin?.waitlistTeamIds || []).map(String);
  return [...new Set(ids)].filter(id => !active.has(id)).map(findTeamById).filter(team => isValidTournamentTeam(team, now));
}

// Single event update: no withdrawal service, no ban creation, no format recalculation.
function applyReplacement(event, { oldTeamId, newTeam, actorUserId, now = new Date() }) {
  assertEditable(event, now);
  const oldId = String(oldTeamId), newId = String(newTeam.id);
  const active = (event.checkin?.activeTeamIds || []).map(String);
  if (!active.includes(oldId)) throw new Error('Das ausscheidende Team ist nicht mehr im Teilnehmerfeld. Bitte neu öffnen.');
  if (oldId === newId || active.includes(newId)) throw new Error('Das Ersatzteam nimmt bereits teil.');
  const participants = event.format.participants;
  const index = (participants || []).findIndex(p => p.type === 'team' && String(p.teamId || p.id) === oldId);
  if (index < 0) throw new Error('Der gelockte Teilnehmerplatz wurde nicht gefunden.');
  if (!(event.checkin.entries || []).some(entry => String(entry.teamId) === oldId)) throw new Error('Der Anmeldeeintrag des ausscheidenden Teams fehlt.');
  const timestamp = now.toISOString();
  const oldParticipant = participants[index];
  const participant = { ...oldParticipant, type: 'team', teamId: newId, displayName: newTeam.clubName, isTestTeam: newTeam.isTestTeam === true };
  if ('id' in participant) participant.id = newId;
  if ('clubName' in participant) participant.clubName = newTeam.clubName;
  if ('participantKey' in participant) participant.participantKey = `team:${newId}`;
  participants[index] = participant;
  event.checkin.activeTeamIds = active.map(id => id === oldId ? newId : id);
  event.checkin.waitlistTeamIds = (event.checkin.waitlistTeamIds || []).filter(id => ![oldId, newId].includes(String(id)));
  const existing = (event.checkin.entries || []).find(entry => String(entry.teamId) === newId);
  event.checkin.entries = (event.checkin.entries || []).filter(entry => String(entry.teamId) !== newId).map(entry => String(entry.teamId) === oldId
    ? existing || { teamId: newId, checkedInByUserId: String(actorUserId), checkedInAt: timestamp, checkedInByAdmin: true }
    : entry);
  const affectedGroups = [];
  for (const group of Object.values(event.groups?.groups || {})) {
    const slots = (group.slots || []).filter(slot => slot.type === 'team' && String(slot.teamId) === oldId);
    if (!slots.length) continue;
    for (const slot of slots) {
      Object.assign(slot, { teamId: newId, displayName: newTeam.clubName, isTestTeam: newTeam.isTestTeam === true });
      if ('participantKey' in slot) slot.participantKey = `team:${newId}`;
    }
    for (const day of group.matchdays || []) for (const match of day.matches || []) {
      for (const side of ['home', 'away']) if (String(match[side]?.teamId) === oldId) {
        match[side] = { ...match[side], teamId: newId, displayName: newTeam.clubName, isTestTeam: newTeam.isTestTeam === true };
        if ('participantKey' in match[side]) match[side].participantKey = `team:${newId}`;
      }
    }
    recalculateGroupStandings(group);
    if (group.attendance) group.attendance.presentTeamIds = (group.attendance.presentTeamIds || []).filter(id => String(id) !== oldId);
    group.meta = { ...group.meta, updatedAt: timestamp };
    affectedGroups.push(group);
  }
  event.format.realTeamCount = event.checkin.entries.length;
  event.format.waitlistCount = event.checkin.waitlistTeamIds.length + Number(event.format.waitlistByeCount || 0);
  event.meta = { ...event.meta, updatedAt: timestamp };
  event.meta.halloweenReplacements = [...(event.meta.halloweenReplacements || []), { oldTeamId: oldId, newTeamId: newId, actorUserId: String(actorUserId), at: timestamp, banCreated: false }];
  return { event, affectedGroups, oldParticipant, newTeam };
}

function replaceHalloweenParticipant({ oldTeamId, newTeamId, actorUserId, now = new Date() }) {
  const newTeam = findTeamById(newTeamId);
  if (!isValidTournamentTeam(newTeam, now)) throw new Error('Das Ersatzteam ist nicht vollständig registriert, nicht aktiv oder gesperrt.');
  let result;
  updateEventData(HALLOWEEN_EVENT_KEY, event => {
    result = applyReplacement(event, { oldTeamId, newTeam, actorUserId, now });
    return event;
  });
  return result;
}

module.exports = { assertEditable, applyReplacement, replacementCandidates, replaceHalloweenParticipant, readHalloweenEvent: () => readEventData(HALLOWEEN_EVENT_KEY) };
