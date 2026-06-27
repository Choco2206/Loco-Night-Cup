'use strict';

const { listVisibleTeams } = require('../teams/team-service');

const DISCORD_NICKNAME_LIMIT = 32;
const TEAM_PREFIX_PATTERN = /^(.+?)\s+(CO-VM|VM)\s*\|\s*(.+)$/i;

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripExistingTeamPrefix(value) {
  const clean = cleanName(value);
  const match = clean.match(TEAM_PREFIX_PATTERN);
  return match ? cleanName(match[3]) : clean;
}

function truncate(value, maxLength) {
  const clean = cleanName(value);
  if (clean.length <= maxLength) return clean;
  if (maxLength <= 1) return clean.slice(0, Math.max(0, maxLength));
  return clean.slice(0, maxLength - 1).trimEnd() + '…';
}

function getBaseUsername(member) {
  const displayBase = stripExistingTeamPrefix(member?.displayName);
  if (displayBase) return displayBase;
  return cleanName(member?.user?.globalName || member?.user?.username || member?.id || 'User');
}

function buildTeamNickname(team, roleLabel, baseUsername) {
  const teamName = cleanName(team?.clubName || 'Team');
  const baseName = cleanName(baseUsername || 'User');
  const separator = ` ${roleLabel} | `;
  const full = `${teamName}${separator}${baseName}`;
  if (full.length <= DISCORD_NICKNAME_LIMIT) return full;

  const readableBaseLength = Math.min(baseName.length, 10);
  let teamLength = DISCORD_NICKNAME_LIMIT - separator.length - readableBaseLength;
  if (teamLength >= 4) {
    const nickname = `${truncate(teamName, teamLength)}${separator}${truncate(baseName, readableBaseLength)}`;
    if (nickname.length <= DISCORD_NICKNAME_LIMIT) return nickname;
  }

  const minBaseLength = Math.min(baseName.length, 3);
  teamLength = Math.max(1, DISCORD_NICKNAME_LIMIT - separator.length - minBaseLength);
  const baseLength = Math.max(1, DISCORD_NICKNAME_LIMIT - separator.length - teamLength);
  return `${truncate(teamName, teamLength)}${separator}${truncate(baseName, baseLength)}`.slice(0, DISCORD_NICKNAME_LIMIT);
}

async function fetchMember(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members.fetch(String(userId)).catch(() => null);
}

function permissionErrorCode(error) {
  if (!error) return null;
  if (error.code === 50013) return 'missing_permissions';
  if (error.code === 50001) return 'missing_access';
  return null;
}

async function setTeamNickname(guild, userId, team, roleLabel) {
  const member = await fetchMember(guild, userId);
  if (!member) {
    return {
      ok: false,
      status: 'not_on_server',
      userId: String(userId || ''),
      teamId: team?.id ? String(team.id) : null,
      nickname: null,
      error: 'User ist nicht mehr auf dem Server.',
    };
  }

  const nickname = buildTeamNickname(team, roleLabel, getBaseUsername(member));
  if (member.displayName === nickname || member.nickname === nickname) {
    return {
      ok: true,
      status: 'already_correct',
      userId: String(userId),
      teamId: team?.id ? String(team.id) : null,
      nickname,
      error: null,
    };
  }

  try {
    await member.setNickname(nickname, 'Loco Night Cup Team-Nickname-Sync');
    return {
      ok: true,
      status: 'changed',
      userId: String(userId),
      teamId: team?.id ? String(team.id) : null,
      nickname,
      error: null,
    };
  } catch (error) {
    const status = permissionErrorCode(error) || 'error';
    console.warn(`[nickname-service] Nickname sync failed for user ${userId}: ${error.message}`);
    return {
      ok: false,
      status,
      userId: String(userId),
      teamId: team?.id ? String(team.id) : null,
      nickname,
      error: error.message,
    };
  }
}

async function setTeamManagerNickname(guild, userId, team) {
  return setTeamNickname(guild, userId, team, 'VM');
}

async function setTeamCoManagerNickname(guild, userId, team) {
  return setTeamNickname(guild, userId, team, 'CO-VM');
}

async function clearTeamNickname(guild, userId) {
  const member = await fetchMember(guild, userId);
  if (!member) {
    return {
      ok: false,
      status: 'not_on_server',
      userId: String(userId || ''),
      nickname: null,
      error: 'User ist nicht mehr auf dem Server.',
    };
  }

  const current = cleanName(member.nickname || member.displayName);
  const cleaned = stripExistingTeamPrefix(current);
  const username = cleanName(member.user?.globalName || member.user?.username || '');
  const nickname = cleaned && cleaned !== username ? cleaned : null;

  try {
    await member.setNickname(nickname, 'Loco Night Cup Team-Nickname-Cleanup');
    return {
      ok: true,
      status: 'changed',
      userId: String(userId),
      nickname,
      error: null,
    };
  } catch (error) {
    const status = permissionErrorCode(error) || 'error';
    console.warn(`[nickname-service] Nickname cleanup failed for user ${userId}: ${error.message}`);
    return {
      ok: false,
      status,
      userId: String(userId),
      nickname,
      error: error.message,
    };
  }
}

async function syncAllTeamNicknames(guild) {
  const results = [];
  const teams = listVisibleTeams()
    .filter(team => team.status === 'active' && team.registrationStatus === 'complete');

  for (const team of teams) {
    if (team.manager?.userId) {
      results.push(await setTeamManagerNickname(guild, team.manager.userId, team));
    } else {
      results.push({
        ok: false,
        status: 'skipped',
        userId: null,
        teamId: String(team.id),
        nickname: null,
        error: 'Team hat keinen VM.',
      });
    }

    for (const coManager of team.coManagers || []) {
      if (!coManager?.userId) continue;
      results.push(await setTeamCoManagerNickname(guild, coManager.userId, team));
    }
  }

  return {
    results,
    summary: summarizeNicknameResults(results),
  };
}

function summarizeNicknameResults(results) {
  const summary = {
    changed: 0,
    alreadyCorrect: 0,
    skipped: 0,
    missingPermissions: 0,
    notOnServer: 0,
    errors: 0,
  };

  for (const result of results || []) {
    if (result.status === 'changed') summary.changed += 1;
    else if (result.status === 'already_correct') summary.alreadyCorrect += 1;
    else if (result.status === 'skipped') summary.skipped += 1;
    else if (result.status === 'missing_permissions' || result.status === 'missing_access') summary.missingPermissions += 1;
    else if (result.status === 'not_on_server') summary.notOnServer += 1;
    else summary.errors += 1;
  }

  return summary;
}

module.exports = {
  buildTeamNickname,
  clearTeamNickname,
  setTeamCoManagerNickname,
  setTeamManagerNickname,
  stripExistingTeamPrefix,
  summarizeNicknameResults,
  syncAllTeamNicknames,
};
