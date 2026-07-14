'use strict';

const config = require('./config');
const { EaProClubsProvider } = require('./providers/ea-pro-clubs-provider');
const { resolveMatch } = require('./match-resolver');
const { readStore, updateStore } = require('./repository');

function usedIds(store, tournamentId) { return new Set(store.matches.filter(match => match.tournamentId === tournamentId).map(match => String(match.eaMatchId))); }
function rebuildStats(store, tournamentId) { const stats = {}; for (const match of store.matches.filter(entry => entry.tournamentId === tournamentId)) for (const player of match.players || []) { const key = `${player.proClubId}:${player.playerId}`; const row = stats[key] || { playerId: player.playerId, playerName: player.playerName, positionGroup: player.normalizedPosition?.group, clubId: player.proClubId, teamId: player.discordTeamId, matches: 0, ratingSum: 0, averageRating: 0, goals: 0, assists: 0, mom: 0, saves: 0, tackles: 0, redCards: 0, secondsPlayed: 0, eaMatchIds: [] }; row.playerName = player.playerName; row.matches += 1; row.ratingSum += Number(player.rating); row.averageRating = row.ratingSum / row.matches; row.goals += Number(player.goals) || 0; row.assists += Number(player.assists) || 0; row.mom += player.playerOfTheMatch ? 1 : 0; row.saves += Number(player.saves) || 0; row.tackles += Number(player.tackles) || 0; row.redCards += Number(player.redCards) || 0; row.secondsPlayed += Number(player.secondsPlayed) || 0; row.eaMatchIds.push(match.eaMatchId); stats[key] = row; } store.tournamentStats[tournamentId] = stats; }
async function processJob(job, provider) {
  const store = readStore(); const matches = await provider.getRecentFriendlyMatches(job.home.proClubId, job.home.platform || config.platform, config.matchResultCount);
  const resolved = resolveMatch(matches, job, usedIds(store, job.tournamentId));
  const timestamp = new Date().toISOString();
  updateStore(current => {
    const storedJob = current.jobs.find(entry => entry.id === job.id); if (!storedJob) return current;
    storedJob.attempts += 1; storedJob.updatedAt = timestamp; storedJob.status = resolved.status; storedJob.errorReason = null;
    if (resolved.status === 'found') {
      const ea = resolved.match;
      const mapPlayers = side => side.players.filter(player => player.isHuman).map(player => ({ ...player, discordTeamId: String(side.club.clubId) === String(job.home.proClubId) ? job.home.discordTeamId : job.away.discordTeamId, tournamentMatchId: job.tournamentMatchId, eaMatchId: ea.matchId }));
      current.matches.push({ tournamentId: job.tournamentId, eventKey: job.eventKey, tournamentMatchId: job.tournamentMatchId, eaMatchId: ea.matchId, timestamp: ea.timestamp, fetchedAt: timestamp, phase: job.phase, round: job.round, groupKey: job.groupKey, status: 'found', provider: 'ea-direct', home: ea.home.club, away: ea.away.club, result: job.result, players: [...mapPlayers(ea.home), ...mapPlayers(ea.away)] });
      rebuildStats(current, job.tournamentId);
      storedJob.foundEaMatchId = ea.matchId; storedJob.completedAt = timestamp; console.log(`[tott] Statistikjob erfolgreich: ${job.id} -> ${ea.matchId}`);
    } else if ((resolved.status === 'not_found' || resolved.status === 'api_error') && storedJob.attempts < config.maxAttempts) {
      storedJob.status = 'pending'; storedJob.nextAttemptAt = new Date(Date.now() + storedJob.attempts * 5 * 60 * 1000).toISOString();
    } else { storedJob.completedAt = timestamp; console.warn(`[tott] Job ${job.id}: ${resolved.status}`); }
    return current;
  });
  return resolved;
}
async function processPendingJobs({ provider = new EaProClubsProvider(), now = new Date() } = {}) {
  const jobs = readStore().jobs.filter(job => job.status === 'pending' && new Date(job.nextAttemptAt) <= now); const results = [];
  for (const job of jobs) { try { results.push(await processJob(job, provider)); } catch (error) { console.warn(`[tott] EA-API-Fehler fuer ${job.id}: ${error.code || error.message}`); updateStore(store => { const item = store.jobs.find(entry => entry.id === job.id); item.attempts += 1; item.status = item.attempts >= config.maxAttempts ? 'failed' : 'pending'; item.errorReason = error.code || 'api_error'; item.lastError = { code: error.code || 'api_error', message: error.message }; item.nextAttemptAt = new Date(Date.now() + item.attempts * 5 * 60 * 1000).toISOString(); if (item.status === 'failed') item.completedAt = new Date().toISOString(); return store; }); results.push({ status: 'api_error', error }); } }
  return results;
}
let timer = null;
function startTottJobScheduler(client = null) { if (timer) return timer; const run = async () => { await processPendingJobs(); if (client) { const { EVENT_KEYS } = require('../../app/constants'); const { readEventData } = require('../events/event-repository'); const { maybePublishAfterCeremony } = require('./publication'); for (const guild of client.guilds.cache.values()) for (const eventKey of EVENT_KEYS) { const event = readEventData(eventKey); if (event?.ceremony?.status === 'posted') await maybePublishAfterCeremony({ guild, eventKey, event }).catch(error => console.warn(`[tott] Auto-Publishing ${eventKey} fehlgeschlagen: ${error.message}`)); } } }; const safeRun = () => run().catch(error => console.warn(`[tott] Schedulerfehler: ${error.message}`)); setTimeout(safeRun, 15000).unref?.(); timer = setInterval(safeRun, 5 * 60 * 1000); timer.unref?.(); return timer; }
module.exports = { processJob, processPendingJobs, startTottJobScheduler };
