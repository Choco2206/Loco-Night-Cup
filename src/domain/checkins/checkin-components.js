'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { EVENT_LABELS } = require('../../app/constants');
const { findTeamById } = require('../teams/team-service');
const { canAcceptCheckinActions, getCheckinWindowLabel, getDeadlineAt } = require('./checkin-schedule');

function teamName(teamId) {
  const team = findTeamById(teamId);
  return team?.clubName || `Unbekanntes Team (${teamId})`;
}

function formatTeamLines(teamIds, emptyText) {
  if (!teamIds.length) return emptyText;

  const lines = teamIds.map((teamId, index) => `${index + 1}. ${teamName(teamId)}`);
  const output = [];
  let length = 0;

  for (const line of lines) {
    if (length + line.length + 1 > 950) {
      output.push(`... ${lines.length - output.length} weitere`);
      break;
    }
    output.push(line);
    length += line.length + 1;
  }

  return output.join('\n');
}

function formatDeadline(eventKey, event, settings) {
  const deadlineAt = getDeadlineAt(eventKey, event, settings);
  if (!deadlineAt) return 'nicht gesetzt';
  return deadlineAt.toLocaleString('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function buildCheckinEmbed(eventKey, event, settings) {
  const label = EVENT_LABELS[eventKey] || eventKey;
  const activeTeamIds = event.checkin?.activeTeamIds || [];
  const waitlistTeamIds = event.checkin?.waitlistTeamIds || [];
  const entries = event.checkin?.entries || [];
  const statusLabel = getCheckinWindowLabel(eventKey, event, settings);
  const formatSize = event.format?.size ? `${event.format.size}` : 'noch offen';
  const lockedLabel = event.format?.lockedAt ? 'ja' : 'nein';

  return new EmbedBuilder()
    .setTitle(`Loco Night Cup ${label}`)
    .setDescription('Oeffentlicher Check-in. Warteliste ist sichtbar und informativ.')
    .addFields(
      {
        name: 'Status',
        value: `${statusLabel}\nDeadline: ${formatDeadline(eventKey, event, settings)}\nFormat: ${formatSize}\nFormat-Lock: ${lockedLabel}`,
        inline: false,
      },
      {
        name: `Teams (${activeTeamIds.length})`,
        value: formatTeamLines(activeTeamIds, 'Noch keine Teams im aktiven Feld.'),
        inline: false,
      },
      {
        name: `Warteliste (${waitlistTeamIds.length})`,
        value: formatTeamLines(waitlistTeamIds, 'Keine Teams auf der Warteliste.'),
        inline: false,
      },
      {
        name: 'Check-ins gesamt',
        value: `${entries.length}`,
        inline: true,
      },
      {
        name: 'Mindestanzahl',
        value: `${event.format?.minimumRealTeams || settings.tournament?.minimumRealTeams || 8} echte Teams`,
        inline: true,
      }
    )
    .setTimestamp(new Date());
}

function buildCheckinButtons(eventKey, event) {
  const disabled = !canAcceptCheckinActions(event);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`checkin_join:${eventKey}`)
      .setLabel('Einchecken')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`checkin_leave:${eventKey}`)
      .setLabel('Abmelden')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(event.status === 'cancelled' || event.status === 'reset')
  );
}

function buildCheckinMessagePayload(eventKey, event, settings) {
  return {
    embeds: [buildCheckinEmbed(eventKey, event, settings)],
    components: [buildCheckinButtons(eventKey, event)],
  };
}

module.exports = {
  buildCheckinMessagePayload,
};
