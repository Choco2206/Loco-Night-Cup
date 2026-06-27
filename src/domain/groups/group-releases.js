'use strict';

const { EVENT_KEYS, EVENT_PROFILE_BY_KEY } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { getTournamentStartAt } = require('../checkins/checkin-schedule');
const { readEventData, updateEventData } = require('../events/event-repository');
const { createKnockoutPhase } = require('../knockout/knockout-service');
const { refreshGroupPosts } = require('./group-posts');
const {
  getMatches,
  getMatchSlot,
  isMatchReleased,
  isRealMatch,
} = require('./group-results');

const INVITE_WINDOW_MINUTES = 5;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const timers = new Map();

function nowIso(now = new Date()) {
  return now.toISOString();
}

function slotKey(slot) {
  return String(slot);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatHm(date) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function isWeekendNightEvent(eventKey) {
  return EVENT_PROFILE_BY_KEY[eventKey] === 'weekend_night';
}

function berlinOffsetForDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const offset = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT+1';
  const match = offset.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return '+01:00';
  const sign = match[1];
  const hours = String(match[2]).padStart(2, '0');
  const minutes = String(match[3] || '00').padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function getFirstSlotStart(eventKey, event, now = new Date(), { useExistingPlanned = true } = {}) {
  if (useExistingPlanned && event.groups?.releases?.slots?.[1]?.plannedAt) {
    const planned = new Date(event.groups.releases.slots[1].plannedAt);
    if (!Number.isNaN(planned.getTime())) return planned;
  }

  if (event.schedule?.tournamentStartAt) {
    const scheduled = new Date(event.schedule.tournamentStartAt);
    if (!Number.isNaN(scheduled.getTime())) return scheduled;
  }

  const settings = readJson(FILES.settings, createSettingsDefault());
  const scheduleStart = getTournamentStartAt(eventKey, event, settings, now);
  if (scheduleStart && !Number.isNaN(scheduleStart.getTime())) return scheduleStart;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const datePart = formatter.format(now);
  const timePart = isWeekendNightEvent(eventKey) ? '00:00:00' : '22:30:00';
  const offset = berlinOffsetForDate(new Date(`${datePart}T12:00:00Z`));
  return new Date(`${datePart}T${timePart}${offset}`);
}

function createEmptySlotRelease(slot, firstPlannedAt = null) {
  return {
    status: 'not_released',
    plannedAt: slot === 1 ? firstPlannedAt : null,
    releasedAt: null,
    inviteStartAt: null,
    inviteEndAt: null,
    releaseMessageIds: {},
    reminderAt: null,
    reminderSentAt: null,
    reminderMessageIds: {},
    autoScoreAt: null,
    autoScoredAt: null,
  };
}

function createInitialReleaseState(eventKey, event, now = new Date()) {
  const firstPlannedAt = getFirstSlotStart(eventKey, event, now, { useExistingPlanned: false }).toISOString();
  return {
    currentSlot: null,
    slots: {
      1: createEmptySlotRelease(1, firstPlannedAt),
      2: createEmptySlotRelease(2, firstPlannedAt),
      3: createEmptySlotRelease(3, firstPlannedAt),
    },
  };
}

function normalizeSlotRelease(slot, release, firstPlannedAt) {
  const base = createEmptySlotRelease(slot, firstPlannedAt);
  const normalized = {
    ...base,
    ...(release || {}),
  };

  const releasedDate = normalized.releasedAt ? new Date(normalized.releasedAt) : null;
  if (!normalized.releasedAt || Number.isNaN(releasedDate.getTime())) {
    return {
      ...base,
      plannedAt: slot === 1 ? normalized.plannedAt || firstPlannedAt : null,
      releaseMessageIds: {},
      reminderMessageIds: {},
      cleanedAt: normalized.cleanedAt || null,
    };
  }

  normalized.status = normalized.status && normalized.status !== 'not_released'
    ? normalized.status
    : 'released';
  normalized.releaseMessageIds = normalized.releaseMessageIds || {};
  normalized.reminderMessageIds = normalized.reminderMessageIds || {};
  normalized.reminderAt = null;
  normalized.autoScoreAt = null;
  return normalized;
}

function ensureReleaseState(eventKey, event, now = new Date()) {
  event.groups = event.groups || {};
  const previous = event.groups.releases || {};
  const slots = previous.slots || {};
  const firstPlannedAt = getFirstSlotStart(eventKey, event, now).toISOString();

  for (const slot of [1, 2, 3]) {
    const key = slotKey(slot);
    slots[key] = normalizeSlotRelease(slot, slots[key], firstPlannedAt);
  }

  event.groups.releases = {
    currentSlot: previous.currentSlot || null,
    slots,
  };

  return event.groups.releases;
}

function getSlotMatches(event, slot) {
  return Object.values(event.groups?.groups || {})
    .flatMap(group => getMatches(group)
      .filter(match => isRealMatch(match) && getMatchSlot(match) === Number(slot))
      .map(match => ({ group, match })));
}

function isSlotComplete(event, slot) {
  const slotMatches = getSlotMatches(event, slot);
  return slotMatches.every(entry => entry.match.status === 'confirmed');
}

function nextReleasableSlot(event) {
  const releases = event.groups?.releases;
  if (!releases) return null;

  for (const slot of [1, 2, 3]) {
    const release = releases.slots?.[slotKey(slot)];
    if (release?.releasedAt) continue;
    if (slot === 1) return 1;
    if (isSlotComplete(event, slot - 1)) return slot;
    return null;
  }

  return null;
}

function markSlotReleased(eventKey, event, slot, now = new Date()) {
  const releases = ensureReleaseState(eventKey, event, now);
  const release = releases.slots[slotKey(slot)];
  if (release.releasedAt) return false;

  const releasedAt = nowIso(now);
  release.status = 'released';
  release.releasedAt = releasedAt;
  release.inviteStartAt = releasedAt;
  release.inviteEndAt = nowIso(addMinutes(now, INVITE_WINDOW_MINUTES));
  release.reminderAt = null;
  release.autoScoreAt = null;
  release.reminderSentAt = null;
  release.autoScoredAt = null;
  releases.currentSlot = slot;

  for (const { match } of getSlotMatches(event, slot)) {
    match.status = match.status === 'not_released' ? 'open' : match.status;
    if (!['open', 'pending_confirmation', 'admin_decision_required', 'confirmed'].includes(match.status)) {
      match.status = 'open';
    }
    match.release = {
      ...(match.release || {}),
      slot,
      releasedAt,
    };
  }

  event.meta = { ...(event.meta || {}), updatedAt: releasedAt };
  return true;
}

async function sendToActiveGroupChannels(client, event, content, idBucketName, slot) {
  if (!client) return {};
  const messageIds = {};

  for (const group of Object.values(event.groups?.groups || {})) {
    if (!group.channelId) continue;
    const channel = await client.channels.fetch(group.channelId).catch(() => null);
    if (!channel) continue;
    const message = await channel.send({
      content,
      allowedMentions: { parse: [] },
    }).catch(error => {
      console.error(`Gruppe ${group.groupKey}: ${idBucketName} fuer Spieltag ${slot} konnte nicht gesendet werden.`, error);
      return null;
    });
    if (message?.id) messageIds[group.groupKey] = message.id;
  }

  return messageIds;
}

async function deleteMessageFromGroup(client, group, messageId, label) {
  if (!client || !group?.channelId || !messageId) return false;

  const channel = await client.channels.fetch(group.channelId).catch(error => {
    console.error(`Gruppe ${group.groupKey}: Kanal fuer ${label} konnte nicht geladen werden.`, error);
    return null;
  });
  if (!channel) return false;

  const message = await channel.messages.fetch(messageId).catch(error => {
    if (error?.code !== 10008) {
      console.error(`Gruppe ${group.groupKey}: ${label} konnte nicht geladen werden.`, error);
    }
    return null;
  });
  if (!message) return false;

  await message.delete().catch(error => {
    if (error?.code !== 10008) {
      console.error(`Gruppe ${group.groupKey}: ${label} konnte nicht geloescht werden.`, error);
    }
  });
  return true;
}

async function deleteStoredSlotPosts(client, eventKey, event, slot, now = new Date()) {
  const release = event.groups?.releases?.slots?.[slotKey(slot)];
  if (!release) return;

  const releaseIds = release.releaseMessageIds || {};
  const reminderIds = release.reminderMessageIds || {};
  if (!Object.keys(releaseIds).length && !Object.keys(reminderIds).length) return;

  const groups = event.groups?.groups || {};
  for (const [groupKey, messageId] of Object.entries(releaseIds)) {
    await deleteMessageFromGroup(client, groups[groupKey], messageId, `Freigabe-Post Spieltag ${slot}`);
  }
  for (const [groupKey, messageId] of Object.entries(reminderIds)) {
    await deleteMessageFromGroup(client, groups[groupKey], messageId, `alter Hinweis-Post Spieltag ${slot}`);
  }

  updateEventData(eventKey, current => {
    ensureReleaseState(eventKey, current, now);
    const currentRelease = current.groups.releases.slots[slotKey(slot)];
    currentRelease.releaseMessageIds = {};
    currentRelease.reminderMessageIds = {};
    currentRelease.cleanedAt = nowIso(now);
    return current;
  });
}

async function deletePreviousSlotPosts(client, eventKey, event, slot, now = new Date()) {
  const previousSlot = Number(slot) - 1;
  if (previousSlot < 1) return;
  await deleteStoredSlotPosts(client, eventKey, event, previousSlot, now);
}

async function postReleaseMessage(client, eventKey, event, slot) {
  const release = event.groups?.releases?.slots?.[slotKey(slot)];
  if (!release?.releasedAt || Object.keys(release.releaseMessageIds || {}).length) return;

  const content = [
    `\u2705 Spieltag ${slot} ist freigegeben`,
    '',
    `Einladezeit: ${formatHm(new Date(release.inviteStartAt))} - ${formatHm(new Date(release.inviteEndAt))} Uhr`,
    '',
    '\u26a0\ufe0f Beide Teams muessen das Ergebnis eintragen.',
    '',
    'Tragt eure Ergebnisse bitte direkt ein.',
    '',
    'Sobald alle Ergebnisse dieses Slots final bestaetigt sind, wird automatisch der naechste Slot freigegeben.',
  ].join('\n');

  const messageIds = await sendToActiveGroupChannels(client, event, content, 'Freigabe-Post', slot);
  updateEventData(eventKey, current => {
    ensureReleaseState(eventKey, current);
    const currentRelease = current.groups.releases.slots[slotKey(slot)];
    currentRelease.releaseMessageIds = {
      ...(currentRelease.releaseMessageIds || {}),
      ...messageIds,
    };
    return current;
  });
}

async function refreshAllGroups(client, eventKey, event) {
  if (!client) return;
  for (const group of Object.values(event.groups?.groups || {})) {
    await refreshGroupPosts({ client, eventKey, event, group }).catch(error => {
      console.error(`Gruppe ${group.groupKey}: Posts konnten nach Slot-Aktualisierung nicht aktualisiert werden.`, error);
    });
  }
}

async function applyAutoScores(client, eventKey, slot, now = new Date()) {
  updateEventData(eventKey, event => {
    ensureReleaseState(eventKey, event, now);
    const release = event.groups.releases.slots[slotKey(slot)];
    if (release?.releasedAt && isSlotComplete(event, slot)) {
      release.status = 'completed';
      release.completedAt = release.completedAt || nowIso(now);
    }
    release.autoScoreAt = null;
    release.autoScoredAt = null;
    event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
    return event;
  });

  await maybeReleaseNextSlot(client, eventKey, now);
  await maybeCreateKnockoutAfterGroupsComplete(client, eventKey, now);
  scheduleEvent(client, eventKey);
}

async function releaseSlot(client, eventKey, slot, now = new Date()) {
  let releasedEvent = null;
  let didRelease = false;

  updateEventData(eventKey, event => {
    ensureReleaseState(eventKey, event, now);
    didRelease = markSlotReleased(eventKey, event, slot, now);
    releasedEvent = event;
    return event;
  });

  if (didRelease && releasedEvent) {
    await deletePreviousSlotPosts(client, eventKey, releasedEvent, slot, now);
    await postReleaseMessage(client, eventKey, releasedEvent, slot);
    await refreshAllGroups(client, eventKey, releasedEvent);
  }

  scheduleEvent(client, eventKey);
}

async function forceReleaseNextSlot(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  if (!event.groups?.groups || !Object.keys(event.groups.groups).length) {
    throw new Error('Fuer dieses Event wurden noch keine Gruppen gezogen.');
  }
  if (event.groups?.status === 'completed') {
    throw new Error('Die Gruppenphase ist bereits abgeschlossen.');
  }

  ensureReleaseState(eventKey, event, now);
  const slot = nextReleasableSlot(event);
  if (!slot) {
    throw new Error('Aktuell kann kein weiterer Spieltag freigegeben werden.');
  }

  await releaseSlot(client, eventKey, slot, now);
  return { slot };
}

async function maybeReleaseNextSlot(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  if (event.groups?.status === 'completed') return;
  ensureReleaseState(eventKey, event, now);
  const slot = nextReleasableSlot(event);
  if (!slot) return;

  if (slot === 1) {
    const planned = new Date(event.groups.releases.slots[1].plannedAt);
    if (planned.getTime() > now.getTime()) {
      scheduleEvent(client, eventKey);
      return;
    }
  }

  await releaseSlot(client, eventKey, slot, now);
}

async function maybeCreateKnockoutAfterGroupsComplete(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  if (event.groups?.status !== 'completed') return;
  if (event.knockout?.status && event.knockout.status !== 'not_created') return;

  try {
    await createKnockoutPhase({
      eventKey,
      actorUserId: 'auto-groups-completed',
      client,
      now,
    });
    console.log(`[groups] ${eventKey}: K.O.-Phase automatisch nach Gruppenabschluss erstellt.`);
  } catch (error) {
    if (!String(error?.message || '').includes('bereits erstellt')) {
      console.warn(`[groups] ${eventKey}: automatische K.O.-Erstellung fehlgeschlagen: ${error.message}`);
    }
  }
}

function clearTimer(key) {
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

function clearEventTimers(eventKey) {
  for (const slot of [1, 2, 3]) {
    clearTimer(`${eventKey}:release:${slot}`);
    clearTimer(`${eventKey}:reminder:${slot}`);
    clearTimer(`${eventKey}:autoscore:${slot}`);
  }
}

function setTimer(key, targetAt, callback) {
  clearTimer(key);
  const delay = Math.max(0, new Date(targetAt).getTime() - Date.now());
  const timer = setTimeout(callback, Math.min(delay, MAX_TIMEOUT_MS));
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(key, timer);
}

function scheduleEvent(client, eventKey) {
  clearEventTimers(eventKey);
  const event = readEventData(eventKey);
  if (!event.groups?.groups || !Object.keys(event.groups.groups).length) return;
  if (event.groups.status === 'completed') return;

  updateEventData(eventKey, current => {
    ensureReleaseState(eventKey, current);
    return current;
  });

  const current = readEventData(eventKey);
  const releases = current.groups?.releases?.slots || {};

  const nextSlot = nextReleasableSlot(current);
  if (nextSlot) {
    const release = releases[slotKey(nextSlot)];
    const targetAt = nextSlot === 1 && release?.plannedAt ? release.plannedAt : nowIso();
    setTimer(`${eventKey}:release:${nextSlot}`, targetAt, () => {
      maybeReleaseNextSlot(client, eventKey).catch(error => console.error('Gruppen-Spielfreigabe fehlgeschlagen:', error));
    });
  }

  for (const slot of [1, 2, 3]) {
    const release = releases[slotKey(slot)];
    if (!release?.releasedAt) continue;
  }
}

async function afterGroupResultConfirmed(client, eventKey, now = new Date()) {
  await maybeReleaseNextSlot(client, eventKey, now);
  await maybeCreateKnockoutAfterGroupsComplete(client, eventKey, now);
}

async function initGroupReleases(client) {
  for (const eventKey of EVENT_KEYS) {
    scheduleEvent(client, eventKey);
    await maybeReleaseNextSlot(client, eventKey).catch(error => console.error('Gruppen-Spielfreigabe beim Start fehlgeschlagen:', error));
    await maybeCreateKnockoutAfterGroupsComplete(client, eventKey).catch(error => console.error('K.O.-Auto-Erstellung beim Start fehlgeschlagen:', error));
  }
}

module.exports = {
  afterGroupResultConfirmed,
  applyAutoScores,
  createInitialReleaseState,
  ensureReleaseState,
  forceReleaseNextSlot,
  initGroupReleases,
  isMatchReleased,
  maybeReleaseNextSlot,
  releaseSlot,
  scheduleEvent,
};
