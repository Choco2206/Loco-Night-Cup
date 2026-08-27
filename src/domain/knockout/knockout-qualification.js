'use strict';

const { findTeamById } = require('../teams/team-service');
const { TOURNAMENT_FORMATS } = require('../../app/constants');
const { compareThirdPlaceRows, rankGroupRows } = require('../groups/group-ranking');
const { recalculateGroupStandings } = require('../groups/group-results');

const QUALIFICATION_RULES = TOURNAMENT_FORMATS;

function groupKeysForFormat(formatSize) {
  const config = QUALIFICATION_RULES[Number(formatSize)];
  return config
    ? Array.from({ length: config.groupCount }, (_, index) => String.fromCharCode(65 + index))
    : [];
}

function assertGroupsCompleted(event) {
  if (event.groups?.status !== 'completed') {
    throw new Error('Die K.O.-Phase kann erst erstellt werden, wenn die Gruppenphase abgeschlossen ist.');
  }

  const formatSize = Number(event.format?.size || 0);
  const groupKeys = groupKeysForFormat(formatSize);
  if (!groupKeys.length) throw new Error('Für dieses Format kann keine K.O.-Phase erstellt werden.');

  for (const groupKey of groupKeys) {
    const group = event.groups?.groups?.[groupKey];
    if (!group) throw new Error(`Gruppe ${groupKey} wurde nicht gefunden.`);
    if (group.status !== 'completed') throw new Error(`Gruppe ${groupKey} ist noch nicht abgeschlossen.`);
  }

  return groupKeys;
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
  // Sicherheitsnetz: Direkt vor der K.O.-Qualifikation wird die Tabelle
  // ausschließlich aus den final bestätigten Ergebnissen neu aufgebaut.
  // So kann kein veralteter Stand in die Best-Third-/Best-Fourth-Auswahl rutschen.
  recalculateGroupStandings(group);
  return rankGroupRows(group).map(row => ({ ...row, groupKey }));
}

function crossGroupRow(team) {
  return {
    ...team.statsSnapshot,
    displayName: team.displayName,
    groupKey: team.groupKey,
    teamId: team.teamId,
  };
}

function sortCrossGroupCandidates(teams) {
  return teams.slice().sort((a, b) => compareThirdPlaceRows(crossGroupRow(a), crossGroupRow(b)));
}

function qualificationAudit(label, candidates, selectedCount) {
  const ranked = sortCrossGroupCandidates(candidates);
  console.info(`[qualification] ${label}: ` + ranked.map((team, index) => {
    const s = team.statsSnapshot;
    const marker = index < selectedCount ? 'QUALI' : 'OUT';
    const gd = s.goalDifference >= 0 ? `+${s.goalDifference}` : String(s.goalDifference);
    return `${marker} ${team.displayName} (${team.groupKey}) ${s.points}P ${gd}TD ${s.goalsFor}:${s.goalsAgainst}`;
  }).join(' | '));
  return ranked;
}

function qualifyTeams(event) {
  const formatSize = Number(event.format?.size || 0);
  const config = QUALIFICATION_RULES[formatSize];
  if (!config) throw new Error('Für dieses Format ist keine K.O.-Qualifikation definiert.');

  const groupKeys = assertGroupsCompleted(event);
  const winners = [];
  const runnersUp = [];
  const thirds = [];
  const fourths = [];

  for (const groupKey of groupKeys) {
    const rows = rankedGroupRows(event.groups.groups[groupKey], groupKey);
    if (rows.length < 2) throw new Error(`Gruppe ${groupKey} hat nicht genug echte Teams für die K.O.-Qualifikation.`);

    winners.push(createQualifiedTeam(rows[0], groupKey, 1, 'winner', winners.length + 1));
    runnersUp.push(createQualifiedTeam(rows[1], groupKey, 2, 'runner_up', runnersUp.length + 1));
    if (rows[2]) thirds.push(createQualifiedTeam(rows[2], groupKey, 3, 'third', thirds.length + 1));
    if (rows[3]) fourths.push(createQualifiedTeam(rows[3], groupKey, 4, 'fourth', fourths.length + 1));
  }

  let qualifiedTeams = [...winners, ...runnersUp];
  if (config.bestThirds > 0) {
    const bestThirds = qualificationAudit('Beste Drittplatzierte', thirds, config.bestThirds)
      .slice(0, config.bestThirds)
      .map((team, index) => ({ ...team, seed: winners.length + runnersUp.length + index + 1 }));
    qualifiedTeams = [...qualifiedTeams, ...bestThirds];
  }

  if (config.bestFourths > 0) {
    const bestFourths = qualificationAudit('Beste Viertplatzierte', fourths, config.bestFourths)
      .slice(0, config.bestFourths)
      .map((team, index) => ({ ...team, seed: qualifiedTeams.length + index + 1 }));
    qualifiedTeams = [...qualifiedTeams, ...bestFourths];
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
  compareRows: compareThirdPlaceRows,
  qualifyTeams,
};
