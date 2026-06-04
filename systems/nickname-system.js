const fs = require('fs');
const path = require('path');

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');

function loadTeams() {
  try {
    if (!fs.existsSync(TEAMS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function shortenTeamName(teamName, maxLength = 18) {
  if (!teamName) return 'Team';

  if (teamName.length <= maxLength) {
    return teamName;
  }

  return teamName.substring(0, maxLength);
}

async function syncNicknames(guild) {
  if (!guild) return;

  const teams = loadTeams();

  await guild.members.fetch();

  const managedUsers = new Set();

  for (const team of teams) {
    const shortName = shortenTeamName(team.clubName);

    // =====================
    // VM
    // =====================

    if (team.managerId) {
      try {
        const member = await guild.members.fetch(team.managerId);

        if (member) {
          const username = member.user.username;

          const nickname =
            `${shortName} VM | ${username}`.substring(0, 32);

          if (member.manageable && member.nickname !== nickname) {
            await member.setNickname(nickname);
          }

          managedUsers.add(member.id);
        }
      } catch {}
    }

    // =====================
    // CO VM
    // =====================

    if (Array.isArray(team.coManagerIds)) {
      for (const coManagerId of team.coManagerIds) {
        try {
          const member = await guild.members.fetch(coManagerId);

          if (member) {
            const username = member.user.username;

            const nickname =
              `${shortName} Co-VM | ${username}`.substring(0, 32);

            if (member.manageable && member.nickname !== nickname) {
              await member.setNickname(nickname);
            }

            managedUsers.add(member.id);
          }
        } catch {}
      }
    }
  }

  return managedUsers;
}

module.exports = {
  syncNicknames,
};
