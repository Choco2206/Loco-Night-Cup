'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { drawGroupsForEvent, lockEventFormat } = require('../events/event-lock-service');
const { recalculateCheckinFormat } = require('./checkin-format');
const { readEventData, updateEventData } = require('./checkin-repository');
const { refreshCheckinMessage } = require('./checkin-panel');
const {
  getDeadlineAt,
  getDrawAt,
  getLateWindowUntil,
} = require('./checkin-schedule');

const RECONCILE_INTERVAL_MS = 60 * 1000;
const RECONCILE_SKIP_STATUSES = new Set(['groups', 'knockout', 'ceremony', 'completed', 'reset']);

let reconcileTimer = null;
let activeClient = null;
let isRunning = false;

function nowIso(now = new Date()) {
  return now.toISOString();
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function formatTime(date) {
  if (!date) return 'nicht gesetzt';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function minimumTeams(settings, event) {
  return Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
}

function currentFormatLabel(event) {
  return event.format?.size ? `${event.format.size}er Turnier` : 'noch kein gueltiges Format';
}

function buildDeadlineMessage(eventKey, event, settings, now = new Date()) {
  const lateDeadlineText = formatTime(getLateWindowUntil(eventKey, event, settings, now));
  const drawText = formatTime(getDrawAt(eventKey, event, settings, now));
  const minimum = minimumTeams(settings, event);

  if (!event.format?.size) {
    return [
      '⚠️ **Aktueller Stand nach offiziellem Anmeldeschluss**',
      '',
      'Aktuell sind noch nicht genug Teams fuer den NightCup angemeldet.',
      `Minimum sind ${minimum} Teams.`,
      '',
      `Teams koennen sich noch bis ${lateDeadlineText} anmelden oder abmelden.`,
      `Um ${lateDeadlineText} wird final geprueft, ob ein gueltiges Format zustande kommt.`,
    ].join('\n');
  }

  return [
    '✅ **Aktueller Stand nach offiziellem Anmeldeschluss**',
    '',
    `Aktuelles Format: ${currentFormatLabel(event)}`,
    '',
    `Teams koennen sich noch bis ${lateDeadlineText} anmelden oder abmelden.`,
    `Um ${lateDeadlineText} wird final geprueft, welches Format zustande kommt.`,
    '',
    `🎲 Die Gruppenauslosung findet um ${drawText} statt.`,
  ].join('\n');
}

function buildFinalCancelledMessage(event, settings) {
  return [
    '❌ **NightCup findet nicht statt**',
    '',
    'Es wurden nicht genug Teams registriert.',
    `Minimum sind ${minimumTeams(settings, event)} Teams.`,
  ].join('\n');
}

function buildFinalReadyMessage(eventKey, event, settings, now = new Date()) {
  return [
    '✅ **NightCup findet statt**',
    '',
    `Format: ${currentFormatLabel(event)}`,
    `Gruppenauslosung findet um ${formatTime(getDrawAt(eventKey, event, settings, now))} statt.`,
    'Manager und Co-VMs werden automatisch in der jeweiligen Gruppe markiert.',
  ].join('\n');
}

function isBefore(date, now) {
  return date && now.getTime() < date.getTime();
}

function isReached(date, now) {
  return date && now.getTime() >= date.getTime();
}

async function getCheckinChannel(client, eventKey, settings) {
  const channelId = settings.channels?.checkinChannelIds?.[eventKey];
  if (!client || !channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.send ? channel : null;
}

async function fetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function upsertStatusMessage(client, eventKey, content) {
  const settings = readSettings();
  const channel = await getCheckinChannel(client, eventKey, settings);
  if (!channel) {
    console.warn(`[checkin-reconcile] ${eventKey}: check-in channel missing for status message`);
    return null;
  }

  const messages = readJson(FILES.messages, createMessagesDefault());
  const state = messages.checkins?.[eventKey] || {};
  const staleChannel = state.channelId && String(state.channelId) !== String(channel.id);
  let message = staleChannel ? null : await fetchMessage(channel, state.summaryMessageId);
  const payload = { content, allowedMentions: { parse: [] } };

  if (message) message = await message.edit(payload);
  else message = await channel.send(payload);

  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.checkins = current.checkins || {};
    current.checkins[eventKey] = current.checkins[eventKey] || {};
    current.checkins[eventKey].channelId = channel.id;
    current.checkins[eventKey].summaryMessageId = message.id;
    current.checkins[eventKey].updatedAt = nowIso();
    if (!current.checkins[eventKey].createdAt) current.checkins[eventKey].createdAt = nowIso();
    return current;
  });

  return message;
}

function markDeadlineReached(eventKey, settings, now) {
  let changed = false;
  let eventAfter = null;

  updateEventData(eventKey, event => {
    if (event.format?.lockedAt || RECONCILE_SKIP_STATUSES.has(event.status)) {
      eventAfter = event;
      return event;
    }

    recalculateCheckinFormat(event, settings, now);
    if (event.status !== 'deadline_reached') {
      event.status = 'deadline_reached';
      event.checkin = {
        ...(event.checkin || {}),
        isOpen: true,
        deadlineReachedAt: event.checkin?.deadlineReachedAt || nowIso(now),
      };
      event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
      changed = true;
    }
    eventAfter = event;
    return event;
  });

  return { changed, event: eventAfter || readEventData(eventKey) };
}

function cancelEventAfterLate(eventKey, settings, now) {
  let eventAfter = null;
  updateEventData(eventKey, event => {
    recalculateCheckinFormat(event, settings, now);
    event.status = 'cancelled';
    event.checkin = {
      ...(event.checkin || {}),
      isOpen: false,
      closedAt: event.checkin?.closedAt || nowIso(now),
      finalizedAt: event.checkin?.finalizedAt || nowIso(now),
      finalizationStatus: 'cancelled_not_enough_teams',
    };
    event.format = {
      ...(event.format || {}),
      lockedAt: null,
      lockedByUserId: null,
      participants: [],
    };
    event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
    eventAfter = event;
    return event;
  });
  return eventAfter || readEventData(eventKey);
}

function markDrawReady(eventKey, now) {
  let eventAfter = null;
  updateEventData(eventKey, event => {
    event.status = 'draw_ready';
    event.checkin = {
      ...(event.checkin || {}),
      isOpen: false,
      closedAt: event.checkin?.closedAt || nowIso(now),
      finalizedAt: event.checkin?.finalizedAt || nowIso(now),
      finalizationStatus: 'draw_ready',
    };
    event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
    eventAfter = event;
    return event;
  });
  return eventAfter || readEventData(eventKey);
}

function finalizeAfterLate(eventKey, settings, now) {
  const current = readEventData(eventKey);
  if (current.status === 'cancelled' || current.status === 'draw_ready' || current.format?.lockedAt) {
    return { changed: false, event: current, finalState: current.status };
  }

  updateEventData(eventKey, event => recalculateCheckinFormat(event, settings, now));
  const recalculated = readEventData(eventKey);
  if (!recalculated.format?.size) {
    const cancelled = cancelEventAfterLate(eventKey, settings, now);
    return { changed: true, event: cancelled, finalState: 'cancelled' };
  }

  try {
    lockEventFormat(eventKey, 'auto-checkin-finalizer', now);
  } catch (error) {
    console.warn(`[checkin-reconcile] ${eventKey}: final format lock failed: ${error.message}`);
    const cancelled = cancelEventAfterLate(eventKey, settings, now);
    return { changed: true, event: cancelled, finalState: 'cancelled' };
  }

  const ready = markDrawReady(eventKey, now);
  return { changed: true, event: ready, finalState: 'draw_ready' };
}

async function maybeDrawGroups({ client, eventKey, event, drawAt, now }) {
  if (!isReached(drawAt, now)) return { changed: false, event };
  if (event.status !== 'draw_ready') return { changed: false, event };
  if (!event.format?.lockedAt || event.groups?.status !== 'not_created') return { changed: false, event };

  try {
    const result = await drawGroupsForEvent({
      eventKey,
      actorUserId: 'auto-checkin-reconcile',
      client,
      now,
    });
    return { changed: true, event: result.event };
  } catch (error) {
    console.warn(`[checkin-reconcile] ${eventKey}: auto draw failed: ${error.message}`);
    return { changed: false, event };
  }
}

async function reconcileCheckinEvent(eventKey, client = activeClient, now = new Date()) {
  const settings = readSettings();
  const event = readEventData(eventKey);
  if (RECONCILE_SKIP_STATUSES.has(event.status) || event.status === 'cancelled') return { changed: false, event };

  const deadlineAt = getDeadlineAt(eventKey, event, settings, now);
  const lateWindowUntil = getLateWindowUntil(eventKey, event, settings, now);
  const drawAt = getDrawAt(eventKey, event, settings, now);

  if (isBefore(deadlineAt, now)) return { changed: false, event };

  let latest = event;
  let changed = false;

  if (isReached(deadlineAt, now) && isBefore(lateWindowUntil, now)) {
    const deadline = markDeadlineReached(eventKey, settings, now);
    latest = deadline.event;
    changed = changed || deadline.changed;
    if (deadline.changed) {
      await upsertStatusMessage(client, eventKey, buildDeadlineMessage(eventKey, latest, settings, now));
    }
  }

  if (isReached(lateWindowUntil, now)) {
    const final = finalizeAfterLate(eventKey, settings, now);
    latest = final.event;
    changed = changed || final.changed;
    if (final.changed) {
      const message = final.finalState === 'cancelled'
        ? buildFinalCancelledMessage(latest, settings)
        : buildFinalReadyMessage(eventKey, latest, settings, now);
      await upsertStatusMessage(client, eventKey, message);
    }
  }

  const draw = await maybeDrawGroups({ client, eventKey, event: latest, drawAt, now });
  latest = draw.event;
  changed = changed || draw.changed;

  if (changed) await refreshCheckinMessage(eventKey, client).catch(error => {
    console.warn(`[checkin-reconcile] ${eventKey}: check-in refresh failed: ${error.message}`);
  });

  return { changed, event: latest };
}

async function reconcileAllCheckins(client = activeClient, now = new Date()) {
  if (isRunning) return { skipped: true };
  isRunning = true;
  const results = [];
  try {
    for (const eventKey of EVENT_KEYS) {
      const result = await reconcileCheckinEvent(eventKey, client, now).catch(error => {
        console.warn(`[checkin-reconcile] ${eventKey}: failed: ${error.message}`);
        return { changed: false, error };
      });
      results.push({ eventKey, ...result });
    }
    return { skipped: false, results };
  } finally {
    isRunning = false;
  }
}

function startCheckinReconcile(client) {
  activeClient = client;
  if (reconcileTimer) clearInterval(reconcileTimer);

  reconcileAllCheckins(client).catch(error => {
    console.warn(`[checkin-reconcile] startup reconcile failed: ${error.message}`);
  });

  reconcileTimer = setInterval(() => {
    reconcileAllCheckins(client).catch(error => {
      console.warn(`[checkin-reconcile] interval reconcile failed: ${error.message}`);
    });
  }, RECONCILE_INTERVAL_MS);

  if (typeof reconcileTimer.unref === 'function') reconcileTimer.unref();
  console.log(`[checkin-reconcile] started interval every ${RECONCILE_INTERVAL_MS / 1000}s`);
  return reconcileTimer;
}

function stopCheckinReconcile() {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
}

module.exports = {
  RECONCILE_INTERVAL_MS,
  reconcileAllCheckins,
  reconcileCheckinEvent,
  startCheckinReconcile,
  stopCheckinReconcile,
};
