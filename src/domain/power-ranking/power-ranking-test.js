'use strict';

const { AttachmentBuilder } = require('discord.js');
const { HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { findTeamById, listVisibleTeams } = require('../teams/team-service');
const { getWeekWindow } = require('./power-ranking-core');
const { buildChampionPostContent, championContactUserIds, rankingPages } = require('./power-ranking-service');
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

function buildFictionalRanking(teams, now = new Date()) {
  const changeLabels = ['▲ +2', '▼ -1', '– 0', '🆕 NEU'];
  return {
    cups: 7,
    lastUpdatedAt: now.toISOString(),
    teams: teams.map((team, index) => {
      const rank = index + 1;
      const cups = 7 - (index % 3);
      const wins = Math.max(0, 4 - Math.floor(index / 5));
      const finalAppearances = Math.min(cups, wins + 1 + (index % 2));
      return {
        rank,
        teamId: String(team.id),
        teamName: team.clubName,
        points: Math.max(8, 72 - (index * 3) - (index % 4)),
        cups,
        wins,
        finalAppearances,
        semifinalOrBetter: Math.min(cups, finalAppearances + 1 + (index % 2)),
        changeLabel: changeLabels[index % changeLabels.length],
      };
    }),
  };
}

async function postPowerRankingTest({ guild, now = new Date() }) {
  if (!guild?.channels?.fetch) throw new Error('Server konnte nicht geladen werden.');
  const teams = listVisibleTeams()
    .filter(team => team.status === 'active')
    .slice()
    .sort((left, right) => left.clubName.localeCompare(right.clubName, 'de', { sensitivity: 'base' }))
    .slice(0, 20);
  if (teams.length < 20) throw new Error(`Für den Power-Ranking-Test werden 20 aktive Teams benötigt. Gefunden: ${teams.length}.`);

  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.send) throw new Error(`Grafik-Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);

  const week = getWeekWindow(now);
  const ranking = buildFictionalRanking(teams, now);
  const pages = rankingPages(ranking, week);
  await channel.send({
    content: '🧪 **POWER-RANKING-TEST – fiktive Vorschau mit 20 Teams**\nDie echte Rangliste und gespeicherten Punkte bleiben unverändert.',
    allowedMentions: { parse: [] },
  });
  const messages = [];
  for (const content of pages) {
    messages.push(await channel.send({ content, allowedMentions: { parse: [] } }));
  }
  return { channelId: channel.id, teamCount: teams.length, messageCount: messages.length };
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

module.exports = { buildFictionalRanking, buildTestChampion, postPowerRankingChampionTest, postPowerRankingTest };
