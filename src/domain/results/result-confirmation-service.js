'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { autoConfirmFirstReport: autoConfirmGroupResult } = require('../groups/group-results');
const { autoConfirmFirstReport: autoConfirmKnockoutResult } = require('../knockout/knockout-results');

const pendingTimers = new Map();

function timerKey({ eventKey, phase, phaseKey, matchId }) {
  return [eventKey, phase, phaseKey, matchId].map(String).join(':');
}

function participantKey(participant) {
  if (!participant) return null;
  if (participant.participantKey) return String(participant.participantKey);
  return participant.type === 'team' && participant.teamId ? `team:${participant.teamId}` : null;
}

function participantLabel(participant) {
  return participant?.displayName || findTeamById(participant?.teamId)?.clubName || 'Ein Team';
}

function teamContactIds(participant) {
  const team = participant?.teamId ? findTeamById(participant.teamId) : null;
  return [...new Set([
    team?.manager?.userId,
    ...(team?.coManagers || []).map(entry => entry?.userId),
  ].filter(Boolean).map(String))];
}

function getMatch(event, descriptor) {
  if (descriptor.phase === 'knockout') {
    return event.knockout?.rounds?.[descriptor.phaseKey]?.matches
      ?.find(match => String(match.id) === String(descriptor.matchId)) || null;
  }
  const group = String(descriptor.phaseKey).toLowerCase() === 'league'
    ? event.leaguePhase
    : event.groups?.groups?.[descriptor.phaseKey];
  return (group?.matchdays || []).flatMap(day => day.matches || [])
    .find(match => String(match.id) === String(descriptor.matchId)) || null;
}

function persistNotice(descriptor, values) {
  updateEventData(descriptor.eventKey, event => {
    const match = getMatch(event, descriptor);
    if (!match?.confirmation) return event;
    match.confirmation = { ...match.confirmation, ...values };
    return event;
  });
}

function cancelTimer(descriptor) {
  const key = timerKey(descriptor);
  const timer = pendingTimers.get(key);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(key);
}

async function fetchChannel(client, channelId) {
  if (!client || !channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function deleteOpponentReminder(client, notice, fallbackChannelId = null) {
  const messageId = notice?.notificationMessageId;
  const channelId = notice?.channelId || fallbackChannelId;
  if (!messageId || !channelId) return false;
  const channel = await fetchChannel(client, channelId);
  if (!channel?.messages?.fetch) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  return message.delete().then(() => true).catch(error => {
    if (error?.code !== 10008) console.warn(`[results] Bestätigungsaufforderung ${messageId} konnte nicht gelöscht werden: ${error.message}`);
    return false;
  });
}

async function sendOpponentReminder({ client, descriptor, match, channelId }) {
  if (match.confirmation?.notificationMessageId) return match.confirmation.notificationMessageId;
  const report = match.reports?.[0];
  if (!report) return null;
  const reporter = [match.home, match.away].find(entry => participantKey(entry) === String(report.participantKey));
  const opponent = [match.home, match.away].find(entry => participantKey(entry) !== String(report.participantKey));
  const userIds = teamContactIds(opponent);
  const mentions = userIds.map(id => `<@${id}>`).join(' ');
  const channel = await fetchChannel(client, channelId);
  if (!channel?.send) return null;

  const message = await channel.send({
    content: [
      mentions,
      `**${participantLabel(reporter)}** hat **${report.homeGoals}:${report.awayGoals}** `
        + `(**${participantLabel(match.home)} : ${participantLabel(match.away)}**) eingetragen. `
        + 'Bitte tragt euer Ergebnis innerhalb von 2 Minuten ein. Ohne Gegenmeldung wird das Spiel so gewertet, wie der Gegner es angegeben hat.',
    ].filter(Boolean).join('\n'),
    allowedMentions: { users: userIds },
  }).catch(() => null);
  if (!message?.id) return null;
  persistNotice(descriptor, { notificationMessageId: message.id, channelId });
  return message.id;
}

async function finalizeAutomaticResult(client, descriptor, channelId) {
  const pendingMatch = getMatch(readEventData(descriptor.eventKey), descriptor);
  const notice = pendingMatch?.confirmation || null;
  const outcome = descriptor.phase === 'knockout'
    ? autoConfirmKnockoutResult({ eventKey: descriptor.eventKey, roundKey: descriptor.phaseKey, matchId: descriptor.matchId })
    : autoConfirmGroupResult({ eventKey: descriptor.eventKey, groupKey: descriptor.phaseKey, matchId: descriptor.matchId });
  if (!outcome) return false;

  await deleteOpponentReminder(client, notice, channelId);

  const channel = await fetchChannel(client, channelId);
  await channel?.send?.({
    content: `⏱️ Keine Gegenmeldung: **${outcome.match.result.homeGoals}:${outcome.match.result.awayGoals}** wurde automatisch übernommen.`,
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (descriptor.phase === 'knockout') {
    const { finalizeConfirmedKnockoutResult } = require('../knockout/knockout-interactions');
    await finalizeConfirmedKnockoutResult(client, descriptor.eventKey, outcome);
  } else {
    const { finalizeConfirmedGroupResult } = require('../groups/group-interactions');
    await finalizeConfirmedGroupResult(client, descriptor.eventKey, descriptor.phaseKey, outcome);
  }
  return true;
}

function scheduleTimer(client, descriptor, match, channelId) {
  cancelTimer(descriptor);
  const expiresAt = new Date(match.confirmation?.expiresAt || 0);
  if (Number.isNaN(expiresAt.getTime())) return null;
  const delay = Math.max(0, expiresAt.getTime() - Date.now());
  const timer = setTimeout(() => {
    pendingTimers.delete(timerKey(descriptor));
    finalizeAutomaticResult(client, descriptor, channelId).catch(error => {
      console.error(`[results] Automatische Ergebnisübernahme fehlgeschlagen (${timerKey(descriptor)}):`, error);
    });
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  pendingTimers.set(timerKey(descriptor), timer);
  return timer;
}

async function handleResultOutcome({ client, eventKey, phase, phaseKey, outcome, channelId }) {
  const descriptor = { eventKey, phase, phaseKey, matchId: outcome.match.id };
  if (outcome.status !== 'pending_confirmation' || outcome.match.reports?.length !== 1) {
    cancelTimer(descriptor);
    await deleteOpponentReminder(client, outcome.confirmationNotice, channelId);
    return false;
  }
  const targetChannelId = channelId || outcome.match.confirmation?.channelId;
  await sendOpponentReminder({ client, descriptor, match: outcome.match, channelId: targetChannelId });
  const currentMatch = getMatch(readEventData(eventKey), descriptor) || outcome.match;
  scheduleTimer(client, descriptor, currentMatch, targetChannelId);
  return true;
}

function pendingDescriptors(eventKey, event) {
  const entries = [];
  const addMatches = (phase, phaseKey, matches, channelId) => {
    for (const match of matches || []) {
      if (match.status !== 'pending_confirmation' || match.reports?.length !== 1 || !match.confirmation?.expiresAt) continue;
      entries.push({ descriptor: { eventKey, phase, phaseKey, matchId: match.id }, match, channelId: match.confirmation.channelId || channelId });
    }
  };
  for (const group of Object.values(event.groups?.groups || {})) {
    addMatches('group', group.groupKey, (group.matchdays || []).flatMap(day => day.matches || []), group.resultsChannelId || group.channelId);
  }
  if (event.leaguePhase?.phaseType === 'league') {
    addMatches('group', 'league', (event.leaguePhase.matchdays || []).flatMap(day => day.matches || []), event.leaguePhase.resultsChannelId);
  }
  for (const [roundKey, round] of Object.entries(event.knockout?.rounds || {})) {
    addMatches('knockout', roundKey, round.matches || [], round.resultsChannelId || round.channelId);
  }
  return entries;
}

function initPendingResultConfirmations(client) {
  let scheduled = 0;
  for (const eventKey of EVENT_KEYS) {
    for (const entry of pendingDescriptors(eventKey, readEventData(eventKey))) {
      scheduleTimer(client, entry.descriptor, entry.match, entry.channelId);
      scheduled += 1;
    }
  }
  console.log(`[results] ${scheduled} offene Zwei-Minuten-Bestätigungen wiederhergestellt.`);
  return scheduled;
}

module.exports = {
  deleteOpponentReminder,
  handleResultOutcome,
  initPendingResultConfirmations,
  pendingDescriptors,
};
