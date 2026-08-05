'use strict';

// EA kann die letzten Matchdaten zeitversetzt liefern. Der TOTT-Workflow versucht
// bis rund 67 Minuten nach Turnierende erneut; erst danach darf aufgeräumt werden.
const AUTO_CLEANUP_DELAY_MS = 75 * 60 * 1000;
const TOTT_CLEANUP_RECHECK_MS = 15 * 60 * 1000;

function isPowerRankingSettled(event) {
  if (event?.knockout?.status !== 'completed' || event?.meta?.testMode === true) return true;
  const tournamentId = event?.cycle?.cycleKey;
  if (!tournamentId) return false;
  const { FILES, readJson } = require('../../storage');
  const { createPowerRankingDefault } = require('../../storage/defaults');
  const data = readJson(FILES.powerRanking, createPowerRankingDefault());
  return Boolean(data.tournamentResults?.[String(tournamentId)]);
}

function isTeamOfTheTournamentSettled(event) {
  if (event?.knockout?.status !== 'completed') return true;
  const state = event?.ceremony?.teamOfTheTournament || {};
  return Boolean(state.postedAt) || ['posted', 'skipped', 'failed'].includes(state.postStatus);
}

module.exports = { AUTO_CLEANUP_DELAY_MS, TOTT_CLEANUP_RECHECK_MS, isPowerRankingSettled, isTeamOfTheTournamentSettled };
