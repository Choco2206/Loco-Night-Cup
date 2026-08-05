'use strict';

const { AttachmentBuilder } = require('discord.js');
const { HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { findTeamById } = require('../teams/team-service');
const { getWeekWindow } = require('./power-ranking-core');
const { buildChampionPostContent, championContactUserIds } = require('./power-ranking-service');
const { renderChampionGraphic } = require('./power-ranking-renderer');

function buildTestChampion(team) {
  return {
    teamId: String(team.id),
    teamName: team.clubName,
    points: 24,
    wins: 3,
    finalAppearances: 4,
    cups: 7,
  };
}

async function postPowerRankingChampionTest({ guild, teamId, now = new Date() }) {
  if (!guild?.channels?.fetch) throw new Error('Server konnte nicht geladen werden.');
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');

  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.send) throw new Error(`Grafik-Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);

  const week = getWeekWindow(now);
  const champion = buildTestChampion(team);
  const graphic = await renderChampionGraphic({ week, champion, logoSnapshot: team.logo || null });
  const attachment = new AttachmentBuilder(graphic.buffer, { name: graphic.fileName });
  const contactIds = championContactUserIds(team);
  const message = await channel.send({
    content: buildChampionPostContent({ champion, week, team, test: true }),
    files: [attachment],
    allowedMentions: { parse: [], users: contactIds },
  });

  return {
    channelId: channel.id,
    messageId: message.id,
    teamId: String(team.id),
    teamName: team.clubName,
  };
}

module.exports = { buildTestChampion, postPowerRankingChampionTest };
