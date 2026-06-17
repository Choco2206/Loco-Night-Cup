'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, updateJson } = require('../../storage');
const { createEventDefault, createTeamsDefault } = require('../../storage/defaults');

function nowIso() {
  return new Date().toISOString();
}

function isManagerObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeUserId(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return /^\d{17,20}$/.test(text) ? text : null;
}

function normalizeTeamId(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function normalizeIsoDate(value) {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function createManager(userId, addedAt = null) {
  return {
    userId: String(userId),
    addedAt: normalizeIsoDate(addedAt) || nowIso(),
  };
}

function normalizeCoManagers(team) {
  const source = Array.isArray(team.coManagers)
    ? team.coManagers
    : Array.isArray(team.coManagerIds)
      ? team.coManagerIds
      : [];
  const seen = new Set();
  const coManagers = [];

  for (const entry of source) {
    const userId = isManagerObject(entry) ? normalizeUserId(entry.userId) : normalizeUserId(entry);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    coManagers.push({
      userId,
      addedAt: isManagerObject(entry) ? normalizeIsoDate(entry.addedAt) : null,
      addedByUserId: isManagerObject(entry) ? normalizeUserId(entry.addedByUserId) : null,
    });
  }

  return coManagers;
}

function getManagerUserId(team) {
  if (isManagerObject(team.manager)) return normalizeUserId(team.manager.userId);
  return normalizeUserId(team.manager) || normalizeUserId(team.managerId);
}

function repairTeam(team) {
  if (!team || typeof team !== 'object' || Array.isArray(team)) return { remove: true, repaired: false, team: null };

  const before = JSON.stringify(team);
  const coManagers = normalizeCoManagers(team);
  const managerUserId = getManagerUserId(team);

  if (team.status === 'deleted') {
    return { remove: true, repaired: before !== JSON.stringify(team), team };
  }

  team.coManagers = coManagers;

  if (managerUserId) {
    team.manager = createManager(managerUserId, isManagerObject(team.manager) ? team.manager.addedAt : team.meta?.createdAt);
    team.coManagers = team.coManagers.filter(co => String(co.userId) !== String(managerUserId));
  } else if (team.coManagers.length) {
    const promoted = team.coManagers.shift();
    team.manager = createManager(promoted.userId, promoted.addedAt || team.meta?.createdAt);
    team.status = team.status === 'leaderless' ? 'active' : team.status;
  } else {
    return { remove: true, repaired: true, team };
  }

  if (!Array.isArray(team.coManagers)) team.coManagers = [];
  if (team.logo === undefined) team.logo = null;
  if (team.logoUpload === undefined) team.logoUpload = null;
  team.meta = team.meta && typeof team.meta === 'object' && !Array.isArray(team.meta) ? team.meta : {};
  team.meta.updatedAt = nowIso();

  return { remove: false, repaired: before !== JSON.stringify(team), team };
}

function removeTeamFromEvent(event, removedTeamIds) {
  event.checkin = event.checkin || {};
  const beforeEntries = Array.isArray(event.checkin.entries) ? event.checkin.entries.length : 0;
  const beforeActive = Array.isArray(event.checkin.activeTeamIds) ? event.checkin.activeTeamIds.length : 0;
  const beforeWaitlist = Array.isArray(event.checkin.waitlistTeamIds) ? event.checkin.waitlistTeamIds.length : 0;

  event.checkin.entries = Array.isArray(event.checkin.entries)
    ? event.checkin.entries.filter(entry => !removedTeamIds.has(String(entry.teamId)))
    : [];
  event.checkin.activeTeamIds = Array.isArray(event.checkin.activeTeamIds)
    ? event.checkin.activeTeamIds.filter(teamId => !removedTeamIds.has(String(teamId)))
    : [];
  event.checkin.waitlistTeamIds = Array.isArray(event.checkin.waitlistTeamIds)
    ? event.checkin.waitlistTeamIds.filter(teamId => !removedTeamIds.has(String(teamId)))
    : [];

  const changed = beforeEntries !== event.checkin.entries.length
    || beforeActive !== event.checkin.activeTeamIds.length
    || beforeWaitlist !== event.checkin.waitlistTeamIds.length;
  if (changed) event.meta = { ...event.meta, updatedAt: nowIso() };
  return changed;
}

function removeTeamsFromRuntimeEvents(teamIds) {
  const removedTeamIds = new Set(teamIds.map(String));
  if (!removedTeamIds.size) return [];

  const affectedEventKeys = [];
  for (const eventKey of EVENT_KEYS) {
    updateJson(FILES.events[eventKey], createEventDefault(eventKey), event => {
      if (removeTeamFromEvent(event, removedTeamIds)) affectedEventKeys.push(eventKey);
      return event;
    });
  }

  return affectedEventKeys;
}

function repairTeamRuntimeData() {
  console.log('Runtime team repair started');

  const removedTeamIds = [];
  let repairedCount = 0;

  updateJson(FILES.teams, createTeamsDefault(), data => {
    const currentTeams = Array.isArray(data.teams) ? data.teams : [];
    const nextTeams = [];

    for (const team of currentTeams) {
      const result = repairTeam(team);
      const teamId = normalizeTeamId(result.team?.id || team?.id);
      if (result.remove) {
        if (teamId) removedTeamIds.push(teamId);
        continue;
      }
      if (result.repaired) repairedCount += 1;
      nextTeams.push(result.team);
    }

    return {
      ...data,
      version: data.version || 1,
      teams: nextTeams,
    };
  });

  const affectedEventKeys = removeTeamsFromRuntimeEvents(removedTeamIds);
  console.log(`Runtime team repair complete: repaired=${repairedCount}, hardDeleted=${removedTeamIds.length}, affectedEvents=${affectedEventKeys.length}`);

  return { repairedCount, removedTeamIds, affectedEventKeys };
}

module.exports = {
  repairTeamRuntimeData,
};
