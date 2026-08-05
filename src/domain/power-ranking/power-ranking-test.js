'use strict';

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { findTeamById } = require('../teams/team-service');
const { getWeekWindow } = require('./power-ranking-core');
const { getRanking } = require('./power-ranking-service');
const { renderChampionGraphic } = require('./power-ranking-renderer');

function buildTestChampion(team, week) {
  const rankingTeam = getRanking(week.weekKey).teams.find(entry => String(entry.teamId) === String(team.id));
  return {
    teamId: String(team.id),
    teamName: team.clubName,
    points: rankingTeam?.points ?? 24,
    wins: rankingTeam?.wins ?? 2,
    finalAppearances: rankingTeam?.finalAppearances ?? 3,
    cups: rankingTeam?.cups ?? 4,
  };
}

async function postPowerRankingChampionTest({ guild, teamId, now = new Date() }) {
  if (!guild?.channels?.fetch) throw new Error('Server konnte nicht geladen werden.');
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');

  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.send) throw new Error(`Grafik-Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);

  const week = getWeekWindow(now);
  const champion = buildTestChampion(team, week);
  const graphic = await renderChampionGraphic({ week, champion, logoSnapshot: team.logo || null });
  const attachment = new AttachmentBuilder(graphic.buffer, { name: graphic.fileName });
  const embed = new EmbedBuilder()
    .setColor(0xf4c542)
    .setTitle('🧪 Champion der Woche – Grafiktest')
    .setDescription(`Testdarstellung für **${team.clubName}**. Die echte Rangliste und der Wochenabschluss bleiben unverändert.`)
    .setImage(`attachment://${graphic.fileName}`);
  const message = await channel.send({ embeds: [embed], files: [attachment] });

  return {
    channelId: channel.id,
    messageId: message.id,
    teamId: String(team.id),
    teamName: team.clubName,
  };
}

module.exports = { buildTestChampion, postPowerRankingChampionTest };
