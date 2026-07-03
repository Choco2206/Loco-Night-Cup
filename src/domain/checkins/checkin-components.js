'use strict';

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { EVENT_LABELS, TOURNAMENT_FORMAT_SIZES } = require('../../app/constants');
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

const TOURNAMENT_MILESTONES = TOURNAMENT_FORMAT_SIZES;
const MAX_DISPLAY_SLOTS = 32;

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

function getNextFormatInfo(participantSlots, settings, event) {
  const allowedSizes = getAllowedSizes(settings, event);
  const currentSize = chooseFormatSize({
    participantSlotCount: participantSlots,
    minimumParticipantSlots: Number(settings.tournament?.minimumRealTeams || event.format?.minimumRealTeams || 8),
    allowedSizes,
  });
  const nextSize = allowedSizes.find(size => size > participantSlots) || null;
  return {
    currentSize,
    nextSize,
    missingForNext: nextSize ? Math.max(0, nextSize - participantSlots) : 0,
  };
}

function formatCheckinSummary(event, settings, slotState) {
  const { currentSize, nextSize, missingForNext } = getNextFormatInfo(slotState.participantSlotCount, settings, event);
  return [
    `Aktueller Stand: ${slotState.participantSlotCount} Teams`,
    `Aktuell gueltig: ${currentSize ? `${currentSize}er Cup` : 'noch kein gueltiger Cup'}`,
    `Naechster Schritt: ${nextSize ? `${nextSize}er Cup` : 'maximal erreicht'}`,
    nextSize
      ? `Es fehlen noch ${missingForNext} Team${missingForNext === 1 ? '' : 's'} fuer den ${nextSize}er Cup`
      : 'Es fehlen noch 0 Teams',
    `Warteliste aktuell: ${slotState.waitlistLabels.length} Teams`,
  ].join('\n');
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
  const displaySlotCount = MAX_DISPLAY_SLOTS;
  const activeTeamIds = getActiveTeamIds(event);
  const waitlistTeamIds = getWaitlistTeamIds(event);
  const byeCount = getManualByeCount(event);
  const activeByeCount = event.format?.lockedAt
    ? Number(event.format?.activeByeCount || 0)
    : Math.min(byeCount, Math.max(0, Number(playableSlotCount || 0) - activeTeamIds.length));
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
    participantLabels: [...activeLabels, ...waitlistLabels],
    participantSlotCount: activeLabels.length + waitlistLabels.length,
    playableSlotCount,
    waitlistLabels,
  };
}

function formatMilestoneLine(size) {
  return `════ ⬆️ ${size}er Turnier ⬆️ ════`;
}

function formatSlotLines(slotState) {
  const lines = [];
  const playableSlotCount = slotState.playableSlotCount;

  for (let slot = 1; slot <= MAX_DISPLAY_SLOTS; slot += 1) {
    const label = slotState.participantLabels[slot - 1];
    const isWaitlistSlot = Boolean(playableSlotCount && slot > playableSlotCount && label);
    lines.push(`${slot}. ${label ? `${label}${isWaitlistSlot ? ' (WL)' : ''}` : '—'}`);

    if (TOURNAMENT_MILESTONES.includes(slot)) {
      lines.push(formatMilestoneLine(slot));
    }
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
    '',
    rulesLine,
    formatCheckinSummary(event, settings, slotState),
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
