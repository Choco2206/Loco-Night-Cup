'use strict';

const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { ROOT_DIR } = require('../../storage');
const { listVisibleTeams } = require('../teams/team-service');
const { createGroupMatchdays } = require('../groups/group-matches');
const { HALL_OF_FAME_TEST_CHANNEL_ID, buildLocoZwergenCupCeremonyText } = require('../ceremony/ceremony-test-service');
const { renderLocoZwergenCupCeremonyImage } = require('../../../utils/loco-zwergen-cup-ceremony-renderer');
const { generateLocoZwergenCupLiveTableImage } = require('../../../utils/generateLocoZwergenCupLiveTableImage');
const { generateLocoZwergenCupMatchesImage } = require('../../../utils/generateLocoZwergenCupMatchesImage');
const { renderKoImage } = require('../../../utils/ko-image-renderer');
const { renderTeamOfTheTournament } = require('../../../utils/team-of-the-tournament-renderer');
const { renderSpecialAwards } = require('../../../utils/special-awards-renderer');
const {
  buildIntroText,
  buildTestPerformances,
  selectSpecialAwards,
} = require('../team-of-the-tournament/team-of-the-tournament-post');

const TEST_EVENT_ID = 'saturday_2026-09-12';

function availableTeams() {
  const teams = listVisibleTeams().filter(team => team?.status === 'active' && team?.clubName);
  if (!teams.length) throw new Error('Für den Loco-Zwergen-Cup-Grafiktest wird mindestens ein aktives Team benötigt.');
  return teams;
}
function cycleTeams(teams, count) { return Array.from({ length: count }, (_, index) => teams[index % teams.length]); }
function participant(team, index = 0) {
  return { type: 'team', teamId: String(team.id), displayName: team.clubName, participantKey: `team:${team.id}:zwergentest:${index}` };
}
function buildLiveRows(teams) {
  return cycleTeams(teams, 4).map((team, index) => ({
    teamId: String(team.id), name: team.clubName, played: 3,
    wins: Math.max(0, 3 - index), draws: index % 2, losses: index,
    goalDifference: 8 - index * 4, points: Math.max(1, 9 - index * 2), isBye: false,
  }));
}
function buildGroup(teams) {
  const four = cycleTeams(teams, 4);
  const group = { groupKey: 'A', slots: four.map((team, index) => ({ ...participant(team, index), slot: index + 1 })), matchdays: [] };
  group.matchdays = createGroupMatchdays({ eventKey: 'loco_zwergen_cup_graphics_test', group, createdAt: new Date().toISOString() });
  let sequence = 0;
  for (const matchday of group.matchdays) for (const match of matchday.matches) {
    sequence += 1;
    match.status = 'confirmed';
    match.result = { homeGoals: sequence % 5, awayGoals: (sequence + 2) % 4, source: 'loco_zwergen_cup_admin_graphics_test' };
  }
  return group;
}
function buildKoMatches(teams, count) {
  const pool = cycleTeams(teams, count * 2);
  return Array.from({ length: count }, (_, index) => ({
    id: `zwergen_graphics_test_${count}_${index + 1}`,
    home: participant(pool[index * 2], index * 2), away: participant(pool[index * 2 + 1], index * 2 + 1),
    status: 'confirmed', result: { homeGoals: (index + 1) % 5, awayGoals: (index + 3) % 4, source: 'loco_zwergen_cup_admin_graphics_test' },
  }));
}
function buildTottSelection(teams) {
  const logoTeams = teams.filter(team => team?.logo?.fileName);
  if (!logoTeams.length) throw new Error('Für den TOTT-Grafiktest wird mindestens ein aktives Team mit Logo benötigt.');
  const names = ['Mini-Messi', 'Klein-Klose', 'Gimli', 'Wusel', 'Zipfel', 'Flitzer', 'Pilzkopf', 'Hackebeil', 'Knirps', 'Fels', 'Zwergen-Kahn'];
  let cursor = 0;
  const make = count => Array.from({ length: count }, () => {
    const team = logoTeams[cursor % logoTeams.length];
    const player = { teamId: String(team.id), playerId: `zwergen-test-${cursor + 1}`, playerName: names[cursor], matches: 4, averageRating: Number((7.1 + (cursor % 7) * 0.31).toFixed(2)) };
    cursor += 1;
    return player;
  });
  return { goalkeeper: make(1), defender: make(3), midfielder: make(5), forward: make(2) };
}
async function sendImage(channel, title, image, fileName) {
  const buffer = Buffer.isBuffer(image) ? image : image.buffer;
  const message = await channel.send({ content: `🧪 **${title}**`, files: [new AttachmentBuilder(buffer, { name: fileName || image.fileName || `zwergen-test-${Date.now()}.png` })], allowedMentions: { parse: [] } });
  return message.id;
}

async function postLocoZwergenCupGraphicsTest({ guild }) {
  if (!guild) throw new Error('Der Loco-Zwergen-Cup-Grafiktest ist nur auf dem Server nutzbar.');
  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.() || !channel?.send) throw new Error(`Admin-Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);
  const teams = availableTeams();
  const messageIds = [];
  const intro = await channel.send({ content: '🧪 **LOCO ZWERGEN CUP • KOMPLETTER GRAFIKTEST**\n\nNur Vorschau. Es werden keine Turnierdaten, Ergebnisse, Siege, Statistiken oder Rollen verändert.', allowedMentions: { parse: [] } });
  messageIds.push(intro.id);
  const checkin = path.join(ROOT_DIR, 'assets', 'loco-zwerge-cup', 'check-in.jpeg');
  const checkinMessage = await channel.send({ content: '🧪 **Check-in-Banner**', files: [new AttachmentBuilder(checkin, { name: 'loco-zwergen-cup-test-check-in.jpeg' })], allowedMentions: { parse: [] } });
  messageIds.push(checkinMessage.id);
  messageIds.push(await sendImage(channel, 'Live-Tabelle • Gruppe A', await generateLocoZwergenCupLiveTableImage({ groupKey: 'A', rows: buildLiveRows(teams), qualificationText: 'Platz 1 & 2 qualifizieren sich' }), 'loco-zwergen-cup-test-live-table.png'));
  const group = buildGroup(teams);
  messageIds.push(await sendImage(channel, 'Matches • 3 Spieltage × 2 Begegnungen', await generateLocoZwergenCupMatchesImage({ group })));
  for (const [phase, count, label] of [
    ['round_of_16', 8, 'Achtelfinale'], ['quarter_final', 4, 'Viertelfinale'],
    ['semi_final', 2, 'Halbfinale'], ['third_place', 1, 'Spiel um Platz 3'], ['final', 1, 'Finale'],
  ]) {
    const image = await renderKoImage({ phase, matches: buildKoMatches(teams, count), eventId: TEST_EVENT_ID, version: `admin-test-${Date.now()}` });
    messageIds.push(await sendImage(channel, `${label} • ${count} Begegnung${count === 1 ? '' : 'en'}`, image));
  }
  const podium = cycleTeams(teams, 3);
  const ceremonyTeams = { first: podium[0], second: podium[1], third: podium[2] };
  messageIds.push(await sendImage(channel, 'Siegerehrung • Bild', await renderLocoZwergenCupCeremonyImage({ teams: ceremonyTeams }), 'loco-zwergen-cup-test-ceremony.png'));
  const textMessage = await channel.send({ content: `🧪 **Siegerehrung • Textvorschau**\n\n${buildLocoZwergenCupCeremonyText({ teams: ceremonyTeams })}`, allowedMentions: { parse: [] } });
  messageIds.push(textMessage.id);
  const selection = buildTottSelection(teams);
  const tott = await renderTeamOfTheTournament({ selection, serialNumber: 99, variant: 'loco_zwergen_cup' });
  const tottMessage = await channel.send({
    content: buildIntroText({ test: true, variant: 'loco_zwergen_cup' }),
    files: [new AttachmentBuilder(tott.buffer, { name: 'loco-zwergen-cup-test-team-of-the-tournament.png' })],
    allowedMentions: { parse: [] },
  });
  messageIds.push(tottMessage.id);
  const awards = selectSpecialAwards(buildTestPerformances(selection));
  messageIds.push(await sendImage(channel, 'Special Awards', await renderSpecialAwards({ awards, serialNumber: 99, variant: 'loco_zwergen_cup' }), 'loco-zwergen-cup-test-special-awards.png'));
  return { channelId: channel.id, messageIds, teamCount: teams.length };
}

module.exports = { buildTottSelection, postLocoZwergenCupGraphicsTest };
