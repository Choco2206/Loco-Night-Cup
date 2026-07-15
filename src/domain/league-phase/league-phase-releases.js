'use strict';

const { readEventData, updateEventData } = require('../events/event-repository');
const { getTournamentStartAt } = require('../checkins/checkin-schedule');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { createKnockoutPhase } = require('../knockout/knockout-service');
const { refreshLeaguePhasePosts } = require('./league-phase-service');
const { getLeagueMatches } = require('./league-phase-results');
const { getConfiguredGuild } = require('../groups/group-roles');
const { deleteUserMessagesFromGroupChannel } = require('../groups/group-message-cleanup');

const timers = new Map();
function dayComplete(day) { return (day?.matches || []).length === 10 && day.matches.every(match => match.status === 'confirmed'); }
async function postRelease(client, eventKey, dayNumber) {
  const event = readEventData(eventKey); const phase = event.leaguePhase; const channel = client && phase?.overviewChannelId ? await client.channels.fetch(phase.overviewChannelId).catch(() => null) : null; if (!channel) return null;
  const oldId = phase.messages?.releaseMessageId; const old = oldId ? await channel.messages.fetch(oldId).catch(() => null) : null;
  if (old) await old.delete().catch(() => null);
  const message = await channel.send({ content: `ðŸ“£ **Ligaphase â€“ Spieltag ${dayNumber} ist freigegeben.**\nAlle 10 Begegnungen dieses Spieltags kÃ¶nnen jetzt gemeldet werden.`, allowedMentions: { parse: [] } });
  updateEventData(eventKey, stored => { stored.leaguePhase.messages.releaseMessageId = message.id; return stored; }); return message;
}
async function releaseLeagueMatchday(client, eventKey, dayNumber, now = new Date()) {
  let changed = false; updateEventData(eventKey, event => { const phase = event.leaguePhase; const day = phase?.matchdays?.[dayNumber - 1]; if (!day || day.status !== 'locked') return event; const timestamp = now.toISOString(); day.status = 'open'; day.releasedAt = timestamp; phase.currentMatchday = dayNumber; for (const match of day.matches) { match.status = match.home?.type === 'team' && match.away?.type === 'team' ? 'open' : 'bye'; match.release = { slot: dayNumber, releasedAt: timestamp }; } changed = true; return event; });
  if (changed) { await postRelease(client, eventKey, dayNumber); await refreshLeaguePhasePosts(client, eventKey); console.info(`[league-phase] ${eventKey}: Spieltag ${dayNumber} freigegeben.`); } return changed;
}
async function advanceLeaguePhase(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey); const phase = event.leaguePhase; if (phase?.phaseType !== 'league' || phase.status === 'completed') return false;
  const current = Number(phase.currentMatchday || 0); if (!current) return maybeReleaseLeagueStart(client, eventKey, now);
  const day = phase.matchdays[current - 1]; if (!dayComplete(day)) return false;
  updateEventData(eventKey, stored => { const target = stored.leaguePhase.matchdays[current - 1]; target.status = 'completed'; target.completedAt = target.completedAt || now.toISOString(); return stored; });
  await deleteUserMessagesFromGroupChannel(client, phase);
  console.info(`[league-phase] ${eventKey}: Spieltag ${current} abgeschlossen.`);
  if (current < 4) return releaseLeagueMatchday(client, eventKey, current + 1, now);
  updateEventData(eventKey, stored => { stored.leaguePhase.status = 'completed'; stored.leaguePhase.completedAt = now.toISOString(); stored.leaguePhase.transitionStatus = 'ready'; return stored; });
  if (getLeagueMatches(readEventData(eventKey).leaguePhase).length !== 40) throw new Error('Ligaphase kann ohne exakt 40 Begegnungen nicht abgeschlossen werden.');
  console.info(`[league-phase] ${eventKey}: Top 8 ermittelt; Ãœbergang ins Viertelfinale gestartet.`);
  await createKnockoutPhase({ eventKey, actorUserId: 'auto-league-completed', client, now });
  if (client && phase.roleId) {
    const settings = readJson(FILES.settings, createSettingsDefault());
    const guild = await getConfiguredGuild(client, settings);
    const role = guild ? await guild.roles.fetch(phase.roleId).catch(() => null) : null;
    if (role) {
      for (const member of role.members.values()) await member.roles.remove(role.id, 'Ligaphase abgeschlossen').catch(() => null);
    }
    for (const channelId of [phase.overviewChannelId, phase.resultsChannelId]) {
      const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
      if (channel && ['ligaphase', 'ligaphase-ergebnisse'].includes(channel.name)) await channel.delete('Ligaphase abgeschlossen; K.O.-Phase gestartet').catch(() => null);
    }
    updateEventData(eventKey, stored => { stored.leaguePhase.overviewChannelId = null; stored.leaguePhase.resultsChannelId = null; stored.leaguePhase.transitionStatus = 'completed'; return stored; });
  }
  return true;
}
async function maybeReleaseLeagueStart(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey); if (event.leaguePhase?.phaseType !== 'league' || event.leaguePhase.currentMatchday) return false;
  const settings = readJson(FILES.settings, createSettingsDefault()); const target = event.schedule?.tournamentStartAt ? new Date(event.schedule.tournamentStartAt) : getTournamentStartAt(eventKey, event, settings, now); if (target && target.getTime() > now.getTime()) { scheduleLeaguePhase(client, eventKey, target); return false; }
  return releaseLeagueMatchday(client, eventKey, 1, now);
}
function scheduleLeaguePhase(client, eventKey, explicit = null) { const old = timers.get(eventKey); if (old) clearTimeout(old); const event = readEventData(eventKey); if (event.leaguePhase?.phaseType !== 'league' || event.leaguePhase.status === 'completed') return; const target = explicit || (event.schedule?.tournamentStartAt ? new Date(event.schedule.tournamentStartAt) : new Date()); const timer = setTimeout(() => maybeReleaseLeagueStart(client, eventKey).catch(console.error), Math.min(Math.max(0, target.getTime() - Date.now()), 2 ** 31 - 1)); if (timer.unref) timer.unref(); timers.set(eventKey, timer); }
module.exports = { advanceLeaguePhase, maybeReleaseLeagueStart, releaseLeagueMatchday, scheduleLeaguePhase };

