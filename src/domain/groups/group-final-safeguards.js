'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { readEventData, updateEventData } = require('../events/event-repository');

const OVERVIEW_URL = 'https://discord.com/channels/1516390719411982346/1516429776070508555';
const CHECK_INTERVAL_MS = 5000;
let interval = null;

function finalSlotRelease(event, groupKey) {
  return event.groups?.releases?.groups?.[groupKey]?.slots?.['3']
    || event.groups?.releases?.groups?.[groupKey]?.slots?.[3]
    || null;
}

function disableFinalMatchdayAutoScore(eventKey) {
  let changed = false;
  updateEventData(eventKey, event => {
    for (const [groupKey, group] of Object.entries(event.groups?.groups || {})) {
      if (!group || group.status === 'completed') continue;
      const release = finalSlotRelease(event, groupKey);
      if (!release?.releasedAt) continue;
      if (release.autoScoreDisabled === true && !release.autoScoreAt && release.autoScoredAt) continue;
      const timestamp = new Date().toISOString();
      release.autoScoreAt = null;
      // normalizeSlotRelease behandelt autoScoredAt als endgültig erledigten Timer.
      // Hier bedeutet es bewusst: kein Auto-Score am finalen Gruppenspieltag.
      release.autoScoredAt = release.autoScoredAt || timestamp;
      release.autoScoreDisabled = true;
      release.autoScoreDisabledAt = release.autoScoreDisabledAt || timestamp;
      changed = true;
    }
    return event;
  });
  return changed;
}

async function postCompletionNotice(client, eventKey, groupKey) {
  const event = readEventData(eventKey);
  const group = event.groups?.groups?.[groupKey];
  if (!group || group.status !== 'completed' || group.completionNoticeMessageId || group.completionNoticeSendingAt) return false;

  updateEventData(eventKey, current => {
    const stored = current.groups?.groups?.[groupKey];
    if (stored && !stored.completionNoticeMessageId && !stored.completionNoticeSendingAt) {
      stored.completionNoticeSendingAt = new Date().toISOString();
    }
    return current;
  });

  const fresh = readEventData(eventKey).groups?.groups?.[groupKey];
  if (!fresh?.completionNoticeSendingAt || fresh.completionNoticeMessageId) return false;
  const channel = fresh.channelId ? await client.channels.fetch(fresh.channelId).catch(() => null) : null;
  if (!channel?.send) {
    updateEventData(eventKey, current => {
      const stored = current.groups?.groups?.[groupKey];
      if (stored) stored.completionNoticeSendingAt = null;
      return current;
    });
    return false;
  }

  const roleMention = fresh.roleId ? `<@&${fresh.roleId}>` : `@Gruppe ${groupKey}`;
  const content = [
    roleMention,
    '',
    `✅ **Gruppe ${groupKey}: Eure Gruppenphase ist abgeschlossen!**`,
    '',
    'Alle Ergebnisse eurer Gruppe sind vollständig bestätigt.',
    'Die **K.O.-Phase beginnt, sobald alle Gruppenergebnisse aller Gruppen bestätigt sind.**',
    '',
    `👀 Den aktuellen Stand könnt ihr hier verfolgen: ${OVERVIEW_URL}`,
  ].join('\n');

  const message = await channel.send({
    content,
    allowedMentions: { parse: [], roles: fresh.roleId ? [fresh.roleId] : [] },
  }).catch(error => {
    console.error(`[groups] Abschlussmeldung Gruppe ${groupKey} (${eventKey}) fehlgeschlagen:`, error);
    return null;
  });

  updateEventData(eventKey, current => {
    const stored = current.groups?.groups?.[groupKey];
    if (!stored) return current;
    stored.completionNoticeSendingAt = null;
    if (message?.id) {
      stored.completionNoticeMessageId = message.id;
      stored.completionNoticePostedAt = new Date().toISOString();
    }
    return current;
  });
  return Boolean(message?.id);
}

async function reconcile(client) {
  const groupReleases = require('./group-releases');
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if (event.leaguePhase?.phaseType === 'league') continue;
    if (!event.groups?.groups || !Object.keys(event.groups.groups).length) continue;

    if (disableFinalMatchdayAutoScore(eventKey)) {
      // scheduleEvent löscht einen eventuell schon gesetzten 25-Minuten-Timer.
      // Durch autoScoredAt wird für Spieltag 3 anschließend kein neuer erzeugt.
      groupReleases.scheduleEvent(client, eventKey);
      console.info(`[groups] ${eventKey}: automatische 25-Minuten-Wertung am letzten Gruppenspieltag deaktiviert.`);
    }

    const current = readEventData(eventKey);
    for (const [groupKey, group] of Object.entries(current.groups?.groups || {})) {
      if (group?.status === 'completed' && !group.completionNoticeMessageId) {
        await postCompletionNotice(client, eventKey, groupKey);
      }
    }
  }
}

async function initGroupFinalSafeguards(client) {
  await reconcile(client);
  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    reconcile(client).catch(error => console.error('[groups] Final-Safeguards fehlgeschlagen:', error));
  }, CHECK_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
  return true;
}

module.exports = { initGroupFinalSafeguards, reconcile };
