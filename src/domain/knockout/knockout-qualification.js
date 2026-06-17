'use strict';

const { findTeamById } = require('../teams/team-service');

const QUALIFICATION_RULES = {
  8: { rule: 'top2', qualifiedCount: 4 },
  16: { rule: 'top2', qualifiedCount: 8 },
  24: { rule: 'top2_plus_4_best_thirds', qualifiedCount: 16 },
  32: { rule: 'top2', qualifiedCount: 16 },
};

function groupKeysForFormat(formatSize) {
  return Object.keys(QUALIFICATION_RULES).includes(String(formatSize))
    ? Array.from({ length: Number(formatSize) / 4 }, (_, index) => String.fromCharCode(65 + index))
    : [];
}

function assertGroupsCompleted(event) {
  if (event.groups?.status !== 'completed') {
    throw new Error('Die K.O.-Phase kann erst erstellt werden, wenn die Gruppenphase abgeschlossen ist.');
  }

  const formatSize = Number(event.format?.size || 0);
  const groupKeys = groupKeysForFormat(formatSize);
  if (!groupKeys.length) throw new Error('Fuer dieses Format kann keine K.O.-Phase erstellt werden.');

  for (const groupKey of groupKeys) {
    const group = event.groups?.groups?.[groupKey];
    if (!group) throw new Error(`Gruppe ${groupKey} wurde nicht gefunden.`);
    if (group.status !== 'completed') throw new Error(`Gruppe ${groupKey} ist noch nicht abgeschlossen.`);
  }

  return groupKeys;
}

function compareRows(a, b) {
  return (
    Number(b.points || 0) - Number(a.points || 0) ||
    Number(b.goalDifference || 0) - Number(a.goalDifference || 0) ||
    Number(b.goalsFor || 0) - Number(a.goalsFor || 0) ||
    Number(a.goalsAgainst || 0) - Number(b.goalsAgainst || 0) ||
    String(a.displayName || '').localeCompare(String(b.displayName || ''), 'de', { sensitivity: 'base' }) ||
    String(a.groupKey || '').localeCompare(String(b.groupKey || ''), 'de', { sensitivity: 'base' }) ||
    String(a.teamId || '').localeCompare(String(b.teamId || ''), 'de', { sensitivity: 'base' })
  );
}

function createQualifiedTeam(row, groupKey, groupRank, seedBucket, seedIndex) {
  const team = findTeamById(row.teamId);
  return {
    teamId: String(row.teamId),
    displayName: row.displayName || team?.clubName || String(row.teamId),
    groupKey,
    groupRank,
    seedBucket,
    seed: seedIndex,
    statsSnapshot: {
      played: Number(row.played || 0),
      wins: Number(row.wins || 0),
      draws: Number(row.draws || 0),
      losses: Number(row.losses || 0),
      goalsFor: Number(row.goalsFor || 0),
      goalsAgainst: Number(row.goalsAgainst || 0),
      goalDifference: Number(row.goalDifference || 0),
      points: Number(row.points || 0),
    },
  };
}

function rankedGroupRows(group, groupKey) {
  return (group.standings || [])
    .filter(row => row.teamId)
    .map(row => ({ ...row, groupKey }))
    .sort(compareRows);
}

function qualifyTeams(event) {
  const formatSize = Number(event.format?.size || 0);
  const config = QUALIFICATION_RULES[formatSize];
  if (!config) throw new Error('Fuer dieses Format ist keine K.O.-Qualifikation definiert.');

  const groupKeys = assertGroupsCompleted(event);
  const winners = [];
  const runnersUp = [];
  const thirds = [];

  for (const groupKey of groupKeys) {
    const rows = rankedGroupRows(event.groups.groups[groupKey], groupKey);
    if (rows.length < 2) throw new Error(`Gruppe ${groupKey} hat nicht genug echte Teams fuer die K.O.-Qualifikation.`);

    winners.push(createQualifiedTeam(rows[0], groupKey, 1, 'winner', winners.length + 1));
    runnersUp.push(createQualifiedTeam(rows[1], groupKey, 2, 'runner_up', runnersUp.length + 1));
    if (rows[2]) thirds.push(createQualifiedTeam(rows[2], groupKey, 3, 'third', thirds.length + 1));
  }

  let qualifiedTeams = [...winners, ...runnersUp];
  if (config.rule === 'top2_plus_4_best_thirds') {
    const bestThirds = thirds
      .slice()
      .sort((a, b) => compareRows(
        { ...a.statsSnapshot, displayName: a.displayName, groupKey: a.groupKey, teamId: a.teamId },
        { ...b.statsSnapshot, displayName: b.displayName, groupKey: b.groupKey, teamId: b.teamId }
      ))
      .slice(0, 4)
      .map((team, index) => ({ ...team, seed: winners.length + runnersUp.length + index + 1 }));
    qualifiedTeams = [...qualifiedTeams, ...bestThirds];
  }

  if (qualifiedTeams.length !== config.qualifiedCount) {
    throw new Error(`K.O.-Qualifikation erwartet ${config.qualifiedCount} Teams, gefunden: ${qualifiedTeams.length}.`);
  }

  return {
    rule: config.rule,
    qualifiedCount: config.qualifiedCount,
    qualifiedTeams: qualifiedTeams.map((team, index) => ({ ...team, seed: index + 1 })),
  };
}

module.exports = {
  QUALIFICATION_RULES,
  compareRows,
  qualifyTeams,
};
