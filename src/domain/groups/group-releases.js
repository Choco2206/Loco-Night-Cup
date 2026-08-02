'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { getTournamentStartAt } = require('../checkins/checkin-schedule');
const { readEventData, updateEventData } = require('../events/event-repository');
const { createKnockoutPhase } = require('../knockout/knockout-service');
const { scheduleRatingCapture } = require('../team-of-the-tournament/team-of-the-tournament-service');
const { refreshGroupPosts } = require('./group-posts');
const {
  getMatches,
  getMatchSlot,
  isMatchReleased,
  isRealMatch,
  recalculateGroupStandings,
  updateGroupCompletion,
} = require('./group-results');
const { deleteUserMessagesFromGroupChannel } = require('./group-message-cleanup');

const INVITE_WINDOW_MINUTES = 5;
const AUTO_SCORE_DELAY_MS = 25 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const GROUP_SLOTS = [1, 2, 3];

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

function groupEntries(event) {
  return Object.entries(event.groups?.groups || {})
    .filter(([, group]) => group && typeof group === 'object');
}

function groupKeys(event) {
  return groupEntries(event).map(([groupKey]) => groupKey);
}

function getGroup(event, groupKey) {
  return event.groups?.groups?.[groupKey] || null;
}

function getFirstSlotStart(eventKey, event, now = new Date(), { useExistingPlanned = true } = {}) {
  if (useExistingPlanned) {
    const groupRelease = Object.values(event.groups?.releases?.groups || {})
      .find(release => release?.slots?.[1]?.plannedAt || release?.slots?.['1']?.plannedAt);
    const plannedValue = groupRelease?.slots?.[1]?.plannedAt || groupRelease?.slots?.['1']?.plannedAt;
    const planned = plannedValue ? new Date(plannedValue) : null;
    if (planned && !Number.isNaN(planned.getTime())) return planned;

    const legacyPlanned = event.groups?.releases?.slots?.[1]?.plannedAt || event.groups?.releases?.slots?.['1']?.plannedAt;
    const legacy = legacyPlanned ? new Date(legacyPlanned) : null;
    if (legacy && !Number.isNaN(legacy.getTime())) return legacy;
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
  const offset = berlinOffsetForDate(new Date(`${datePart}T12:00:00Z`));
  return new Date(`${datePart}T00:00:00${offset}`);
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

function createEmptyGroupRelease(firstPlannedAt = null) {
  return {
    currentSlot: null,
    slots: Object.fromEntries(GROUP_SLOTS.map(slot => [slotKey(slot), createEmptySlotRelease(slot, firstPlannedAt)])),
  };
}

function createInitialReleaseState(eventKey, event, now = new Date()) {
  const firstPlannedAt = getFirstSlotStart(eventKey, event, now, { useExistingPlanned: false }).toISOString();
  return {
    groups: Object.fromEntries(groupKeys(event).map(groupKey => [groupKey, createEmptyGroupRelease(firstPlannedAt)])),
  };
}

function cloneJson(value) {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function legacySlotForGroup(legacySlots, groupKey, slot) {
  const legacy = legacySlots?.[slotKey(slot)] || legacySlots?.[slot];
  if (!legacy) return null;

  const releaseIds = legacy.releaseMessageIds || {};
  const reminderIds = legacy.reminderMessageIds || {};
  return {
    ...cloneJson(legacy),
    releaseMessageIds: releaseIds[groupKey] ? { [groupKey]: releaseIds[groupKey] } : {},
    reminderMessageIds: reminderIds[groupKey] ? { [groupKey]: reminderIds[groupKey] } : {},
  };
}

function normalizeSlotRelease(slot, release, firstPlannedAt) {
  const base = createEmptySlotRelease(slot, firstPlannedAt);
  const normalized = {
    ...base,
    ...(release || {}),
  };

  if (slot === 1 && !normalized.plannedAt) normalized.plannedAt = firstPlannedAt;
  normalized.releaseMessageIds = normalized.releaseMessageIds || {};
  normalized.reminderMessageIds = normalized.reminderMessageIds || {};

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
  normalized.reminderAt = null;
  normalized.autoScoreAt = normalized.autoScoredAt
    ? null
    : normalized.autoScoreAt || nowIso(new Date(releasedDate.getTime() + AUTO_SCORE_DELAY_MS));
  return normalized;
}

function ensureReleaseState(eventKey, event, now = new Date()) {
  event.groups = event.groups || {};
  const previous = event.groups.releases || {};
  const firstPlannedAt = getFirstSlotStart(eventKey, event, now).toISOString();
  const releasesByGroup = {};

  for (const groupKey of groupKeys(event)) {
    const previousGroup = previous.groups?.[groupKey] || {};
    const slots = {};

    for (const slot of GROUP_SLOTS) {
      const key = slotKey(slot);
      const groupSlot = previousGroup.slots?.[key] || previousGroup.slots?.[slot];
      slots[key] = normalizeSlotRelease(slot, groupSlot || legacySlotForGroup(previous.slots, groupKey, slot), firstPlannedAt);
    }

    releasesByGroup[groupKey] = {
      currentSlot: previousGroup.currentSlot || null,
      slots,
    };
  }

  event.groups.releases = {
    groups: releasesByGroup,
  };

  return event.groups.releases;
}

function getGroupRelease(event, groupKey) {
  return event.groups?.releases?.groups?.[groupKey] || null;
}

function getSlotRelease(event, groupKey, slot) {
  return getGroupRelease(event, groupKey)?.slots?.[slotKey(slot)] || null;
}

function getSlotMatches(event, groupKey, slot) {
  const group = getGroup(event, groupKey);
  if (!group) return [];
  return getMatches(group)
    .filter(match => isRealMatch(match) && getMatchSlot(match) === Number(slot))
    .map(match => ({ group, groupKey, match }));
}

function isSlotComplete(event, groupKey, slot) {
  const slotMatches = getSlotMatches(event, groupKey, slot);
  return slotMatches.every(entry => entry.match.status === 'confirmed');
}

function nextReleasableSlot(event, groupKey) {
  const group = getGroup(event, groupKey);
  const releases = getGroupRelease(event, groupKey);
  if (!group || group.status === 'completed' || !releases) return null;

  for (const slot of GROUP_SLOTS) {
    const release = releases.slots?.[slotKey(slot)];
    if (release?.releasedAt) continue;
    if (slot === 1) return 1;
    if (isSlotComplete(event, groupKey, slot - 1)) return slot;
    return null;
  }

  return null;
}

function markGroupSlotReleased(eventKey, event, groupKey, slot, now = new Date()) {
  ensureReleaseState(eventKey, event, now);
  const release = getSlotRelease(event, groupKey, slot);
  if (!release || release.releasedAt) return false;

  const releasedAt = nowIso(now);
  release.status = 'released';
  release.releasedAt = releasedAt;
  release.inviteStartAt = releasedAt;
  release.inviteEndAt = nowIso(addMinutes(now, INVITE_WINDOW_MINUTES));
  release.reminderAt = null;
  release.autoScoreAt = nowIso(new Date(now.getTime() + AUTO_SCORE_DELAY_MS));
  release.reminderSentAt = null;
  release.autoScoredAt = null;
  getGroupRelease(event, groupKey).currentSlot = slot;

  for (const { match } of getSlotMatches(event, groupKey, slot)) {
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

async function sendToGroupChannel(client, group, content, idBucketName, slot) {
  if (!client || !group?.channelId) return null;
  const channel = await client.channels.fetch(group.channelId).catch(() => null);
  if (!channel) return null;

  const message = await channel.send({
    content,
    allowedMentions: { parse: [] },
  }).catch(error => {
    console.error(`Gruppe ${group.groupKey}: ${idBucketName} fuer Spieltag ${slot} konnte nicht gesendet werden.`, error);
    return null;
  });
  return message?.id || null;
}

async function postReleaseMessage(client, eventKey, event, groupKey, slot) {
  const release = getSlotRelease(event, groupKey, slot);
  const group = getGroup(event, groupKey);
  if (!release?.releasedAt || !group || release.releaseMessageIds?.[groupKey]) return;

  const content = [
    `\u2705 Gruppe ${groupKey}: Spieltag ${slot} ist freigegeben`,
    '',
    `Einladezeit: ${formatHm(new Date(release.inviteStartAt))} - ${formatHm(new Date(release.inviteEndAt))} Uhr`,
    '',
    '\u26a0\ufe0f Beide Teams muessen das Ergebnis eintragen.',
    '',
    'Tragt eure Ergebnisse bitte direkt ein.',
    '',
    'Sobald alle Ergebnisse dieses Spieltags in dieser Gruppe final bestaetigt sind, wird automatisch nur in dieser Gruppe der naechste Spieltag freigegeben.',
  ].join('\n');

  const messageId = await sendToGroupChannel(client, group, content, 'Freigabe-Post', slot);
  if (!messageId) return;

  updateEventData(eventKey, current => {
    ensureReleaseState(eventKey, current);
    const currentRelease = getSlotRelease(current, groupKey, slot);
    if (currentRelease) {
      currentRelease.releaseMessageIds = {
        ...(currentRelease.releaseMessageIds || {}),
        [groupKey]: messageId,
      };
    }
    return current;
  });
}

async function refreshGroup(client, eventKey, event, groupKey) {
  if (!client) return;
  const group = getGroup(event, groupKey);
  if (!group) return;
  await refreshGroupPosts({ client, eventKey, event, group }).catch(error => {
    console.error(`Gruppe ${group.groupKey}: Posts konnten nach Slot-Aktualisierung nicht aktualisiert werden.`, error);
  });
}

async function applyAutoScores(client, eventKey, groupKeyOrSlot, slotOrNow, maybeNow) {
  const legacyCall = typeof groupKeyOrSlot === 'number';
  const groupKey = legacyCall ? null : groupKeyOrSlot;
  const slot = legacyCall ? groupKeyOrSlot : slotOrNow;
  const now = legacyCall ? (slotOrNow || new Date()) : (maybeNow || new Date());

  const autoConfirmedMatches = [];
  updateEventData(eventKey, event => {
    ensureReleaseState(eventKey, event, now);
    const targetGroups = groupKey ? [groupKey] : groupKeys(event);
    for (const key of targetGroups) {
      const group = getGroup(event, key);
      const release = getSlotRelease(event, key, slot);
      if (!release || !group) continue;
      for (const { match } of getSlotMatches(event, key, slot)) {
        if (!isRealMatch(match) || match.status === 'confirmed') continue;
        const reports = [...new Map((match.reports || []).map(report => [String(report.participantKey), report])).values()];
        if (reports.length > 1) continue;
        const report = reports[0] || null;
        match.status = 'confirmed';
        match.result = {
          homeGoals: report ? Number(report.homeGoals) : 0,
          awayGoals: report ? Number(report.awayGoals) : 0,
          confirmedAt: nowIso(now),
          source: report ? 'slot_timeout_report' : 'slot_timeout_0_0',
          submittedByUserId: report?.submittedByUserId || null,
        };
        match.confirmation = null;
        match.meta = { ...(match.meta || {}), updatedAt: nowIso(now) };
        autoConfirmedMatches.push(match);
      }
      recalculateGroupStandings(group);
      updateGroupCompletion(event, group);
      if (release.releasedAt && isSlotComplete(event, key, slot)) {
        release.status = 'completed';
        release.completedAt = release.completedAt || nowIso(now);
      }
      release.autoScoreAt = null;
      release.autoScoredAt = nowIso(now);
    }
    event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
    return event;
  });

  if (client) {
    for (const match of autoConfirmedMatches) scheduleRatingCapture(eventKey, match);
  }

  await maybeReleaseNextSlot(client, eventKey, groupKey, now);
  await maybeCreateKnockoutAfterGroupsComplete(client, eventKey, now);
  scheduleEvent(client, eventKey);
}

async function releaseGroupSlot(client, eventKey, groupKey, slot, now = new Date()) {
  let releasedEvent = null;
  let didRelease = false;

  updateEventData(eventKey, event => {
    ensureReleaseState(eventKey, event, now);
    didRelease = markGroupSlotReleased(eventKey, event, groupKey, slot, now);
    releasedEvent = event;
    return event;
  });

  if (didRelease && releasedEvent) {
    await deleteUserMessagesFromGroupChannel(client, getGroup(releasedEvent, groupKey));
    await postReleaseMessage(client, eventKey, releasedEvent, groupKey, slot);
    await refreshGroup(client, eventKey, releasedEvent, groupKey);
  }

  scheduleEvent(client, eventKey);
  return didRelease;
}

async function releaseSlot(client, eventKey, slot, now = new Date()) {
  const event = readEventData(eventKey);
  const released = [];
  ensureReleaseState(eventKey, event, now);

  for (const groupKey of groupKeys(event)) {
    if (nextReleasableSlot(event, groupKey) !== Number(slot)) continue;
    const didRelease = await releaseGroupSlot(client, eventKey, groupKey, slot, now);
    if (didRelease) released.push({ groupKey, slot: Number(slot) });
  }

  return released;
}

async function forceReleaseNextSlot(client, eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  if (event.leaguePhase?.phaseType === 'league') {
    const { releaseLeagueMatchday } = require('../league-phase');
    const current = Number(event.leaguePhase.currentMatchday || 0);
    const currentDay = current ? event.leaguePhase.matchdays?.[current - 1] : null;
    const currentNeedsRecovery = currentDay && currentDay.status !== 'completed'
      && (currentDay.status !== 'open' || (currentDay.matches || []).some(match =>
        match.home?.type === 'team' && match.away?.type === 'team'
        && !['open', 'pending_confirmation', 'confirmed'].includes(match.status)));
    const slot = currentNeedsRecovery ? current : Math.min(4, current + 1 || 1);
    const released = await releaseLeagueMatchday(client, eventKey, slot, now);
    if (!released) throw new Error('Aktuell kann kein weiterer Ligaphasen-Spieltag freigegeben werden.');
    return { slot, groups: [{ groupKey: 'Ligaphase', slot }] };
  }
  if (!event.groups?.groups || !Object.keys(event.groups.groups).length) {
    throw new Error('Fuer dieses Event wurden noch keine Gruppen gezogen.');
  }
  if (event.groups?.status === 'completed') {
    throw new Error('Die Gruppenphase ist bereits abgeschlossen.');
  }

  ensureReleaseState(eventKey, event, now);
  const candidates = groupKeys(event)
    .map(groupKey => ({ groupKey, slot: nextReleasableSlot(event, groupKey) }))
    .filter(entry => entry.slot);

  if (!candidates.length) {
    throw new Error('Aktuell kann in keiner Gruppe ein weiterer Spieltag freigegeben werden.');
  }

  const released = [];
  for (const entry of candidates) {
    const didRelease = await releaseGroupSlot(client, eventKey, entry.groupKey, entry.slot, now);
    if (didRelease) released.push(entry);
  }

  return {
    slot: released.length ? Math.min(...released.map(entry => entry.slot)) : null,
    groups: released,
  };
}

async function maybeReleaseNextSlot(client, eventKey, groupKeyOrNow = null, maybeNow = new Date()) {
  const groupKey = typeof groupKeyOrNow === 'string' ? groupKeyOrNow : null;
  const now = typeof groupKeyOrNow === 'string' ? maybeNow : (groupKeyOrNow || maybeNow || new Date());
  const event = readEventData(eventKey);
  if (event.leaguePhase?.phaseType === 'league') {
    const { maybeReleaseLeagueStart } = require('../league-phase');
    return maybeReleaseLeagueStart(client, eventKey, now);
  }
  if (event.groups?.status === 'completed') return [];

  ensureReleaseState(eventKey, event, now);
  const targets = groupKey ? [groupKey] : groupKeys(event);
  const released = [];

  for (const key of targets) {
    const slot = nextReleasableSlot(event, key);
    if (!slot) continue;

    if (slot === 1) {
      const planned = new Date(getSlotRelease(event, key, 1)?.plannedAt);
      if (planned.getTime() > now.getTime()) {
        scheduleEvent(client, eventKey);
        continue;
      }
    }

    const didRelease = await releaseGroupSlot(client, eventKey, key, slot, now);
    if (didRelease) released.push({ groupKey: key, slot });
  }

  return released;
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
  for (const groupKey of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    for (const slot of GROUP_SLOTS) {
      clearTimer(`${eventKey}:${groupKey}:release:${slot}`);
      clearTimer(`${eventKey}:${groupKey}:reminder:${slot}`);
      clearTimer(`${eventKey}:${groupKey}:autoscore:${slot}`);
    }
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
  if (event.leaguePhase?.phaseType === 'league') {
    const { scheduleLeaguePhase } = require('../league-phase');
    scheduleLeaguePhase(client, eventKey);
    return;
  }
  if (!event.groups?.groups || !Object.keys(event.groups.groups).length) return;
  if (event.groups.status === 'completed') return;

  updateEventData(eventKey, current => {
    ensureReleaseState(eventKey, current);
    return current;
  });

  const current = readEventData(eventKey);
  for (const groupKey of groupKeys(current)) {
    for (const slot of GROUP_SLOTS) {
      const activeRelease = getSlotRelease(current, groupKey, slot);
      if (!activeRelease?.releasedAt || !activeRelease.autoScoreAt || activeRelease.autoScoredAt) continue;
      if (isSlotComplete(current, groupKey, slot)) continue;
      setTimer(`${eventKey}:${groupKey}:autoscore:${slot}`, activeRelease.autoScoreAt, () => {
        applyAutoScores(client, eventKey, groupKey, slot).catch(error => {
          console.error(`Gruppen-Autowertung fuer ${eventKey} Gruppe ${groupKey} Spieltag ${slot} fehlgeschlagen:`, error);
        });
      });
    }

    const nextSlot = nextReleasableSlot(current, groupKey);
    if (!nextSlot) continue;

    const release = getSlotRelease(current, groupKey, nextSlot);
    const targetAt = nextSlot === 1 && release?.plannedAt ? release.plannedAt : nowIso();
    setTimer(`${eventKey}:${groupKey}:release:${nextSlot}`, targetAt, () => {
      maybeReleaseNextSlot(client, eventKey, groupKey).catch(error => {
        console.error(`Gruppen-Spielfreigabe fuer ${eventKey} Gruppe ${groupKey} fehlgeschlagen:`, error);
      });
    });
  }
}

async function afterGroupResultConfirmed(client, eventKey, groupKeyOrNow = null, maybeNow = new Date()) {
  const groupKey = typeof groupKeyOrNow === 'string' ? groupKeyOrNow : null;
  const now = typeof groupKeyOrNow === 'string' ? maybeNow : (groupKeyOrNow || maybeNow || new Date());
  if (String(groupKey || '').toLowerCase() === 'league' || readEventData(eventKey).leaguePhase?.phaseType === 'league') {
    const { advanceLeaguePhase } = require('../league-phase');
    return advanceLeaguePhase(client, eventKey, now);
  }
  await maybeReleaseNextSlot(client, eventKey, groupKey, now);
  await maybeCreateKnockoutAfterGroupsComplete(client, eventKey, now);
}

async function initGroupReleases(client) {
  for (const eventKey of EVENT_KEYS) {
    const startupEvent = readEventData(eventKey);
    if (startupEvent.leaguePhase?.phaseType === 'league') {
      const { drawLeaguePhaseForEvent, reconcileLeagueMatchday } = require('../league-phase');
      await drawLeaguePhaseForEvent({ eventKey, client }).catch(error => console.error(`[league-phase] Wiederherstellung fuer ${eventKey} fehlgeschlagen:`, error));
      await reconcileLeagueMatchday(client, eventKey).catch(error => console.error(`[league-phase] Spieltag-Wiederherstellung fuer ${eventKey} fehlgeschlagen:`, error));
      console.info(`[league-phase] ${eventKey}: vorhandene Ligaphase nach Neustart wiederhergestellt.`);
    }
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
