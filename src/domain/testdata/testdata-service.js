'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { updateTeamsData } = require('../teams/team-repository');
const { normalizeClubName } = require('../teams/team-service');
const { updateEventData } = require('../checkins/checkin-repository');
const { recalculateCheckinFormat } = require('../checkins/checkin-format');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');

const TEST_TEAM_NAMES = [
  'Alpha FC',
  'Bravo United',
  'Charlie CF',
  'Delta Squad',
  'Echo City',
  'Foxtrot Rovers',
  'Gamma FC',
  'Omega FC',
  'Titan FC',
  'Phoenix CF',
  'Luna United',
  'Nova Squad',
  'Orion FC',
  'Atlas CF',
  'Vortex City',
  'Zenith Rovers',
];

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function createEmptyStats() {
  return {
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    tournamentWins: 0,
    finalAppearances: 0,
    thirdPlaceFinishes: 0,
  };
}

function createTestTeam(name, actorUserId, timestamp) {
  const slug = slugify(name);
  return {
    id: `test_team_${slug}`,
    isTestTeam: true,
    status: 'active',
    registrationStatus: 'complete',
    clubName: name,
    normalizedClubName: normalizeClubName(name),
    logo: {
      fileName: `${slug}.png`,
      path: `test-data://${slug}.png`,
      uploadedAt: timestamp,
      uploadedByUserId: null,
    },
    logoUpload: null,
    manager: {
      userId: null,
      addedAt: timestamp,
    },
    coManagers: [],
    stats: createEmptyStats(),
    meta: {
      createdAt: timestamp,
      createdByUserId: actorUserId ? String(actorUserId) : null,
      updatedAt: timestamp,
      deletedAt: null,
      deletedByUserId: null,
    },
  };
}

function ensureTestTeams(actorUserId) {
  const timestamp = nowIso();
  const createdIds = [];
  const existingIds = [];

  updateTeamsData(data => {
    data.teams = Array.isArray(data.teams) ? data.teams : [];

    for (const name of TEST_TEAM_NAMES) {
      const id = `test_team_${slugify(name)}`;
      const existing = data.teams.find(team => String(team.id) === id);
      if (existing) {
        existing.status = 'active';
        existing.registrationStatus = 'complete';
        existing.isTestTeam = true;
        existing.manager = existing.manager || { userId: null, addedAt: timestamp };
        existing.coManagers = Array.isArray(existing.coManagers) ? existing.coManagers : [];
        existing.logo = existing.logo || createTestTeam(name, actorUserId, timestamp).logo;
        existing.meta = { ...existing.meta, updatedAt: timestamp };
        existingIds.push(id);
        continue;
      }

      data.teams.push(createTestTeam(name, actorUserId, timestamp));
      createdIds.push(id);
    }

    return data;
  });

  return { createdIds, existingIds, allIds: TEST_TEAM_NAMES.map(name => `test_team_${slugify(name)}`) };
}

function addTestCheckins(eventKey, teamIds) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  updateEventData(eventKey, event => {
    event.checkin = event.checkin || {};
    event.checkin.entries = Array.isArray(event.checkin.entries) ? event.checkin.entries : [];
    const existing = new Set(event.checkin.entries.map(entry => String(entry.teamId)));
    const timestamp = nowIso();

    for (const teamId of teamIds) {
      if (existing.has(String(teamId))) continue;
      event.checkin.entries.push({
        teamId: String(teamId),
        checkedInByUserId: null,
        checkedInAt: timestamp,
        isTestEntry: true,
      });
      existing.add(String(teamId));
    }

    event.status = 'checkin';
    event.checkin.isOpen = true;
    event.checkin.openedAt = event.checkin.openedAt || timestamp;
    event.meta = { ...event.meta, updatedAt: timestamp };
    recalculateCheckinFormat(event, settings);
    return event;
  });
}

function createTestDataForEvent({ eventKey, actorUserId }) {
  const result = ensureTestTeams(actorUserId);
  addTestCheckins(eventKey, result.allIds);
  return result;
}

function removeTestData() {
  const removedIds = [];

  updateTeamsData(data => {
    data.teams = (data.teams || []).filter(team => {
      if (team?.isTestTeam === true) {
        removedIds.push(String(team.id));
        return false;
      }
      return true;
    });
    return data;
  });

  if (!removedIds.length) return { removedIds };

  const removedSet = new Set(removedIds);
  const settings = readJson(FILES.settings, createSettingsDefault());
  for (const eventKey of EVENT_KEYS) {
    updateEventData(eventKey, event => {
      event.checkin = event.checkin || {};
      event.checkin.entries = (event.checkin.entries || []).filter(entry => !removedSet.has(String(entry.teamId)));
      event.checkin.activeTeamIds = (event.checkin.activeTeamIds || []).filter(teamId => !removedSet.has(String(teamId)));
      event.checkin.waitlistTeamIds = (event.checkin.waitlistTeamIds || []).filter(teamId => !removedSet.has(String(teamId)));

      if (!event.format?.lockedAt) recalculateCheckinFormat(event, settings);
      event.meta = { ...event.meta, updatedAt: nowIso() };
      return event;
    });
  }

  return { removedIds };
}

module.exports = {
  createTestDataForEvent,
  removeTestData,
};
