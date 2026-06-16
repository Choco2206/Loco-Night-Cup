'use strict';

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { EVENT_LABELS } = require('../../app/constants');
const { FILES, ROOT_DIR } = require('../../storage');
const { findTeamById } = require('../teams/team-service');
const { canAcceptCheckinActions, getCheckinWindowLabel, getDeadlineAt, getLateWindowUntil } = require('./checkin-schedule');

function teamName(teamId) {
  const team = findTeamById(teamId);
  return team?.clubName || `Unbekanntes Team (${teamId})`;
}

function getProfile(eventKey, event, settings) {
  const profileKey = settings.timeProfiles?.eventProfiles?.[eventKey] || event.schedule?.profile || 'early';
  return settings.timeProfiles?.profiles?.[profileKey] || {};
}

function parseDateTime(dateValue, timeValue, addDay = false) {
  if (!dateValue || !timeValue) return null;
  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (addDay) parsed.setDate(parsed.getDate() + 1);
  return parsed;
}

function getScheduleDate(eventKey, event, settings, explicitField, profileField, scheduleField, addDayField = false) {
  if (event.schedule?.[explicitField]) {
    const explicit = new Date(event.schedule[explicitField]);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }

  const profile = getProfile(eventKey, event, settings);
  const timeValue = profile?.[profileField] || event.schedule?.[scheduleField];
  const addDay = addDayField && profile?.startIsNextDay === true;
  return parseDateTime(event.cycle?.eventDate, timeValue, addDay);
}

function formatDate(date) {
  if (!date) return 'nicht gesetzt';
  return date.toLocaleDateString('de-DE', { dateStyle: 'full' });
}

function formatDateTime(date) {
  if (!date) return 'nicht gesetzt';
  return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
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

function formatStatus(eventKey, event, settings) {
  const label = getCheckinWindowLabel(eventKey, event, settings);
  if (label === 'Offen' || label === 'Late Window') return '🟢 Check-in geöffnet';
  if (label === 'Nach Deadline') return '🟡 Nach Deadline';
  if (label === 'Abgesagt') return '🔴 Abgesagt';
  if (label === 'Reset') return '⚪ Reset';
  return '🔴 Check-in geschlossen';
}

function formatFormat(event, settings) {
  const minimum = event.format?.minimumRealTeams || settings.tournament?.minimumRealTeams || 8;
  if (!event.format?.size) {
    return `Noch kein gültiges Turnierformat\nMinimum ${minimum} Teams erforderlich`;
  }

  const lock = event.format?.lockedAt ? 'gelockt' : 'vorläufig';
  return `${event.format.size}er Turnier (${lock})\n${event.format.realTeamCount || 0} echte Teams, ${event.format.byeCount || 0} Freilose, ${event.format.waitlistCount || 0} WL`;
}

function formatSlots(teamIds, slotCount = 8) {
  const lines = [];
  for (let index = 0; index < slotCount; index += 1) {
    const teamId = teamIds[index];
    lines.push(`${index + 1}. ${teamId ? teamName(teamId) : '—'}`);
  }
  return lines.join('\n');
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
  const label = EVENT_LABELS[eventKey] || eventKey;
  const activeTeamIds = event.checkin?.activeTeamIds || [];
  const profile = getProfile(eventKey, event, settings);
  const deadlineAt = getDeadlineAt(eventKey, event, settings);
  const lateWindowUntil = getLateWindowUntil(eventKey, event, settings);
  const drawAt = getScheduleDate(eventKey, event, settings, 'drawAt', 'drawTime', 'drawTime');
  const tournamentStartAt = getScheduleDate(eventKey, event, settings, 'tournamentStartAt', 'tournamentStartTime', 'tournamentStartTime', true);
  const nightHint = profile.startIsNextDay ? `\nHinweis: Nacht von ${label} auf ${nextDayLabel(eventKey)}` : '';
  const rulesLine = settings.channels?.rulesChannelId ? `\nRegeln: <#${settings.channels.rulesChannelId}>` : '';

  return new EmbedBuilder()
    .setTitle(`🌙 Loco NightCup ${label}`)
    .setColor(0xff0000)
    .setDescription([
      formatStatus(eventKey, event, settings),
      `Datum: ${formatDate(tournamentStartAt || parseDateTime(event.cycle?.eventDate, '00:00'))}`,
      `Offizieller Anmeldeschluss: ${formatDateTime(deadlineAt)}`,
      `Gruppenauslosung: ${formatTime(drawAt)}`,
      `Anmeldung offen bis: ${formatTime(lateWindowUntil || deadlineAt)}`,
      `Turnierstart: ${formatTime(tournamentStartAt)}`,
      `Start in: ${formatStartIn(tournamentStartAt)}`,
      `${nightHint}${rulesLine}`.trim(),
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: 'Turnierformat',
        value: formatFormat(event, settings),
        inline: false,
      },
      {
        name: 'Teilnehmende Teams',
        value: formatSlots(activeTeamIds, 8),
        inline: false,
      },
      {
        name: '⚠️ Wichtiger Hinweis zur Abmeldung',
        value: `Nach dem offiziellen Anmeldeschluss um ${formatTime(deadlineAt)} Uhr führt eine Abmeldung automatisch zu einer 7-Tage-Sperre.`,
        inline: false,
      }
    )
    .setTimestamp(new Date());
}

function nextDayLabel(eventKey) {
  const order = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const index = order.indexOf(eventKey);
  const nextKey = order[(index + 1) % order.length];
  return EVENT_LABELS[nextKey] || nextKey;
}

function buildCheckinButtons(eventKey, event) {
  const disabled = !canAcceptCheckinActions(event);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`checkin_join:${eventKey}`)
      .setLabel('⬆️ Anmelden')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`checkin_leave:${eventKey}`)
      .setLabel('⬇️ Abmelden')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(event.status === 'cancelled' || event.status === 'reset')
  );
}

function buildCheckinMessagePayload(eventKey, event, settings) {
  const bannerAttachment = getBannerAttachment(settings);
  const bannerEmbed = buildBannerEmbed(bannerAttachment);
  const embeds = [bannerEmbed, buildCheckinEmbed(eventKey, event, settings)].filter(Boolean);

  return {
    embeds,
    components: [buildCheckinButtons(eventKey, event)],
    files: bannerAttachment ? [bannerAttachment] : [],
  };
}

module.exports = {
  buildCheckinMessagePayload,
};
