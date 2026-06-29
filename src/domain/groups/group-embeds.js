'use strict';

const { EmbedBuilder } = require('discord.js');
const { findTeamById } = require('../teams/team-service');
const { TOURNAMENT_FORMATS } = require('../../app/constants');
const { rankGroupRows } = require('./group-ranking');

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
  const rows = rankGroupRows(group);

  const byes = (group.slots || []).filter(slot => slot.type === 'bye');
  const tableRows = [
    '#  Team              Sp  S  U  N  TD  Pkt',
    '\u2500'.repeat(41),
    ...rows.map((row, index) => formatStandingRow(index + 1, {
      name: row.displayName || findTeamById(row.teamId)?.clubName || row.teamId || row.participantKey,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      goalDifference: row.goalDifference,
      points: row.points,
    })),
    ...byes.map((_, index) => formatByeRow(rows.length + index + 1)),
  ];

  const table = `\`\`\`txt\n${tableRows.join('\n')}\n\`\`\``;
  const qualification = getQualificationText(group.formatSize);

  return new EmbedBuilder()
    .setTitle(`${group.name || `Gruppe ${group.groupKey}`} - Live-Tabelle`)
    .setColor(0x27ae60)
    .setDescription(`${table}\n${qualification}`)
    .setFooter({ text: 'Freilose sind Platzhalter und haben keine Tabellenwirkung.' })
    .setTimestamp(new Date());
}

function truncateTeamName(name, width = 16) {
  const clean = String(name || 'Team').trim();
  if (clean.length <= width) return clean.padEnd(width, ' ');
  return `${clean.slice(0, width - 1)}~`;
}

function formatStandingRow(place, row) {
  return [
    String(place).padEnd(2, ' '),
    truncateTeamName(row.name),
    String(row.played).padStart(2, ' '),
    String(row.wins).padStart(2, ' '),
    String(row.draws).padStart(2, ' '),
    String(row.losses).padStart(2, ' '),
    String(row.goalDifference).padStart(3, ' '),
    String(row.points).padStart(3, ' '),
  ].join(' ');
}

function formatByeRow(place) {
  return [
    String(place).padEnd(2, ' '),
    truncateTeamName('Freilos'),
    ' -',
    ' -',
    ' -',
    ' -',
    '  -',
    '  -',
  ].join(' ');
}

function getQualificationText(formatSize) {
  const config = TOURNAMENT_FORMATS[Number(formatSize)];
  if (config?.bestFourths) {
    return `\u{1f3c6} Weiterkommen: Platz 1 & 2 + die ${config.bestThirds} besten Drittplatzierten + der beste Viertplatzierte`;
  }
  if (config?.bestThirds) {
    return `\u{1f3c6} Weiterkommen: Platz 1 & 2 + die ${config.bestThirds} besten Drittplatzierten`;
  }
  return '\u{1f3c6} Weiterkommen: Platz 1 & 2';
}

function formatParticipant(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'Freilos / spielfrei';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || 'Team';
}

function formatParticipantKey(participant) {
  if (!participant) return null;
  if (participant.participantKey) return participant.participantKey;
  if (participant.type === 'team') return `team:${participant.teamId}`;
  if (participant.type === 'bye') return `bye:${participant.byeId}`;
  return null;
}

function hasResult(match) {
  return match.result
    && Number.isFinite(Number(match.result.homeGoals))
    && Number.isFinite(Number(match.result.awayGoals));
}

function isByeMatch(match) {
  return match.home?.type === 'bye' || match.away?.type === 'bye' || match.status === 'bye';
}

function formatByeMatch(match) {
  const team = match.home?.type === 'team' ? match.home : match.away;
  return `${'\ud83c\udf9f\ufe0f'} ${formatParticipant(team)} \u2014 spielfrei`;
}

function formatConfirmedMatch(match, homeName, awayName) {
  if (!hasResult(match)) return `${'\u2705'} ${homeName} vs ${awayName} \u2014 Bestaetigt`;
  return `${'\u2705'} ${homeName} ${match.result.homeGoals}:${match.result.awayGoals} ${awayName} \u2014 Bestaetigt`;
}

function formatPendingMatch(match, homeName, awayName) {
  const reported = new Set((match.reports || []).map(report => report.participantKey).filter(Boolean));
  const candidates = [match.home, match.away].filter(participant => participant?.type === 'team');
  const waiting = candidates.find(participant => !reported.has(formatParticipantKey(participant)));
  const waitingName = waiting ? formatParticipant(waiting) : 'Gegner';
  return `${'\ud83d\udd50'} ${homeName} vs ${awayName} \u2014 Wartet auf ${waitingName}`;
}

function formatMatch(match) {
  if (isByeMatch(match)) return formatByeMatch(match);

  const homeName = formatParticipant(match.home);
  const awayName = formatParticipant(match.away);
  const released = Boolean(match.release?.releasedAt);
  const effectiveStatus = match.home?.type === 'team' && match.away?.type === 'team' && !released
    ? 'not_released'
    : match.status;

  if (effectiveStatus === 'confirmed') return formatConfirmedMatch(match, homeName, awayName);
  if (effectiveStatus === 'pending_confirmation') return formatPendingMatch(match, homeName, awayName);
  if (effectiveStatus === 'admin_decision_required') return `${'\ud83d\udea8'} ${homeName} vs ${awayName} \u2014 Admin-Entscheidung erforderlich`;
  if (effectiveStatus === 'not_released') return `${'\ud83d\udd12'} ${homeName} vs ${awayName} \u2014 Noch nicht freigegeben`;
  return `${'\u23f3'} ${homeName} vs ${awayName} \u2014 Offen`;
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

  const scheduleText = lines.join('\n').trim() || 'Noch kein Spielplan vorhanden.';

  return new EmbedBuilder()
    .setTitle(`${group.name || `Gruppe ${group.groupKey}`} - Spielplan`)
    .setColor(0xf2c94c)
    .setDescription(`${scheduleText}\n\n\u26a0\ufe0f Beide Teams muessen das Ergebnis eintragen. Sobald alle Ergebnisse dieses Slots final bestaetigt sind, wird automatisch der naechste Slot freigegeben.`)
    .setFooter({ text: 'Freilose sind Platzhalter und werden nicht als echtes Match gespielt.' })
    .setTimestamp(new Date());
}

module.exports = {
  STATUS_LABELS,
  buildLiveTableEmbed,
  buildScheduleEmbed,
  buildTeamOverviewEmbed,
};
