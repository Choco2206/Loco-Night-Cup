'use strict';

const { AttachmentBuilder } = require('discord.js');
const { listVisibleTeams } = require('../teams/team-service');
const { createGroupMatchdays } = require('../groups/group-matches');
const { HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const {
  buildBomberXLocoCeremonyText,
  renderBomberXLocoCeremonyImage,
} = require('../ceremony/bomber-x-loco-ceremony');
const { generateBomberXLocoLiveTableImage } = require('../../../utils/generateBomberXLocoLiveTableImage');
const { generateBomberXLocoMatchesImage } = require('../../../utils/generateBomberXLocoMatchesImage');
const { renderKoImage } = require('../../../utils/ko-image-renderer');
const { renderTeamOfTheTournament } = require('../../../utils/team-of-the-tournament-renderer');
const { renderSpecialAwards } = require('../../../utils/special-awards-renderer');
const {
  buildTestPerformances,
  selectSpecialAwards,
} = require('../team-of-the-tournament/team-of-the-tournament-post');

const BOMBER_X_LOCO_TEST_EVENT_ID = 'saturday_2026-09-19';

function availableTeams() {
  const teams = listVisibleTeams().filter(team => team?.status === 'active' && team?.clubName);
  if (!teams.length) throw new Error('Für den Bomber-X-Loco-Grafiktest wird mindestens ein aktives Team benötigt.');
  return teams;
}

function cycleTeams(teams, count) {
  return Array.from({ length: count }, (_, index) => teams[index % teams.length]);
}

function buildTottSelection(teams) {
  const logoTeams = teams.filter(team => team?.logo?.fileName);
  if (!logoTeams.length) {
    throw new Error('Für den TOTT-Grafiktest wird mindestens ein aktives Team mit gespeichertem Logo benötigt.');
  }
  const names = ['Nox', 'Viper', 'Ragnar', 'Kyro', 'Maverick', 'Nova', 'Ghost', 'Zeno', 'Blaze', 'Lynx', 'Ares'];
  let cursor = 0;
  const make = count => Array.from({ length: count }, () => {
    const team = logoTeams[cursor % logoTeams.length];
    const player = {
      teamId: String(team.id),
      playerId: `bxl-graphics-test-player-${cursor + 1}`,
      playerName: names[cursor],
      matches: 4,
      averageRating: Number((7.1 + ((cursor % 7) * 0.31)).toFixed(2)),
    };
    cursor += 1;
    return player;
  });
  return { goalkeeper: make(1), defender: make(3), midfielder: make(5), forward: make(2) };
}

function participant(team, index = 0) {
  return {
    type: 'team',
    teamId: String(team.id),
    displayName: team.clubName,
    participantKey: `team:${team.id}:bxltest:${index}`,
  };
}

function buildLiveRows(teams) {
  const six = cycleTeams(teams, 6);
  return six.map((team, index) => ({
    teamId: String(team.id),
    name: team.clubName,
    played: 5,
    wins: Math.max(0, 4 - Math.floor(index / 2)),
    draws: index % 2,
    losses: Math.min(4, index),
    goalDifference: 10 - (index * 4),
    points: Math.max(1, 13 - (index * 2)),
    isBye: false,
  }));
}

function buildGroup(teams) {
  const six = cycleTeams(teams, 6);
  const group = {
    groupKey: 'A',
    slots: six.map((team, index) => ({ ...participant(team, index), slot: index + 1 })),
    matchdays: [],
  };
  group.matchdays = createGroupMatchdays({
    eventKey: 'bomber_x_loco_graphics_test',
    group,
    createdAt: new Date().toISOString(),
  });
  let sequence = 0;
  for (const matchday of group.matchdays) {
    for (const match of matchday.matches) {
      sequence += 1;
      match.status = 'confirmed';
      match.result = {
        homeGoals: sequence % 5,
        awayGoals: (sequence + 2) % 4,
        source: 'bomber_x_loco_admin_graphics_test',
      };
    }
  }
  return group;
}

function buildKoMatches(teams, matchCount) {
  const pool = cycleTeams(teams, matchCount * 2);
  return Array.from({ length: matchCount }, (_, index) => ({
    id: `bxl_graphics_test_${matchCount}_${index + 1}`,
    matchIndex: index + 1,
    home: participant(pool[index * 2], index * 2),
    away: participant(pool[index * 2 + 1], index * 2 + 1),
    status: 'confirmed',
    result: {
      homeGoals: (index + 1) % 5,
      awayGoals: (index + 3) % 4,
      source: 'bomber_x_loco_admin_graphics_test',
    },
  }));
}

async function sendImage(channel, title, image, fileName) {
  const buffer = Buffer.isBuffer(image) ? image : image.buffer;
  const name = fileName || image.fileName || `bxl-test-${Date.now()}.png`;
  const message = await channel.send({
    content: `🧪 **${title}**`,
    files: [new AttachmentBuilder(buffer, { name })],
    allowedMentions: { parse: [] },
  });
  return message.id;
}

async function postBomberXLocoGraphicsTest({ guild }) {
  if (!guild) throw new Error('Bomber-X-Loco-Grafiktest ist nur auf dem Server nutzbar.');
  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.() || !channel?.send) {
    throw new Error(`Admin-Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);
  }

  const teams = availableTeams();
  const messageIds = [];
  const intro = await channel.send({
    content: [
      '🧪 **BOMBER X LOCO • KOMPLETTER GRAFIKTEST**',
      '',
      'Nur Vorschau – es werden keine Ergebnisse, Siege, Statistiken oder Rollen gespeichert.',
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
  messageIds.push(intro.id);

  const liveTable = await generateBomberXLocoLiveTableImage({ groupKey: 'A', rows: buildLiveRows(teams) });
  messageIds.push(await sendImage(channel, 'Live-Tabelle • Gruppe A', liveTable, 'bomber-x-loco-test-live-table.png'));

  const group = buildGroup(teams);
  const matches = await generateBomberXLocoMatchesImage({ group });
  messageIds.push(await sendImage(channel, 'Matches • 5 Spieltage × 3 Begegnungen', matches));

  const koRounds = [
    ['round_of_32', 16, 'Sechzehntelfinale • 16 Begegnungen'],
    ['round_of_16', 8, 'Achtelfinale • 8 Begegnungen'],
    ['quarter_final', 4, 'Viertelfinale • 4 Begegnungen'],
    ['semi_final', 2, 'Halbfinale • 2 Begegnungen'],
    ['third_place', 1, 'Spiel um Platz 3 • 1 Begegnung'],
    ['final', 1, 'Finale • 1 Begegnung'],
  ];

  for (const [phase, count, label] of koRounds) {
    const image = await renderKoImage({
      phase,
      matches: buildKoMatches(teams, count),
      eventId: BOMBER_X_LOCO_TEST_EVENT_ID,
      version: `admin-test-${Date.now()}`,
    });
    messageIds.push(await sendImage(channel, label, image));
  }

  const podium = cycleTeams(teams, 3);
  const ceremonyTeams = { first: podium[0], second: podium[1], third: podium[2] };
  const ceremonyImage = await renderBomberXLocoCeremonyImage({ teams: ceremonyTeams });
  messageIds.push(await sendImage(channel, 'Siegerehrung • Bild', ceremonyImage, 'bomber-x-loco-test-ceremony.png'));

  const ceremonyText = buildBomberXLocoCeremonyText({
    teams: ceremonyTeams,
    promotion: {
      name: '🥇 Loco Night Champion',
      previousGold: 0,
      nextGold: 1,
      threshold: 1,
    },
  });
  const textMessage = await channel.send({
    content: `🧪 **Siegerehrung • Textvorschau**\n\n${ceremonyText}`,
    allowedMentions: { parse: [] },
  });
  messageIds.push(textMessage.id);

  const tottSelection = buildTottSelection(teams);
  const tottImage = await renderTeamOfTheTournament({
    selection: tottSelection,
    variant: 'bomber_x_loco',
  });
  messageIds.push(await sendImage(
    channel,
    'Team of the Tournament • vollständig gefüllte Vorschau',
    tottImage,
    'bomber-x-loco-test-team-of-the-tournament.png',
  ));

  const awardPlayers = selectSpecialAwards(buildTestPerformances(tottSelection));
  const awardsImage = await renderSpecialAwards({
    awards: awardPlayers,
    variant: 'bomber_x_loco',
  });
  messageIds.push(await sendImage(
    channel,
    'Special Awards • vollständig gefüllte Vorschau',
    awardsImage,
    'bomber-x-loco-test-special-awards.png',
  ));

  return { channelId: channel.id, messageIds, teamCount: teams.length };
}

module.exports = { buildTottSelection, postBomberXLocoGraphicsTest };
