'use strict';

const { EVENT_KEYS, EVENT_PROFILE_BY_KEY } = require('../../app/constants');
const { readEventData, updateEventData } = require('../events/event-repository');
const { refreshGroupPosts } = require('./group-posts');
const {
  getMatches,
  getMatchSlot,
  isMatchReleased,
  isRealMatch,
  recalculateGroupStandings,
  updateGroupCompletion,
} = require('./group-results');

const INVITE_WINDOW_MINUTES = 5;
const REMINDER_DELAY_MS = 20 * 60 * 1000;
const AUTO_SCORE_DELAY_MS = 25 * 60 * 1000;
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

function getFirstSlotStart(eventKey, event, now = new Date()) {
  if (event.groups?.releases?.slots?.[1]?.plannedAt) {
    const planned = new Date(event.groups.releases.slots[1].plannedAt);
    if (!Number.isNaN(planned.getTime())) return planned;
  }

  if (event.schedule?.tournamentStartAt) {
    const scheduled = new Date(event.schedule.tournamentStartAt);
    if (!Number.isNaN(scheduled.getTime())) return scheduled;
  }

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

function ensureReleaseState(eventKey, event, now = new Date()) {
  event.groups = event.groups || {};
  const previous = event.groups.releases || {};
  const slots = previous.slots || {};
  const firstPlannedAt = getFirstSlotStart(eventKey, event, now).toISOString();

  for (const slot of [1, 2, 3]) {
    const key = slotKey(slot);
    slots[key] = {
      status: 'locked',
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
      ...(slots[key] || {}),
    };
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
  release.reminderAt = new Date(now.getTime() + REMINDER_DELAY_MS).toISOString();
  release.autoScoreAt = new Date(now.getTime() + AUTO_SCORE_DELAY_MS).toISOString();
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

function labelForParticipant(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'Freilos';
  return participant.displayName || participant.teamId || 'Team';
}

function formatOpenMatchesByGroup(event, slot) {
  const lines = [];
  for (const group of Object.values(event.groups?.groups || {})) {
    const missing = getMatches(group)
      .filter(match => isRealMatch(match))
      .filter(match => getMatchSlot(match) === Number(slot))
      .filter(match => match.status !== 'confirmed')
      .map(match => `${labelForParticipant(match.home)} vs ${labelForParticipant(match.away)}`);

    if (!missing.length) continue;
    lines.push(`${group.name || `Gruppe ${group.groupKey}`}`);
    lines.push(...missing);
    lines.push('');
  }
  return lines.join('\n').trim();
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

async function postReleaseMessage(client, eventKey, event, slot) {
  const release = event.groups?.releases?.slots?.[slotKey(slot)];
  if (!release || Object.keys(release.releaseMessageIds || {}).length) return;

  const content = [
    `\u2705 Spieltag ${slot} ist freigegeben`,
    '',
    `Einladezeit: ${formatHm(new Date(release.inviteStartAt))} - ${formatHm(new Date(release.inviteEndAt))} Uhr`,
    '',
    '\u26a0\ufe0f Beide Teams muessen das Ergebnis eintragen.',
    '',
    'Bitte startet euer Spiel zeitnah und tragt das Ergebnis direkt nach Spielende ein.',
    '',
    'Verspaetungen verzoegern den gesamten Turnierablauf.',
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

async function postReminderMessage(client, eventKey, event, slot, now = new Date()) {
  const release = event.groups?.releases?.slots?.[slotKey(slot)];
  if (!release || release.reminderSentAt) return;

  const missingText = formatOpenMatchesByGroup(event, slot);
  if (!missingText) {
    updateEventData(eventKey, current => {
      ensureReleaseState(eventKey, current, now);
      current.groups.releases.slots[slotKey(slot)].reminderSentAt = nowIso(now);
      return current;
    });
    return;
  }

  const content = [
    `\u26a0\ufe0f Noch offene Ergebnisse in Spieltag ${slot}`,
    '',
    'Aktuell fehlen noch folgende Ergebnisse:',
    '',
    missingText,
    '',
    'Bitte tragt eure Ergebnisse schnellstmoeglich ein.',
    '',
    'Ihr habt noch 5 Minuten Zeit.',
    '',
    'Danach werden offene Spiele mit 0:0 gewertet, damit der Turnierfluss nicht blockiert wird.',
    '',
    '\u2757 Bitte keine Diskussionen im Nachhinein.',
    '',
    'Es liegt in eurer Verantwortung, puenktlich einzuladen, zu spielen und das Ergebnis einzutragen.',
    '',
    'Technische Probleme, verspaetete Einladungen oder fehlende Ergebnismeldungen verhindern den Turnierablauf fuer alle anderen Teams.',
  ].join('\n');

  const messageIds = await sendToActiveGroupChannels(client, event, content, 'Reminder-Post', slot);
  updateEventData(eventKey, current => {
    ensureReleaseState(eventKey, current, now);
    const currentRelease = current.groups.releases.slots[slotKey(slot)];
    currentRelease.reminderSentAt = nowIso(now);
    currentRelease.reminderMessageIds = {
      ...(currentRelease.reminderMessageIds || {}),
      ...messageIds,
    };
    return current;
  });
}

function applyAutoScoreToMatch(match, now = new Date()) {
  if (!isRealMatch(match)) return false;
  if (match.status === 'confirmed') return false;
  if (match.status === 'admin_decision_required') return false;

  const reports = Array.isArray(match.reports) ? match.reports : [];
  const firstReport = reports[0] || null;
  const homeGoals = firstReport ? Number(firstReport.homeGoals) : 0;
  const awayGoals = firstReport ? Number(firstReport.awayGoals) : 0;

  match.status = 'confirmed';
  match.result = {
    homeGoals,
    awayGoals,
    confirmedAt: nowIso(now),
    source: firstReport ? 'auto_single_report' : 'auto_no_report',
  };
  match.autoScore = {
    appliedAt: nowIso(now),
    reason: firstReport ? 'single_report' : 'no_report',
  };
  match.meta = { ...(match.meta || {}), updatedAt: nowIso(now) };
  return true;
}

async function refreshAllGroups(client, eventKey, event) {
  if (!client) return;
  for (const group of Object.values(event.groups?.groups || {})) {
    await refreshGroupPosts({ client, eventKey, event, group }).catch(error => {
      console.error(`Gruppe ${group.groupKey}: Posts konnten nach Auto-Wertung nicht aktualisiert werden.`, error);
    });
  }
}

async function applyAutoScores(client, eventKey, slot, now = new Date()) {
  let updatedEvent = null;
  let changed = false;
  let blockedByAdminDecision = false;

  updateEventData(eventKey, event => {
    ensureReleaseState(eventKey, event, now);
    const release = event.groups.releases.slots[slotKey(slot)];
    if (!release?.releasedAt || release.autoScoredAt) {
      updatedEvent = event;
      return event;
    }

    for (const group of Object.values(event.groups?.groups || {})) {
      for (const match of getMatches(group)) {
        if (!isRealMatch(match) || getMatchSlot(match) !== Number(slot)) continue;
        if (match.status === 'admin_decision_required') {
          blockedByAdminDecision = true;
          continue;
        }
        if (applyAutoScoreToMatch(match, now)) changed = true;
      }
      recalculateGroupStandings(group);
      updateGroupCompletion(event, group);
    }

    if (blockedByAdminDecision) {
      release.status = 'admin_decision_required';
      release.autoScoredAt = nowIso(now);
    } else if (isSlotComplete(event, slot)) {
      release.status = 'completed';
      release.completedAt = release.completedAt || nowIso(now);
      release.autoScoredAt = nowIso(now);
    }

    event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
    updatedEvent = event;
    return event;
  });

  if (changed && updatedEvent) await refreshAllGroups(client, eventKey, updatedEvent);
  if (!blockedByAdminDecision) await maybeReleaseNextSlot(client, eventKey, now);
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
    await postReleaseMessage(client, eventKey, releasedEvent, slot);
    await refreshAllGroups(client, eventKey, releasedEvent);
  }

  scheduleEvent(client, eventKey);
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

function clearTimer(key) {
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

function setTimer(key, targetAt, callback) {
  clearTimer(key);
  const delay = Math.max(0, new Date(targetAt).getTime() - Date.now());
  const timer = setTimeout(callback, Math.min(delay, MAX_TIMEOUT_MS));
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(key, timer);
}

function scheduleEvent(client, eventKey) {
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

    if (release.reminderAt && !release.reminderSentAt) {
      setTimer(`${eventKey}:reminder:${slot}`, release.reminderAt, async () => {
        const latest = readEventData(eventKey);
        await postReminderMessage(client, eventKey, latest, slot).catch(error => console.error('Gruppen-Reminder fehlgeschlagen:', error));
        scheduleEvent(client, eventKey);
      });
    }

    if (release.autoScoreAt && !release.autoScoredAt) {
      setTimer(`${eventKey}:autoscore:${slot}`, release.autoScoreAt, () => {
        applyAutoScores(client, eventKey, slot).catch(error => console.error('Gruppen-Auto-Wertung fehlgeschlagen:', error));
      });
    }
  }
}

async function afterGroupResultConfirmed(client, eventKey, now = new Date()) {
  await maybeReleaseNextSlot(client, eventKey, now);
}

async function initGroupReleases(client) {
  for (const eventKey of EVENT_KEYS) {
    scheduleEvent(client, eventKey);
    await maybeReleaseNextSlot(client, eventKey).catch(error => console.error('Gruppen-Spielfreigabe beim Start fehlgeschlagen:', error));
  }
}

module.exports = {
  afterGroupResultConfirmed,
  applyAutoScores,
  ensureReleaseState,
  initGroupReleases,
  isMatchReleased,
  maybeReleaseNextSlot,
  releaseSlot,
  scheduleEvent,
};
