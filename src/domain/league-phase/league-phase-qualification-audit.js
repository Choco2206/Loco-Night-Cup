'use strict';

const { EmbedBuilder } = require('discord.js');
const { readEventData, updateEventData } = require('../events/event-repository');
const { explainGroupOrder, rankGroupRows } = require('../groups/group-ranking');
const { findTeamById } = require('../teams/team-service');

function teamName(row) {
  return row?.displayName || findTeamById(row?.teamId)?.clubName || row?.teamId || 'Unbekanntes Team';
}

function signed(value) {
  const number = Number(value || 0);
  return number >= 0 ? `+${number}` : String(number);
}

function formatReason(first, second, reason) {
  const firstName = teamName(first);
  const secondName = teamName(second);
  if (reason.criterion === 'goalsAgainst') {
    return `**${firstName}** vor **${secondName}**: ${reason.label} (${reason.firstValue} statt ${reason.secondValue}).`;
  }
  return `**${firstName}** vor **${secondName}**: ${reason.label} (${reason.firstValue} zu ${reason.secondValue}).`;
}

function buildQualificationAudit(event) {
  const phase = event?.leaguePhase;
  const rows = rankGroupRows(phase).filter(row => row.teamId);
  const rankingLines = rows.map((row, index) => (
    `${String(index + 1).padStart(2, '0')}. ${index < 8 ? 'âœ…' : 'âŒ'} **${teamName(row)}** â€” ${Number(row.points || 0)} P | TD ${signed(row.goalDifference)} | Tore ${Number(row.goalsFor || 0)}:${Number(row.goalsAgainst || 0)}`
  ));

  const decisions = [];
  for (let index = 0; index < rows.length - 1; index += 1) {
    const first = rows[index];
    const second = rows[index + 1];
    if (Number(first.points || 0) !== Number(second.points || 0)) continue;
    decisions.push(formatReason(first, second, explainGroupOrder(phase, first, second, rows)));
  }

  const eighth = rows[7] || null;
  const ninth = rows[8] || null;
  const cutoff = eighth && ninth
    ? [
      `**Platz 8: ${teamName(eighth)} ist qualifiziert.**`,
      `**Platz 9: ${teamName(ninth)} ist ausgeschieden.**`,
      formatReason(eighth, ninth, explainGroupOrder(phase, eighth, ninth, rows)),
    ].join('\n')
    : 'Die Grenze zwischen Platz 8 und Platz 9 konnte nicht dargestellt werden.';

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xE31B23)
        .setTitle('ðŸ”’ Berechnung Weiterkommen â€” Ligaphase')
        .setDescription([
          'Interne Abschlussberechnung fÃ¼r Admins und Turnierleitung.',
          '',
          '**Reihenfolge der Kriterien:** Punkte â†’ Tordifferenz â†’ erzielte Tore â†’ weniger Gegentore â†’ direkter Vergleich/Mini-Tabelle â†’ deterministischer Losentscheid.',
          '',
          ...rankingLines,
        ].join('\n')),
      new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('Entscheidung an der Qualifikationsgrenze')
        .setDescription(cutoff)
        .addFields({
          name: 'Weitere Entscheidungen bei Punktgleichheit',
          value: decisions.length ? decisions.join('\n').slice(0, 1024) : 'Keine punktgleichen direkt aufeinanderfolgenden Teams.',
        })
        .setTimestamp(new Date(phase?.completedAt || Date.now())),
    ],
    allowedMentions: { parse: [] },
  };
}

async function postQualificationAudit({ client, eventKey, ensureChannel }) {
  const event = readEventData(eventKey);
  const channel = await ensureChannel(event);
  if (!channel?.send) throw new Error('Kanal berechnung-weiterkommen wurde nicht gefunden.');
  const payload = buildQualificationAudit(event);
  let message = event.leaguePhase?.qualificationAuditMessageId
    ? await channel.messages.fetch(event.leaguePhase.qualificationAuditMessageId).catch(() => null)
    : null;
  message = message ? await message.edit(payload) : await channel.send(payload);
  updateEventData(eventKey, stored => {
    stored.leaguePhase.calculationChannelId = channel.id;
    stored.leaguePhase.qualificationAuditMessageId = message.id;
    stored.leaguePhase.qualificationAuditPostedAt = new Date().toISOString();
    return stored;
  });
  return { channelId: channel.id, messageId: message.id };
}

module.exports = { buildQualificationAudit, postQualificationAudit };

