'use strict';

const { LEAGUE_PHASE_FORMATS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { getTournamentStartAt } = require('../checkins/checkin-schedule');
const { readEventData, updateEventData } = require('../events/event-repository');
const {
  deleteTransientMessagesFromGroupChannel,
  deleteTransientMessagesFromLeagueOverview,
  deleteUserMessagesFromGroupChannel,
} = require('../groups/group-message-cleanup');
const { recalculateGroupStandings } = require('../groups/group-results');
const { getConfiguredGuild } = require('../groups/group-roles');
const { createKnockoutPhase } = require('../knockout/knockout-service');
const { scheduleRatingCapture } = require('../team-of-the-tournament/team-of-the-tournament-service');
const { ensureLeagueCalculationChannel, refreshLeaguePhasePosts } = require('./league-phase-service');
const { postQualificationAudit } = require('./league-phase-qualification-audit');
const { getLeagueMatches } = require('./league-phase-results');

const MATCHDAY_DURATION_MS = 25 * 60 * 1000;
const INVITE_WINDOW_MINUTES = 5;
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

function formatHm(date) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
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
  const releasedAt = new Date(phase.matchdays?.[dayNumber - 1]?.releasedAt || Date.now());
  const inviteUntil = new Date(releasedAt.getTime() + INVITE_WINDOW_MINUTES * 60 * 1000);
  const releaseContent = [
    `ÐY"œ **Ligaphase ƒ?" Spieltag ${dayNumber} ist freigegeben.**`,
    `ÐY' **${formatHm(releasedAt)}ƒ?"${formatHm(inviteUntil)} Uhr: Zeit zum Einladen.**`,
    `Alle ${phaseConfig(phase).matchesPerDay} Begegnungen dieses Spieltags kÇônnen jetzt gemeldet werden.`,
    'Nach 25 Minuten werden noch offene Spiele automatisch ausgewertet.',
  ].join('\n');
  const safeReleaseContent = [
    `\u{1F4E3} **Ligaphase \u2013 Spieltag ${dayNumber} ist freigegeben.**`,
    `\u{1F552} **${formatHm(releasedAt)}\u2013${formatHm(inviteUntil)} Uhr: Zeit zum Einladen.**`,
    'Bitte tragt beide das Ergebnis unverz\u00FCglich nach dem Spiel ein.',
    'Nach 25 Minuten werden noch offene Spiele automatisch ausgewertet.',
  ].join('\n');
  const message = await channel.send({
    content: `ÐY"œ **Ligaphase ƒ?" Spieltag ${dayNumber} ist freigegeben.**\nAlle ${phaseConfig(phase).matchesPerDay} Begegnungen dieses Spieltags kÇônnen jetzt gemeldet werden.`,
    content: safeReleaseContent,
    allowedMentions: { parse: [] },
  });
  updateEventData(eventKey, stored => {
    stored.leaguePhase.messages.releaseMessageId = message.id;
    return stored;
  });
  return message;
}

async function cleanupLeagueReleaseChannels(client, phase) {
  await Promise.all([
    deleteTransientMessagesFromGroupChannel(client, phase),
    deleteTransientMessagesFromLeagueOverview(client, phase),
  ]);
}

async function releaseLeagueMatchday(client, eventKey, dayNumber, now = new Date()) {
  let changed = false;
  updateEventData(eventKey, event => {
    const phase = event.leaguePhase;
    const day = phase?.matchdays?.[dayNumber - 1];
    const current = Number(phase?.currentMatchday || 0);
    const hasBlockedRealMatch = (day?.matches || []).some(match =>
      match.home?.type === 'team' && match.away?.type === 'team'
      && !['open', 'pending_confirmation', 'confirmed'].includes(match.status));
    const canRecoverCurrent = current === Number(dayNumber)
      && day?.status === 'open' && hasBlockedRealMatch;
    if (!day || (day.status !== 'locked' && !canRecoverCurrent)) return event;
    const timestamp = now.toISOString();
    day.status = 'open';
    day.releasedAt = day.releasedAt || timestamp;
    const existingDeadline = day.autoScoreAt ? new Date(day.autoScoreAt) : null;
    day.autoScoreAt = existingDeadline && !Number.isNaN(existingDeadline.getTime()) && existingDeadline.getTime() > now.getTime()
      ? existingDeadline.toISOString()
      : new Date(now.getTime() + MATCHDAY_DURATION_MS).toISOString();
    day.autoScoredAt = null;
    phase.currentMatchday = dayNumber;
    for (const match of day.matches) {
      if (match.status !== 'confirmed' && match.status !== 'pending_confirmation') {
        match.status = match.home?.type === 'team' && match.away?.type === 'team' ? 'open' : 'bye';
      }
      match.release = { slot: dayNumber, releasedAt: day.releasedAt };
    }
    changed = true;
    return event;
  });

  if (changed) {
    await cleanupLeagueReleaseChannels(client, readEventData(eventKey).leaguePhase);
    await postRelease(client, eventKey, dayNumber);
    await refreshLeaguePhasePosts(client, eventKey);
    console.info(`[league-phase] ${eventKey}: Spieltag ${dayNumber} freigegeben.`);
    scheduleLeaguePhase(client, eventKey);
  }
  return changed;
}

async function reconcileLeagueMatchday(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  const phase = event.leaguePhase;
  if (phase?.phaseType !== 'league' || phase.status === 'completed') return false;
  const currentMatchday = Number(phase.currentMatchday || 0);
  if (!currentMatchday) return maybeReleaseLeagueStart(client, eventKey, now);
  const dayNumber = currentMatchday;
  const day = phase.matchdays?.[dayNumber - 1];
  if (!day || dayComplete(day, phase)) return false;
  const needsRelease = day.status === 'locked' || (day.matches || []).some(match =>
    match.home?.type === 'team' && match.away?.type === 'team'
    && !['open', 'pending_confirmation', 'confirmed'].includes(match.status));
  if (!needsRelease) {
    if (day.status !== 'open') return false;
    await cleanupLeagueReleaseChannels(client, phase);
    await postRelease(client, eventKey, dayNumber);
    await refreshLeaguePhasePosts(client, eventKey);
    scheduleLeaguePhase(client, eventKey);
    return true;
  }
  return releaseLeagueMatchday(client, eventKey, dayNumber, now);
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
    recalculateGroupStandings(stored.leaguePhase);
    stored.leaguePhase.status = 'completed';
    stored.leaguePhase.completedAt = now.toISOString();
    stored.leaguePhase.transitionStatus = 'ready';
    return stored;
  });
  if (getLeagueMatches(readEventData(eventKey).leaguePhase).length !== phaseConfig(phase).totalMatches) {
    throw new Error(`Ligaphase kann ohne exakt ${phaseConfig(phase).totalMatches} Begegnungen nicht abgeschlossen werden.`);
  }
  console.info(`[league-phase] ${eventKey}: Top 8 ermittelt; Çobergang ins Viertelfinale gestartet.`);
  try {
    const settings = readJson(FILES.settings, createSettingsDefault());
    const guild = await getConfiguredGuild(client, settings);
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    await postQualificationAudit({
      client,
      eventKey,
      ensureChannel: event => ensureLeagueCalculationChannel(guild, settings, event.leaguePhase?.calculationChannelId),
    });
  } catch (error) {
    console.warn(`[league-phase] Interne Weiterkommen-Berechnung fuer ${eventKey} fehlgeschlagen; Turnierablauf laeuft weiter: ${error.message}`);
  }
  await createKnockoutPhase({ eventKey, actorUserId: 'auto-league-completed', client, now });
  updateEventData(eventKey, stored => {
    stored.leaguePhase.transitionStatus = 'completed';
    return stored;
  });
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
      const report = reports[0] || match.firstReportedResult || null;
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
    if (day.autoScoredAt && !day.autoScoreAt) return;
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
  INVITE_WINDOW_MINUTES,
  advanceLeaguePhase,
  applyLeagueMatchdayDeadline,
  maybeReleaseLeagueStart,
  reconcileLeagueMatchday,
  releaseLeagueMatchday,
  scheduleLeaguePhase,
};

