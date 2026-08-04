'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { updateTeamsData } = require('../teams/team-repository');
const { createEmptyHistory } = require('../teams/team-achievements');
const { listVisibleTeams, normalizeClubName } = require('../teams/team-service');
const { resolveTeamLogoPath } = require('../teams/team-logos');
const { updateEventData } = require('../checkins/checkin-repository');
const { recalculateCheckinFormat } = require('../checkins/checkin-format');
const { FILES, readJson } = require('../../storage');
const { createEventDefault, createSettingsDefault } = require('../../storage/defaults');

const TEST_TEAM_NAMES = [
  'FC Test',
  'Loco Test United',
  'Ein Sehr Langer Testteamname',
  'Team Vier',
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
  'Aurora FC',
  'Blizzard United',
  'Cosmos CF',
  'Dragon Squad',
  'Eclipse City',
  'Falcon Rovers',
  'Galaxy FC',
  'Horizon FC',
  'Inferno United',
  'Jupiter CF',
  'Kraken Squad',
  'Legacy City',
  'Meteor Rovers',
  'Neon FC',
  'Orbit United',
  'Pulse CF',
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

function createTestTeam(id, name, actorUserId, timestamp) {
  const slug = slugify(name);
  return {
    id,
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
    twitchUrls: [],
    manager: {
      userId: null,
      addedAt: timestamp,
    },
    coManagers: [],
    history: createEmptyHistory(),
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

function isNameUsedByOtherActiveTeam(teams, normalizedName, ownId) {
  return teams.some(team => {
    if (!team || team.status === 'deleted') return false;
    if (String(team.id) === String(ownId)) return false;
    return team.normalizedClubName === normalizedName;
  });
}

function resolveTestTeamName(teams, baseName, ownId) {
  if (!isNameUsedByOtherActiveTeam(teams, normalizeClubName(baseName), ownId)) return baseName;

  const testName = `${baseName} Test`;
  if (!isNameUsedByOtherActiveTeam(teams, normalizeClubName(testName), ownId)) return testName;

  let counter = 2;
  while (isNameUsedByOtherActiveTeam(teams, normalizeClubName(`${testName} ${counter}`), ownId)) {
    counter += 1;
  }
  return `${testName} ${counter}`;
}

function ensureTestTeams(actorUserId) {
  const timestamp = nowIso();
  const createdIds = [];
  const existingIds = [];

  updateTeamsData(data => {
    data.teams = Array.isArray(data.teams) ? data.teams : [];

    for (const baseName of TEST_TEAM_NAMES) {
      const id = `test_team_${slugify(baseName)}`;
      const name = resolveTestTeamName(data.teams, baseName, id);
      const existing = data.teams.find(team => String(team.id) === id);
      if (existing) {
        existing.status = 'active';
        existing.registrationStatus = 'complete';
        existing.isTestTeam = true;
        existing.clubName = name;
        existing.normalizedClubName = normalizeClubName(name);
        existing.manager = existing.manager || { userId: null, addedAt: timestamp };
        existing.coManagers = Array.isArray(existing.coManagers) ? existing.coManagers : [];
        existing.twitchUrls = Array.isArray(existing.twitchUrls) ? existing.twitchUrls.slice(0, 3) : [];
        existing.logo = existing.logo || createTestTeam(id, name, actorUserId, timestamp).logo;
        existing.meta = { ...existing.meta, updatedAt: timestamp };
        existingIds.push(id);
        continue;
      }

      data.teams.push(createTestTeam(id, name, actorUserId, timestamp));
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
    const missingTeamIds = teamIds.filter(teamId => !existing.has(String(teamId)));
    if (event.format?.lockedAt && missingTeamIds.length) {
      throw new Error('Testdaten können nicht in ein bereits gelocktes Event eingefügt werden. Entferne zuerst Testdaten oder resette das Event.');
    }
    const timestamp = nowIso();
    event.meta = { ...(event.meta || {}), testMode: true, updatedAt: timestamp };

    for (const teamId of missingTeamIds) {
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
  const candidates = listVisibleTeams().filter(team => (
    team.status === 'active'
    && team.registrationStatus === 'complete'
    && resolveTeamLogoPath(team, { optional: true })
  ));
  if (candidates.length < 4) {
    throw new Error('Für den Testlauf werden mindestens vier aktive Teams mit gespeichertem Logo benötigt.');
  }
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  const allIds = candidates.slice(0, 32).map(team => String(team.id));
  const result = { createdIds: [], existingIds: allIds, allIds, source: 'active_teams_with_logos' };
  addTestCheckins(eventKey, result.allIds);
  return result;
}

function participantContainsRemovedTeam(participant, removedSet) {
  return participant?.type === 'team' && removedSet.has(String(participant.teamId));
}

function eventContainsRemovedTestData(event, removedSet) {
  if ((event.format?.participants || []).some(participant => participantContainsRemovedTeam(participant, removedSet))) return true;

  for (const group of Object.values(event.groups?.groups || {})) {
    for (const slot of group.slots || []) {
      if (participantContainsRemovedTeam(slot.participant || slot, removedSet)) return true;
    }
  }

  return false;
}

function resetTournamentStateIfNeeded(eventKey, event, removedSet) {
  if (!eventContainsRemovedTestData(event, removedSet)) return false;

  const defaults = createEventDefault(eventKey);
  event.format = {
    ...defaults.format,
    allowedSizes: event.format?.allowedSizes || defaults.format.allowedSizes,
    minimumRealTeams: event.format?.minimumRealTeams || defaults.format.minimumRealTeams,
  };
  event.groups = defaults.groups;
  event.knockout = defaults.knockout;
  event.status = 'checkin';
  return true;
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

  const settings = readJson(FILES.settings, createSettingsDefault());
  let removedCheckins = 0;
  for (const eventKey of EVENT_KEYS) {
    updateEventData(eventKey, event => {
      event.checkin = event.checkin || {};
      const testEntryIds = (event.checkin.entries || [])
        .filter(entry => entry?.isTestEntry === true)
        .map(entry => String(entry.teamId));
      const removedSet = new Set([...removedIds, ...testEntryIds]);
      removedCheckins += testEntryIds.length;
      event.checkin.entries = (event.checkin.entries || []).filter(entry => (
        entry?.isTestEntry !== true && !removedIds.includes(String(entry.teamId))
      ));
      event.checkin.activeTeamIds = (event.checkin.activeTeamIds || []).filter(teamId => !removedSet.has(String(teamId)));
      event.checkin.waitlistTeamIds = (event.checkin.waitlistTeamIds || []).filter(teamId => !removedSet.has(String(teamId)));

      if (event.meta?.testMode === true || eventContainsRemovedTestData(event, removedSet)) {
        resetTournamentStateIfNeeded(eventKey, event, removedSet);
      }
      event.meta = { ...(event.meta || {}), testMode: false };
      if (!event.format?.lockedAt) recalculateCheckinFormat(event, settings);
      event.meta = { ...event.meta, updatedAt: nowIso() };
      return event;
    });
  }

  return { removedIds, removedCheckins };
}

module.exports = {
  createTestDataForEvent,
  removeTestData,
};
