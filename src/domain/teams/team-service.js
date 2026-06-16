'use strict';

const { readTeamsData, updateTeamsData } = require('./team-repository');

function nowIso() {
  return new Date().toISOString();
}

function normalizeClubName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

function createTeamId() {
  return `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isNonDeletedTeam(team) {
  return team && team.status !== 'deleted';
}

function isTeamMember(team, userId) {
  if (!team || !userId) return false;
  const id = String(userId);
  if (team.manager?.userId && String(team.manager.userId) === id) return true;
  return Array.isArray(team.coManagers) && team.coManagers.some(co => String(co.userId) === id);
}

function findTeamById(teamId) {
  return readTeamsData().teams.find(team => String(team.id) === String(teamId)) || null;
}

function findNonDeletedTeamByUserId(userId) {
  return readTeamsData().teams.find(team => isNonDeletedTeam(team) && isTeamMember(team, userId)) || null;
}

function findNonDeletedTeamByClubName(clubName) {
  const normalized = normalizeClubName(clubName);
  return readTeamsData().teams.find(team => isNonDeletedTeam(team) && team.normalizedClubName === normalized) || null;
}

function listVisibleTeams() {
  return readTeamsData().teams.filter(isNonDeletedTeam);
}

function assertClubNameAvailable(teams, clubName, ignoreTeamId = null) {
  const normalized = normalizeClubName(clubName);
  const duplicate = teams.find(team => {
    if (!isNonDeletedTeam(team)) return false;
    if (ignoreTeamId && String(team.id) === String(ignoreTeamId)) return false;
    return team.normalizedClubName === normalized;
  });

  if (duplicate) throw new Error('Dieser Teamname ist bereits vergeben.');
}

function assertUserAvailable(teams, userId, ignoreTeamId = null) {
  const existing = teams.find(team => {
    if (!isNonDeletedTeam(team)) return false;
    if (ignoreTeamId && String(team.id) === String(ignoreTeamId)) return false;
    return isTeamMember(team, userId);
  });

  if (existing) throw new Error(`Dieser User ist bereits bei ${existing.clubName} eingetragen.`);
}

function createTeam({ clubName, managerUserId, settings }) {
  const min = settings.teams.clubNameMinLength;
  const max = settings.teams.clubNameMaxLength;
  const cleanName = String(clubName || '').trim();

  if (cleanName.length < min || cleanName.length > max) {
    throw new Error(`Der Teamname muss zwischen ${min} und ${max} Zeichen lang sein.`);
  }

  let createdTeam;

  updateTeamsData(data => {
    assertClubNameAvailable(data.teams, cleanName);
    assertUserAvailable(data.teams, managerUserId);

    const timestamp = nowIso();
    createdTeam = {
      id: createTeamId(),
      status: 'active',
      registrationStatus: 'incomplete',
      clubName: cleanName,
      normalizedClubName: normalizeClubName(cleanName),
      logo: null,
      manager: {
        userId: String(managerUserId),
        addedAt: timestamp,
      },
      coManagers: [],
      stats: createEmptyStats(),
      meta: {
        createdAt: timestamp,
        createdByUserId: String(managerUserId),
        updatedAt: timestamp,
        deletedAt: null,
        deletedByUserId: null,
      },
    };

    return {
      ...data,
      teams: [...data.teams, createdTeam],
    };
  });

  return createdTeam;
}

function updateTeamName({ teamId, newClubName, actorUserId, settings }) {
  const cleanName = String(newClubName || '').trim();
  if (cleanName.length < settings.teams.clubNameMinLength || cleanName.length > settings.teams.clubNameMaxLength) {
    throw new Error('Der Teamname hat eine ungültige Länge.');
  }

  let updatedTeam;
  updateTeamsData(data => {
    const team = data.teams.find(entry => String(entry.id) === String(teamId));
    if (!isNonDeletedTeam(team)) throw new Error('Team wurde nicht gefunden.');
    if (!isTeamMember(team, actorUserId)) throw new Error('Du darfst dieses Team nicht bearbeiten.');

    assertClubNameAvailable(data.teams, cleanName, team.id);
    team.clubName = cleanName;
    team.normalizedClubName = normalizeClubName(cleanName);
    team.meta.updatedAt = nowIso();
    updatedTeam = team;
    return data;
  });

  return updatedTeam;
}

function setTeamLogo({ teamId, logo, uploadedByUserId }) {
  let updatedTeam;
  updateTeamsData(data => {
    const team = data.teams.find(entry => String(entry.id) === String(teamId));
    if (!isNonDeletedTeam(team)) throw new Error('Team wurde nicht gefunden.');
    if (!isTeamMember(team, uploadedByUserId)) throw new Error('Du darfst dieses Logo nicht setzen.');

    team.logo = logo;
    team.registrationStatus = 'complete';
    team.meta.updatedAt = nowIso();
    updatedTeam = team;
    return data;
  });

  return updatedTeam;
}

function addCoManager({ teamId, userId, actorUserId, settings }) {
  let updatedTeam;
  updateTeamsData(data => {
    const team = data.teams.find(entry => String(entry.id) === String(teamId));
    if (!isNonDeletedTeam(team)) throw new Error('Team wurde nicht gefunden.');
    if (!isTeamMember(team, actorUserId)) throw new Error('Du darfst dieses Team nicht bearbeiten.');
    if (team.manager?.userId && String(team.manager.userId) === String(userId)) throw new Error('Der VM kann nicht zusätzlich Co-VM sein.');
    if (team.coManagers.length >= settings.teams.coManagerLimit) throw new Error('Das Co-VM-Limit ist erreicht.');
    if (team.coManagers.some(co => String(co.userId) === String(userId))) throw new Error('Dieser User ist bereits Co-VM.');

    assertUserAvailable(data.teams, userId, team.id);

    team.coManagers.push({
      userId: String(userId),
      addedAt: nowIso(),
      addedByUserId: String(actorUserId),
    });
    team.meta.updatedAt = nowIso();
    updatedTeam = team;
    return data;
  });

  return updatedTeam;
}

function removeCoManager({ teamId, userId, actorUserId }) {
  let updatedTeam;
  updateTeamsData(data => {
    const team = data.teams.find(entry => String(entry.id) === String(teamId));
    if (!isNonDeletedTeam(team)) throw new Error('Team wurde nicht gefunden.');
    if (!isTeamMember(team, actorUserId)) throw new Error('Du darfst dieses Team nicht bearbeiten.');

    const before = team.coManagers.length;
    team.coManagers = team.coManagers.filter(co => String(co.userId) !== String(userId));
    if (team.coManagers.length === before) throw new Error('Dieser User ist kein Co-VM.');

    team.meta.updatedAt = nowIso();
    updatedTeam = team;
    return data;
  });

  return updatedTeam;
}

function deleteTeam({ teamId, actorUserId }) {
  let deletedTeam;
  updateTeamsData(data => {
    const team = data.teams.find(entry => String(entry.id) === String(teamId));
    if (!isNonDeletedTeam(team)) throw new Error('Team wurde nicht gefunden.');
    if (!team.manager?.userId || String(team.manager.userId) !== String(actorUserId)) {
      throw new Error('Nur der VM kann das Team löschen.');
    }

    const timestamp = nowIso();
    team.status = 'deleted';
    team.meta.updatedAt = timestamp;
    team.meta.deletedAt = timestamp;
    team.meta.deletedByUserId = String(actorUserId);
    deletedTeam = team;
    return data;
  });

  return deletedTeam;
}

function leaveTeam({ teamId, userId }) {
  let updatedTeam;
  updateTeamsData(data => {
    const team = data.teams.find(entry => String(entry.id) === String(teamId));
    if (!isNonDeletedTeam(team)) throw new Error('Team wurde nicht gefunden.');
    if (!isTeamMember(team, userId)) throw new Error('Du bist nicht in diesem Team.');

    const timestamp = nowIso();
    if (team.manager?.userId && String(team.manager.userId) === String(userId)) {
      const nextManager = team.coManagers.shift();
      if (nextManager) {
        team.manager = {
          userId: String(nextManager.userId),
          addedAt: timestamp,
        };
        team.status = 'active';
      } else {
        team.manager = null;
        team.status = 'leaderless';
      }
    } else {
      team.coManagers = team.coManagers.filter(co => String(co.userId) !== String(userId));
    }

    team.meta.updatedAt = timestamp;
    updatedTeam = team;
    return data;
  });

  return updatedTeam;
}

function handleMemberRemoved({ userId }) {
  const affectedUserIds = new Set([String(userId)]);
  let changed = false;

  updateTeamsData(data => {
    for (const team of data.teams) {
      if (!isNonDeletedTeam(team)) continue;

      if (team.manager?.userId && String(team.manager.userId) === String(userId)) {
        const nextManager = team.coManagers.shift();
        if (nextManager) {
          team.manager = {
            userId: String(nextManager.userId),
            addedAt: nowIso(),
          };
          affectedUserIds.add(String(nextManager.userId));
        } else {
          team.manager = null;
          team.status = 'leaderless';
        }
        team.meta.updatedAt = nowIso();
        changed = true;
        continue;
      }

      const before = team.coManagers.length;
      team.coManagers = team.coManagers.filter(co => String(co.userId) !== String(userId));
      if (team.coManagers.length !== before) {
        team.meta.updatedAt = nowIso();
        changed = true;
      }
    }

    return data;
  });

  return {
    changed,
    affectedUserIds: [...affectedUserIds],
  };
}

module.exports = {
  addCoManager,
  createTeam,
  deleteTeam,
  findNonDeletedTeamByClubName,
  findNonDeletedTeamByUserId,
  findTeamById,
  handleMemberRemoved,
  isNonDeletedTeam,
  isTeamMember,
  leaveTeam,
  listVisibleTeams,
  normalizeClubName,
  removeCoManager,
  setTeamLogo,
  updateTeamName,
};
