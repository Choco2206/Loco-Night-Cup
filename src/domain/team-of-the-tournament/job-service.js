'use strict';

const { findTeamById } = require('../teams/team-service');
const { updateStore } = require('./repository');
const { readEventData } = require('../events/event-repository');

function verified(team) { return Boolean(team?.proClub?.verified && team.proClub.clubId && team.proClub.platform); }
function enqueueConfirmedMatch({ eventKey, match, phase, round, groupKey = null }) {
  if (!match?.id || match.status !== 'confirmed' || !match.result) return null;
  const home = findTeamById(match.home?.teamId); const away = findTeamById(match.away?.teamId);
  const event = readEventData(eventKey); const tournamentId = `${eventKey}:${event?.cycle?.cycleKey || event?.cycle?.eventDate || 'unknown'}`;
  const timestamp = new Date().toISOString(); const id = `${tournamentId}:${phase}:${match.id}`;
  let job;
  updateStore(store => {
    const existing = store.jobs.find(entry => entry.id === id);
    if (existing) { job = existing; return store; }
    job = { id, tournamentId, eventKey, tournamentMatchId: String(match.id), phase, round, groupKey, confirmedAt: match.result.confirmedAt || timestamp, result: { homeGoals: Number(match.result.homeGoals), awayGoals: Number(match.result.awayGoals) }, home: { discordTeamId: home?.id || null, proClubId: home?.proClub?.clubId || null, platform: home?.proClub?.platform || null }, away: { discordTeamId: away?.id || null, proClubId: away?.proClub?.clubId || null, platform: away?.proClub?.platform || null }, status: verified(home) && verified(away) ? 'pending' : 'skipped_unverified_team', attempts: 0, nextAttemptAt: timestamp, createdAt: timestamp, updatedAt: timestamp, completedAt: verified(home) && verified(away) ? null : timestamp };
    store.jobs.push(job); return store;
  });
  return job;
}
module.exports = { enqueueConfirmedMatch, verified };
