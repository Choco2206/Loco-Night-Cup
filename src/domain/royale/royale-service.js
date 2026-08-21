'use strict';

const { getEligibleTeamForUser } = require('../checkins/checkin-validation');
const { isValidTournamentTeam } = require('../checkins/checkin-format');
const { findTeamById } = require('../teams/team-service');
const { buildRoyaleBracket } = require('./royale-bracket');
const { calculateRoyaleCheckin } = require('./royale-format');
const { getNextRoyaleSchedule } = require('./royale-schedule');
const { readRoyale, updateRoyale } = require('./royale-repository');

function nowIso(now = new Date()) { return now.toISOString(); }

function resetForSchedule(event, schedule, now = new Date()) {
  event.status = now.getTime() >= new Date(schedule.checkinOpenAt).getTime() ? 'checkin_open' : 'scheduled';
  event.cycle = { cycleKey: schedule.cycleKey, eventDate: schedule.eventDate, timezone: schedule.timezone };
  event.schedule = schedule;
  event.format = { allowedSizes: [8, 16, 32], size: null, lockedAt: null, participants: [] };
  event.checkin = { isOpen: event.status === 'checkin_open', openedAt: event.status === 'checkin_open' ? nowIso(now) : null, closedAt: null, entries: [], activeTeamIds: [], waitlistTeamIds: [] };
  event.bracket = null;
  event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
  return event;
}

function ensureRoyaleCycle(now = new Date()) {
  const schedule = getNextRoyaleSchedule(now);
  return updateRoyale(event => {
    if (event.cycle?.cycleKey !== schedule.cycleKey) return resetForSchedule(event, schedule, now);
    event.schedule = schedule;
    if (event.status === 'scheduled' && now.getTime() >= new Date(schedule.checkinOpenAt).getTime()) {
      event.status = 'checkin_open'; event.checkin.isOpen = true; event.checkin.openedAt = nowIso(now);
    }
    if (event.checkin?.isOpen && now.getTime() > new Date(schedule.lateWindowUntil).getTime()) {
      event.checkin.isOpen = false; event.checkin.closedAt = event.checkin.closedAt || nowIso(now);
      if (event.status === 'checkin_open') event.status = 'checkin_closed';
    }
    return event;
  });
}

function recalculate(event) {
  const result = calculateRoyaleCheckin(event.checkin?.entries || []);
  event.format.size = result.size;
  event.checkin.activeTeamIds = result.activeEntries.map(entry => String(entry.teamId));
  event.checkin.waitlistTeamIds = result.waitlistEntries.map(entry => String(entry.teamId));
  return result;
}

function assertCheckinOpen(event, now) {
  if (!event.checkin?.isOpen || !['checkin_open', 'scheduled'].includes(event.status)) throw new Error('Der Knockout-Royale-Check-in ist geschlossen.');
  if (now.getTime() > new Date(event.schedule.lateWindowUntil).getTime()) throw new Error('Der Knockout-Royale-Check-in ist geschlossen.');
}

function checkInRoyaleTeam({ userId, now = new Date() }) {
  ensureRoyaleCycle(now);
  const team = getEligibleTeamForUser(userId);
  if (!isValidTournamentTeam(team, now)) throw new Error('Team ist nicht aktiv, vollständig registriert oder aktuell gesperrt.');
  let result;
  updateRoyale(event => {
    assertCheckinOpen(event, now);
    const exists = event.checkin.entries.some(entry => String(entry.teamId) === String(team.id));
    if (!exists) event.checkin.entries.push({ teamId: String(team.id), checkedInByUserId: String(userId), checkedInAt: nowIso(now) });
    const format = recalculate(event); event.meta.updatedAt = nowIso(now);
    result = { event, team, changed: !exists, format };
    return event;
  });
  return result;
}

function withdrawRoyaleTeam({ userId, now = new Date() }) {
  ensureRoyaleCycle(now);
  const team = getEligibleTeamForUser(userId);
  let result;
  updateRoyale(event => {
    assertCheckinOpen(event, now);
    const before = event.checkin.entries.length;
    event.checkin.entries = event.checkin.entries.filter(entry => String(entry.teamId) !== String(team.id));
    const format = recalculate(event); event.meta.updatedAt = nowIso(now);
    result = { event, team, changed: before !== event.checkin.entries.length, format };
    return event;
  });
  return result;
}

function lockRoyaleAndCreateBracket({ actorUserId = null, now = new Date() } = {}) {
  ensureRoyaleCycle(now);
  let result;
  updateRoyale(event => {
    const format = recalculate(event);
    if (!format.size) throw new Error('Mindestens 8 gültige Teams werden für die Knockout Royale benötigt.');
    const teams = format.activeEntries.map(entry => {
      const team = findTeamById(entry.teamId);
      if (!team) throw new Error(`Royal-Team wurde nicht gefunden: ${entry.teamId}`);
      return { teamId: String(team.id), displayName: team.clubName };
    });
    event.checkin.isOpen = false; event.checkin.closedAt = nowIso(now);
    event.format = { ...event.format, size: format.size, lockedAt: nowIso(now), lockedByUserId: actorUserId ? String(actorUserId) : null, participants: teams };
    event.bracket = buildRoyaleBracket({ teams, createdAt: nowIso(now) });
    event.status = 'bracket_created'; event.meta.updatedAt = nowIso(now);
    result = { event, bracket: event.bracket };
    return event;
  });
  return result;
}

function getRoyaleState(now = new Date()) {
  ensureRoyaleCycle(now);
  return readRoyale();
}

module.exports = { checkInRoyaleTeam, ensureRoyaleCycle, getRoyaleState, lockRoyaleAndCreateBracket, withdrawRoyaleTeam };
