'use strict';

function ids(match) { return [String(match.home.club.clubId), String(match.away.club.clubId)].sort(); }
function scoreMatches(match, job) {
  const direct = String(match.home.club.clubId) === String(job.home.proClubId) && String(match.away.club.clubId) === String(job.away.proClubId);
  const reverse = String(match.home.club.clubId) === String(job.away.proClubId) && String(match.away.club.clubId) === String(job.home.proClubId);
  if (!direct && !reverse) return false;
  return direct
    ? Number(match.home.goals) === Number(job.result.homeGoals) && Number(match.away.goals) === Number(job.result.awayGoals)
    : Number(match.home.goals) === Number(job.result.awayGoals) && Number(match.away.goals) === Number(job.result.homeGoals);
}

function resolveMatch(matches, job, usedMatchIds = new Set()) {
  const expected = [String(job.home.proClubId), String(job.away.proClubId)].sort();
  const candidates = (matches || []).filter(match => ids(match).join(':') === expected.join(':'))
    .filter(match => scoreMatches(match, job))
    .filter(match => !match.matchType || match.matchType === 'friendlyMatch')
    .filter(match => Math.abs(new Date(match.timestamp) - new Date(job.confirmedAt)) <= 6 * 60 * 60 * 1000);
  const duplicates = candidates.filter(match => usedMatchIds.has(String(match.matchId)));
  const available = candidates.filter(match => !usedMatchIds.has(String(match.matchId)));
  if (available.length === 1) return { status: 'found', match: available[0] };
  if (available.length > 1) return { status: 'ambiguous', candidates: available };
  if (duplicates.length) return { status: 'duplicate_match', candidates: duplicates };
  return { status: 'not_found', candidates: [] };
}

module.exports = { resolveMatch, scoreMatches };
