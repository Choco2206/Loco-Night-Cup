'use strict';

const { LEAGUE_PHASE_FORMATS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { getTournamentStartAt } = require('../checkins/checkin-schedule');
const { readEventData, updateEventData } = require('../events/event-repository');
const { getConfiguredGuild } = require('../groups/group-roles');
const { deleteUserMessagesFromGroupChannel } = require('../groups/group-message-cleanup');
const { recalculateGroupStandings } = require('../groups/group-results');
const { createKnockoutPhase } = require('../knockout/knockout-service');
const { scheduleRatingCapture } = require('../team-of-the-tournament/team-of-the-tournament-service');
const { refreshLeaguePhasePosts } = require('./league-phase-service');
const { getLeagueMatches } = require('./league-phase-results');

const MATCHDAY_DURATION_MS = 25 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const timers = new Map();

function phaseConfig(phase) {
  return LEAGUE_PHASE_FORMATS[Number(phase?.formatSize || phase?.slots?.length)];
}

function dayComplete(day, phase) {
  const config = phaseConfig(phase);
  return Boolean(config)
    && (day?.matches || []).length === config.matchesPerDay
    && day.matches.every(match => match.status === 'confirmed');
}

async function postRelease(client, eventKey, dayNumber) {
  const event = readEventData(eventKey);
  const phase = event.leaguePhase;
  const channel = client && phase?.overviewChannelId
    ? await client.channels.fetch(phase.overviewChannelId).catch(() => null)
    : null;
  if (!channel) return null;

  const oldId = phase.messages?.releaseMessageId;
  const old = oldId ? await channel.messages.fetch(oldId).catch(() => null) : null;
  if (old) await old.delete().catch(() => null);
  const message = await channel.send({
    content: `📣 **Ligaphase – Spieltag ${dayNumber} ist freigegeben.**\nAlle ${phaseConfig(phase).matchesPerDay} Begegnungen dieses Spieltags können jetzt gemeldet werden.`,
    allowedMentions: { parse: [] },
  });
  updateEventData(eventKey, stored => {
    stored.leaguePhase.messages.releaseMessageId = message.id;
    return stored;
  });
  return message;
}

async function releaseLeagueMatchday(client, eventKey, dayNumber, now = new Date()) {
  let changed = false;
  updateEventData(eventKey, event => {
    const phase = event.leaguePhase;
    const day = phase?.matchdays?.[dayNumber - 1];
    if (!day || day.status !== 'locked') return event;
    const timestamp = now.toISOString();
    day.status = 'open';
    day.releasedAt = timestamp;
    day.autoScoreAt = new Date(now.getTime() + MATCHDAY_DURATION_MS).toISOString();
    day.autoScoredAt = null;
    phase.currentMatchday = dayNumber;
    for (const match of day.matches) {
      match.status = match.home?.type === 'team' && match.away?.type === 'team' ? 'open' : 'bye';
      match.release = { slot: dayNumber, releasedAt: timestamp };
    }
    changed = true;
    return event;
  });

  if (changed) {
    await postRelease(client, eventKey, dayNumber);
    await refreshLeaguePhasePosts(client, eventKey);
    console.info(`[league-phase] ${eventKey}: Spieltag ${dayNumber} freigegeben.`);
    scheduleLeaguePhase(client, eventKey);
  }
  return changed;
}

async function advanceLeaguePhase(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  const phase = event.leaguePhase;
  if (phase?.phaseType !== 'league' || phase.status === 'completed') return false;
  const current = Number(phase.currentMatchday || 0);
  if (!current) return maybeReleaseLeagueStart(client, eventKey, now);
  const day = phase.matchdays[current - 1];
  if (!dayComplete(day, phase)) return false;

  updateEventData(eventKey, stored => {
    const target = stored.leaguePhase.matchdays[current - 1];
    target.status = 'completed';
    target.completedAt = target.completedAt || now.toISOString();
    target.autoScoreAt = null;
    return stored;
  });
  await deleteUserMessagesFromGroupChannel(client, phase);
  console.info(`[league-phase] ${eventKey}: Spieltag ${current} abgeschlossen.`);
  if (current < phaseConfig(phase).matchdays) return releaseLeagueMatchday(client, eventKey, current + 1, now);

  updateEventData(eventKey, stored => {
    stored.leaguePhase.status = 'completed';
    stored.leaguePhase.completedAt = now.toISOString();
    stored.leaguePhase.transitionStatus = 'ready';
    return stored;
  });
  if (getLeagueMatches(readEventData(eventKey).leaguePhase).length !== phaseConfig(phase).totalMatches) {
    throw new Error(`Ligaphase kann ohne exakt ${phaseConfig(phase).totalMatches} Begegnungen nicht abgeschlossen werden.`);
  }
  console.info(`[league-phase] ${eventKey}: Top 8 ermittelt; Übergang ins Viertelfinale gestartet.`);
  await createKnockoutPhase({ eventKey, actorUserId: 'auto-league-completed', client, now });
  if (client && phase.roleId) {
    const settings = readJson(FILES.settings, createSettingsDefault());
    const guild = await getConfiguredGuild(client, settings);
    const role = guild ? await guild.roles.fetch(phase.roleId).catch(() => null) : null;
    if (role) {
      for (const member of role.members.values()) {
        await member.roles.remove(role.id, 'Ligaphase abgeschlossen').catch(() => null);
      }
    }
    for (const channelId of [phase.overviewChannelId, phase.resultsChannelId]) {
      const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
      if (channel && ['ligaphase', 'ligaphase-ergebnisse'].includes(channel.name)) {
        await channel.delete('Ligaphase abgeschlossen; K.O.-Phase gestartet').catch(() => null);
      }
    }
    updateEventData(eventKey, stored => {
      stored.leaguePhase.overviewChannelId = null;
      stored.leaguePhase.resultsChannelId = null;
      stored.leaguePhase.transitionStatus = 'completed';
      return stored;
    });
  }
  return true;
}

async function applyLeagueMatchdayDeadline(client, eventKey, dayNumber, now = new Date()) {
  const autoConfirmedMatches = [];
  updateEventData(eventKey, event => {
    const phase = event.leaguePhase;
    const day = phase?.matchdays?.[dayNumber - 1];
    if (!day || day.status !== 'open') return event;
    for (const match of day.matches || []) {
      if (match.status === 'confirmed' || match.home?.type !== 'team' || match.away?.type !== 'team') continue;
      const reports = [...new Map((match.reports || []).map(report => [String(report.participantKey), report])).values()];
      if (reports.length > 1) continue;
      const report = reports[0] || null;
      match.status = 'confirmed';
      match.result = {
        homeGoals: report ? Number(report.homeGoals) : 0,
        awayGoals: report ? Number(report.awayGoals) : 0,
        confirmedAt: now.toISOString(),
        source: report ? 'matchday_timeout_report' : 'matchday_timeout_0_0',
        submittedByUserId: report?.submittedByUserId || null,
      };
      match.confirmation = null;
      match.meta = { ...(match.meta || {}), updatedAt: now.toISOString() };
      autoConfirmedMatches.push(match);
    }
    day.autoScoreAt = null;
    day.autoScoredAt = now.toISOString();
    recalculateGroupStandings(phase);
    event.meta = { ...(event.meta || {}), updatedAt: now.toISOString() };
    return event;
  });
  if (client) {
    for (const match of autoConfirmedMatches) scheduleRatingCapture(eventKey, match);
  }
  await refreshLeaguePhasePosts(client, eventKey);
  const advanced = await advanceLeaguePhase(client, eventKey, now);
  if (!advanced) scheduleLeaguePhase(client, eventKey);
  return advanced;
}

async function maybeReleaseLeagueStart(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  if (event.leaguePhase?.phaseType !== 'league' || event.leaguePhase.currentMatchday) return false;
  const settings = readJson(FILES.settings, createSettingsDefault());
  const target = event.schedule?.tournamentStartAt
    ? new Date(event.schedule.tournamentStartAt)
    : getTournamentStartAt(eventKey, event, settings, now);
  if (target && target.getTime() > now.getTime()) {
    scheduleLeaguePhase(client, eventKey, target);
    return false;
  }
  return releaseLeagueMatchday(client, eventKey, 1, now);
}

function scheduleLeaguePhase(client, eventKey, explicit = null) {
  const old = timers.get(eventKey);
  if (old) clearTimeout(old);
  const event = readEventData(eventKey);
  const phase = event.leaguePhase;
  if (phase?.phaseType !== 'league' || phase.status === 'completed') return;

  const current = Number(phase.currentMatchday || 0);
  const day = current ? phase.matchdays?.[current - 1] : null;
  let target = explicit;
  let callback = () => maybeReleaseLeagueStart(client, eventKey).catch(console.error);
  if (day?.status === 'open' && !dayComplete(day, phase)) {
    target = day.autoScoreAt
      ? new Date(day.autoScoreAt)
      : new Date(new Date(day.releasedAt).getTime() + MATCHDAY_DURATION_MS);
    callback = () => applyLeagueMatchdayDeadline(client, eventKey, current).catch(console.error);
  } else if (!target) {
    target = event.schedule?.tournamentStartAt ? new Date(event.schedule.tournamentStartAt) : new Date();
  }

  const timer = setTimeout(callback, Math.min(Math.max(0, target.getTime() - Date.now()), MAX_TIMEOUT_MS));
  if (timer.unref) timer.unref();
  timers.set(eventKey, timer);
}

module.exports = {
  advanceLeaguePhase,
  applyLeagueMatchdayDeadline,
  maybeReleaseLeagueStart,
  releaseLeagueMatchday,
  scheduleLeaguePhase,
};
