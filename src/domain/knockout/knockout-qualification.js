'use strict';

const { findTeamById } = require('../teams/team-service');
const { TOURNAMENT_FORMATS } = require('../../app/constants');
const { compareThirdPlaceRows, rankGroupRows } = require('../groups/group-ranking');
const { recalculateGroupStandings } = require('../groups/group-results');
const { getBomberXLocoFormat, isBomberXLocoEvent } = require('../events/bomber-x-loco-config');

const QUALIFICATION_RULES = TOURNAMENT_FORMATS;

function configForEvent(event) {
  const formatSize = Number(event.format?.size || 0);
  return isBomberXLocoEvent(event)
    ? getBomberXLocoFormat(formatSize)
    : QUALIFICATION_RULES[formatSize];
}

function groupKeysForEvent(event) {
  const config = configForEvent(event);
  return config
    ? Array.from({ length: config.groupCount }, (_, index) => String.fromCharCode(65 + index))
    : [];
}

function assertGroupsCompleted(event) {
  if (event.groups?.status !== 'completed') {
    throw new Error('Die K.O.-Phase kann erst erstellt werden, wenn die Gruppenphase abgeschlossen ist.');
  }

  const groupKeys = groupKeysForEvent(event);
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

function qualifyBomberXLocoTeams(event, config, groupKeys) {
  const direct = [];
  const wildcardCandidates = [];

  for (const groupKey of groupKeys) {
    const rows = rankedGroupRows(event.groups.groups[groupKey], groupKey);
    if (rows.length < config.directPlaces) {
      throw new Error(`Gruppe ${groupKey} hat nicht genug Teams für die K.O.-Qualifikation.`);
    }

    for (let rank = 1; rank <= config.directPlaces; rank += 1) {
      direct.push(createQualifiedTeam(rows[rank - 1], groupKey, rank, `rank_${rank}`, direct.length + 1));
    }

    if (config.wildcardPlace && rows[config.wildcardPlace - 1]) {
      wildcardCandidates.push(createQualifiedTeam(
        rows[config.wildcardPlace - 1],
        groupKey,
        config.wildcardPlace,
        `rank_${config.wildcardPlace}`,
        wildcardCandidates.length + 1,
      ));
    }
  }

  let qualifiedTeams = direct;
  if (config.wildcardCount > 0) {
    const label = `Beste Platz-${config.wildcardPlace}-Teams`;
    const wildcards = qualificationAudit(label, wildcardCandidates, config.wildcardCount)
      .slice(0, config.wildcardCount);
    qualifiedTeams = [...qualifiedTeams, ...wildcards];
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

function qualifyNormalTeams(event, config, groupKeys) {
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
    qualifiedTeams = [...qualifiedTeams, ...qualificationAudit('Beste Drittplatzierte', thirds, config.bestThirds).slice(0, config.bestThirds)];
  }
  if (config.bestFourths > 0) {
    qualifiedTeams = [...qualifiedTeams, ...qualificationAudit('Beste Viertplatzierte', fourths, config.bestFourths).slice(0, config.bestFourths)];
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

function qualifyTeams(event) {
  const config = configForEvent(event);
  if (!config) throw new Error('Für dieses Format ist keine K.O.-Qualifikation definiert.');
  const groupKeys = assertGroupsCompleted(event);
  return isBomberXLocoEvent(event)
    ? qualifyBomberXLocoTeams(event, config, groupKeys)
    : qualifyNormalTeams(event, config, groupKeys);
}

module.exports = {
  QUALIFICATION_RULES,
  compareRows: compareThirdPlaceRows,
  qualifyTeams,
};
