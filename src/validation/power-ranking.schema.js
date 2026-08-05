'use strict';

const { requireObject } = require('./common');

function validatePowerRanking(data) {
  const errors = [];
  if (!requireObject(errors, data, 'power ranking root')) return errors;
  if (data.version !== 1) errors.push('version must be 1');
  requireObject(errors, data.tournamentResults, 'tournamentResults');
  requireObject(errors, data.weeks, 'weeks');

  for (const [tournamentId, tournament] of Object.entries(data.tournamentResults || {})) {
    if (tournament.tournamentId !== tournamentId) errors.push(`tournamentResults.${tournamentId}.tournamentId must match its key`);
    if (!requireObject(errors, tournament.results, `tournamentResults.${tournamentId}.results`)) continue;
    for (const [teamId, result] of Object.entries(tournament.results)) {
      if (String(result.teamId) !== teamId) errors.push(`tournamentResults.${tournamentId}.results.${teamId}.teamId must match its key`);
      if (String(result.tournamentId) !== tournamentId) errors.push(`tournamentResults.${tournamentId}.results.${teamId}.tournamentId must match its tournament`);
    }
  }

  for (const [weekKey, week] of Object.entries(data.weeks || {})) {
    if (week.weekKey !== weekKey) errors.push(`weeks.${weekKey}.weekKey must match its key`);
    if (!['ACTIVE', 'FINALIZED'].includes(week.status)) errors.push(`weeks.${weekKey}.status must be ACTIVE or FINALIZED`);
  }
  return errors;
}

module.exports = { validatePowerRanking };
