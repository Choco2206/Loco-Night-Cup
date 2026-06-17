'use strict';

const { EmbedBuilder } = require('discord.js');
const { findTeamById } = require('../teams/team-service');

const STATUS_LABELS = {
  not_released: 'Noch nicht freigegeben',
  open: 'Offen',
  pending_confirmation: 'Wartet auf Bestaetigung',
  admin_decision_required: 'Admin-Entscheidung erforderlich',
  confirmed: 'Bestaetigt',
  bye: 'Freilos / spielfrei',
};

function mentionUser(userId) {
  return userId ? `<@${userId}>` : null;
}

function formatTeamUsers(team) {
  if (!team || team.isTestTeam) return 'Keine echten User hinterlegt';

  const manager = mentionUser(team.manager?.userId);
  const coManagers = (team.coManagers || [])
    .map(coManager => mentionUser(coManager.userId))
    .filter(Boolean);

  const lines = [];
  if (manager) lines.push(`Manager: ${manager}`);
  if (coManagers.length) lines.push(`Co-Manager: ${coManagers.join(', ')}`);
  return lines.length ? lines.join('\n') : 'Keine echten User hinterlegt';
}

function formatSlotName(slot) {
  if (slot.type === 'bye') return 'Freilos / spielfrei';
  return slot.displayName || findTeamById(slot.teamId)?.clubName || slot.teamId || 'Team';
}

function buildTeamOverviewEmbed(group) {
  const embed = new EmbedBuilder()
    .setTitle(`${group.name || `Gruppe ${group.groupKey}`} - Teamuebersicht`)
    .setColor(0x2f80ed)
    .setTimestamp(new Date());

  for (const slot of group.slots || []) {
    if (slot.type === 'bye') {
      embed.addFields({
        name: `${slot.slot}. Freilos / spielfrei`,
        value: 'Platzhalter, kann spaeter durch einen Nachruecker ersetzt werden.',
        inline: false,
      });
      continue;
    }

    const team = findTeamById(slot.teamId);
    embed.addFields({
      name: `${slot.slot}. ${formatSlotName(slot)}`,
      value: formatTeamUsers(team),
      inline: false,
    });
  }

  return embed;
}

function buildLiveTableEmbed(group) {
  const rows = (group.standings || [])
    .slice()
    .sort((a, b) => (
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.goalsAgainst - b.goalsAgainst ||
      String(a.displayName || '').localeCompare(String(b.displayName || ''), 'de', { sensitivity: 'base' })
    ));

  const table = rows.length
    ? rows.map((row, index) => {
      const name = row.displayName || findTeamById(row.teamId)?.clubName || row.teamId || row.participantKey;
      return [
        `${index + 1}. ${name}`,
        `${row.played} Sp`,
        `${row.wins} S`,
        `${row.draws} U`,
        `${row.losses} N`,
        `${row.goalsFor}:${row.goalsAgainst}`,
        `TD ${row.goalDifference}`,
        `${row.points} Pkt`,
      ].join(' | ');
    }).join('\n')
    : 'Noch keine echten Teams in dieser Gruppe.';

  return new EmbedBuilder()
    .setTitle(`${group.name || `Gruppe ${group.groupKey}`} - Live-Tabelle`)
    .setColor(0x27ae60)
    .setDescription(table)
    .setFooter({ text: 'Freilose werden nicht in der Tabelle gefuehrt.' })
    .setTimestamp(new Date());
}

function formatParticipant(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'Freilos / spielfrei';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || 'Team';
}

function formatResult(match) {
  if (!match.result) return '';
  return ` - ${match.result.homeGoals}:${match.result.awayGoals}`;
}

function formatMatch(match) {
  const status = STATUS_LABELS[match.status] || match.status || 'Offen';
  const pairing = `${formatParticipant(match.home)} vs. ${formatParticipant(match.away)}`;
  return `- ${pairing} - ${status}${formatResult(match)}`;
}

function buildScheduleEmbed(group) {
  const lines = [];
  for (const matchday of group.matchdays || []) {
    lines.push(`**Spieltag ${matchday.matchday}**`);
    for (const match of matchday.matches || []) {
      lines.push(formatMatch(match));
    }
    lines.push('');
  }

  return new EmbedBuilder()
    .setTitle(`${group.name || `Gruppe ${group.groupKey}`} - Spielplan`)
    .setColor(0xf2c94c)
    .setDescription(lines.join('\n').trim() || 'Noch kein Spielplan vorhanden.')
    .setFooter({ text: 'Freilose sind Platzhalter und erzeugen keine automatische Wertung.' })
    .setTimestamp(new Date());
}

module.exports = {
  STATUS_LABELS,
  buildLiveTableEmbed,
  buildScheduleEmbed,
  buildTeamOverviewEmbed,
};
