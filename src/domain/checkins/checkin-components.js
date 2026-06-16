'use strict';

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { EVENT_LABELS } = require('../../app/constants');
const { FILES, ROOT_DIR } = require('../../storage');
const { findTeamById } = require('../teams/team-service');
const {
  chooseFormatSize,
  getAllowedSizes,
  getEntryTeamIds,
  getManualByeCount,
} = require('./checkin-format');
const {
  canAcceptCheckinActions,
  getCheckinWindowState,
  getDeadlineAt,
  getDrawAt,
  getEventDateValue,
  getLateWindowUntil,
  getProfileForEvent,
  getTournamentStartAt,
} = require('./checkin-schedule');

function teamName(teamId) {
  const team = findTeamById(teamId);
  return team?.clubName || `Unbekanntes Team (${teamId})`;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function parseDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date) {
  if (!date) return 'nicht gesetzt';
  return date.toLocaleDateString('de-DE', { dateStyle: 'full' });
}

function formatTime(date) {
  if (!date) return 'nicht gesetzt';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatStartIn(startAt, now = new Date()) {
  if (!startAt) return 'nicht gesetzt';
  const diffMs = startAt.getTime() - now.getTime();
  if (diffMs <= 0) return 'Startzeit erreicht';

  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} Min.`;
  if (minutes === 0) return `${hours} Std.`;
  return `${hours} Std. ${minutes} Min.`;
}

function formatStatus(eventKey, event, settings, now = new Date()) {
  const state = getCheckinWindowState(eventKey, event, settings, now);
  if (state.phase === 'regular') return '🟢 Check-in geöffnet';
  if (state.phase === 'late') return '🟡 Late-Check-in geöffnet';
  if (state.phase === 'manual_open') return '🟢 Check-in geöffnet';
  if (state.label === 'Abgesagt') return '🔴 Abgesagt';
  if (state.label === 'Reset') return '⚪ Reset';
  return '🔴 Check-in geschlossen';
}

function getParticipantSlotCount(event) {
  return getEntryTeamIds(event).length + getManualByeCount(event);
}

function displaySizeForParticipantSlots(participantSlots) {
  if (participantSlots >= 22) return 32;
  if (participantSlots >= 14) return 24;
  if (participantSlots >= 6) return 16;
  return 8;
}

function getDisplaySlotCount(event) {
  const thresholdSize = displaySizeForParticipantSlots(getParticipantSlotCount(event));
  if (event.format?.lockedAt && event.format?.size) return Math.max(Number(event.format.size), thresholdSize);
  return thresholdSize;
}

function getPlayableSlotCount(event, settings) {
  if (event.format?.lockedAt && event.format?.size) return Number(event.format.size);
  if (event.format?.size) return Number(event.format.size);

  const minimum = Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
  return chooseFormatSize({
    participantSlotCount: getParticipantSlotCount(event),
    minimumParticipantSlots: minimum,
    allowedSizes: getAllowedSizes(settings, event),
  });
}

function formatFormat(event, settings) {
  const minimum = Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8);
  const participantSlots = getParticipantSlotCount(event);
  const byeCount = getManualByeCount(event);
  const byeLine = byeCount > 0 ? `\n• ${byeCount} manuelle Freilose vorhanden` : '';
  const playableSlotCount = getPlayableSlotCount(event, settings);

  if (event.format?.lockedAt && playableSlotCount) {
    return `${playableSlotCount}er Turnier (gelockt)\n• Minimum ${minimum} Teilnehmerplätze erforderlich${byeLine}`;
  }

  if (!playableSlotCount || participantSlots < minimum) {
    return `Noch kein gültiges Turnierformat\n• Minimum ${minimum} Teilnehmerplätze erforderlich${byeLine}`;
  }

  return `${playableSlotCount}er Turnier\n• Minimum ${minimum} Teilnehmerplätze erforderlich${byeLine}`;
}

function getActiveTeamIds(event) {
  const entryIds = new Set(getEntryTeamIds(event));
  const activeTeamIds = uniqueStrings(event.checkin?.activeTeamIds || []).filter(teamId => entryIds.has(teamId));
  if (activeTeamIds.length || event.format?.size) return activeTeamIds;
  return getEntryTeamIds(event);
}

function getWaitlistTeamIds(event) {
  const entryIds = new Set(getEntryTeamIds(event));
  return uniqueStrings(event.checkin?.waitlistTeamIds || []).filter(teamId => entryIds.has(teamId));
}

function buildSlotState(event, settings) {
  const playableSlotCount = getPlayableSlotCount(event, settings);
  const displaySlotCount = getDisplaySlotCount(event);
  const activeTeamIds = getActiveTeamIds(event);
  const waitlistTeamIds = getWaitlistTeamIds(event);
  const byeCount = getManualByeCount(event);
  const activeByeCount = playableSlotCount
    ? Math.min(byeCount, Math.max(0, playableSlotCount - activeTeamIds.length))
    : 0;
  const waitlistByeCount = Math.max(0, byeCount - activeByeCount);

  const activeLabels = [
    ...activeTeamIds.map(teamName),
    ...Array.from({ length: activeByeCount }, (_, index) => activeByeCount > 1 ? `Freilos-Team ${index + 1}` : 'Freilos'),
  ];
  const waitlistLabels = [
    ...waitlistTeamIds.map(teamName),
    ...Array.from({ length: waitlistByeCount }, (_, index) => waitlistByeCount > 1 ? `Freilos-Team ${activeByeCount + index + 1}` : 'Freilos'),
  ];

  return {
    activeLabels,
    displaySlotCount,
    participantSlotCount: activeLabels.length + waitlistLabels.length,
    playableSlotCount,
    waitlistLabels,
  };
}

function formatSlotLines(slotState) {
  const lines = [];
  const playableSlotCount = slotState.playableSlotCount;
  const hasSeparator = Boolean(playableSlotCount && slotState.displaySlotCount > playableSlotCount);

  for (let slot = 1; slot <= slotState.displaySlotCount; slot += 1) {
    if (hasSeparator && slot === playableSlotCount + 1) {
      lines.push(`════ ⬆️ ${playableSlotCount}er Turnier ⬆️ ════`);
    }

    if (playableSlotCount && slot > playableSlotCount) {
      const waitlistIndex = slot - playableSlotCount - 1;
      const label = slotState.waitlistLabels[waitlistIndex];
      lines.push(`${slot}. ${label ? `${label} (WL)` : '—'}`);
      continue;
    }

    const label = slotState.activeLabels[slot - 1];
    lines.push(`${slot}. ${label || '—'}`);
  }

  return lines.join('\n');
}

function formatWaitlistSection(slotState) {
  if (!slotState.waitlistLabels.length) return null;
  return [
    '───────────────',
    '',
    '⚠️ Warteliste (aktuell nicht teilnahmeberechtigt)',
    ...slotState.waitlistLabels.map((label, index) => `${index + 1}. ${label}`),
  ].join('\n');
}

function getBannerAttachment(settings) {
  const configuredPath = settings.assets?.checkinBannerPath || 'data/assets/check-in.png';
  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(ROOT_DIR, configuredPath);

  const fallbackPath = FILES.checkinBanner;
  const bannerPath = fs.existsSync(absolutePath) ? absolutePath : fallbackPath;
  if (!fs.existsSync(bannerPath)) return null;

  return {
    attachment: bannerPath,
    name: path.basename(bannerPath),
  };
}

function buildBannerEmbed(bannerAttachment) {
  if (!bannerAttachment) return null;
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setImage(`attachment://${bannerAttachment.name}`);
}

function buildCheckinEmbed(eventKey, event, settings) {
  const now = new Date();
  const label = EVENT_LABELS[eventKey] || eventKey;
  const profile = getProfileForEvent(eventKey, settings, event) || {};
  const eventDateValue = getEventDateValue(eventKey, event, now);
  const eventDate = parseDateTime(eventDateValue, '00:00');
  const deadlineAt = getDeadlineAt(eventKey, event, settings, now);
  const lateWindowUntil = getLateWindowUntil(eventKey, event, settings, now);
  const drawAt = getDrawAt(eventKey, event, settings, now);
  const tournamentStartAt = getTournamentStartAt(eventKey, event, settings, now);
  const slotState = buildSlotState(event, settings);
  const rulesLine = settings.channels?.rulesChannelId ? `📜 Regeln: <#${settings.channels.rulesChannelId}>` : null;
  const nightHint = profile.startIsNextDay ? `🌙 Nacht von ${label} auf ${nextDayLabel(eventKey)}` : null;
  const waitlistSection = formatWaitlistSection(slotState);

  const description = [
    formatStatus(eventKey, event, settings, now),
    `📅 Datum: ${formatDate(eventDate)}`,
    '',
    `⏰ Offizieller Anmeldeschluss: ${formatTime(deadlineAt)}`,
    `🕒 Late-Check-in bis: ${formatTime(lateWindowUntil)}`,
    `🎲 Gruppenauslosung: ${formatTime(drawAt)}`,
    '',
    `🚀 Turnierstart: ${formatTime(tournamentStartAt)}`,
    nightHint,
    `🕘 Start in: ${formatStartIn(tournamentStartAt, now)}`,
    '',
    rulesLine,
    '─────────────',
    `🏆 Turnierformat: ${formatFormat(event, settings)}`,
    '─────────────',
    `👥 Teilnehmende Teams/Plätze (${slotState.participantSlotCount})`,
    formatSlotLines(slotState),
    waitlistSection,
    '',
    '⚠️ Wichtiger Hinweis zur Abmeldung',
    `Nach dem offiziellen Anmeldeschluss um ${formatTime(deadlineAt)} Uhr führt eine Abmeldung automatisch zu einer 7-Tage-Sperre.`,
  ].filter(line => line !== null && line !== undefined).join('\n');

  return new EmbedBuilder()
    .setTitle(`🌕 Loco NightCup ${label}`)
    .setColor(0xff0000)
    .setDescription(description)
    .setTimestamp(now);
}

function nextDayLabel(eventKey) {
  const order = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const index = order.indexOf(eventKey);
  const nextKey = order[(index + 1) % order.length];
  return EVENT_LABELS[nextKey] || nextKey;
}

function buildCheckinButtons(eventKey, event, settings) {
  const state = getCheckinWindowState(eventKey, event, settings);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`checkin_join:${eventKey}`)
      .setLabel('⬆️ Anmelden')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canAcceptCheckinActions(eventKey, event, settings)),
    new ButtonBuilder()
      .setCustomId(`checkin_leave:${eventKey}`)
      .setLabel('⬇️ Abmelden')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!state.canLeave)
  );
}

function buildCheckinMessagePayload(eventKey, event, settings) {
  const bannerAttachment = getBannerAttachment(settings);
  const bannerEmbed = buildBannerEmbed(bannerAttachment);
  const embeds = [bannerEmbed, buildCheckinEmbed(eventKey, event, settings)].filter(Boolean);

  return {
    embeds,
    components: [buildCheckinButtons(eventKey, event, settings)],
    files: bannerAttachment ? [bannerAttachment] : [],
  };
}

module.exports = {
  buildCheckinMessagePayload,
};
