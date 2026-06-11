const fs = require('fs');
const path = require('path');

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');

function loadTeams() {
  try {
    if (!fs.existsSync(TEAMS_FILE)) return [];

    const raw = fs.readFileSync(TEAMS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('❌ teams.json konnte nicht gelesen werden:', error);
    return [];
  }
}

function shortenTeamName(teamName, maxLength = 18) {
  if (!teamName) return 'Team';

  const cleanName = String(teamName).trim();

  if (cleanName.length <= maxLength) {
    return cleanName;
  }

  return cleanName.substring(0, maxLength);
}

function findUserTeam(teams, userId) {
  const id = String(userId);

  return teams.find(team => {
    const isManager = String(team.managerId) === id;
    const isCoManager =
      Array.isArray(team.coManagerIds) &&
      team.coManagerIds.map(String).includes(id);

    return isManager || isCoManager;
  });
}

function buildNickname(team, userId, username) {
  const shortName = shortenTeamName(team.clubName);
  const roleLabel = String(team.managerId) === String(userId) ? 'VM' : 'Co-VM';

  return `${shortName} ${roleLabel} | ${username}`.substring(0, 32);
}

async function syncSingleNickname(guild, userId) {
  if (!guild || !userId) return false;

  const teams = loadTeams();
  const team = findUserTeam(teams, userId);

  if (!team) return false;

  let member;

  try {
    member = await guild.members.fetch(userId);
  } catch (error) {
    console.warn(`⚠️ User ${userId} konnte für Nickname-Sync nicht geladen werden.`);
    return false;
  }

  const nickname = buildNickname(team, userId, member.user.username);

  if (member.manageable && member.nickname !== nickname) {
    await member.setNickname(nickname);
  }

  return true;
}

async function syncTeamNicknames(guild, teamId) {
  if (!guild || !teamId) return;

  const teams = loadTeams();
  const team = teams.find(t => String(t.id) === String(teamId));

  if (!team) return;

  const userIds = [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ].filter(Boolean);

  for (const userId of userIds) {
    await syncSingleNickname(guild, userId);
  }
}

async function syncNicknames(guild) {
  if (!guild) return new Set();

  const teams = loadTeams();
  const managedUsers = new Set();

  for (const team of teams) {
    const userIds = [
      team.managerId,
      ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
    ].filter(Boolean);

    for (const userId of userIds) {
      const synced = await syncSingleNickname(guild, userId);

      if (synced) {
        managedUsers.add(String(userId));
      }
    }
  }

  return managedUsers;
}

module.exports = {
  syncNicknames,
  syncSingleNickname,
  syncTeamNicknames,
};
