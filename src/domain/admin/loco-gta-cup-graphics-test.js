'use strict';

const path = require('node:path');
const { ROOT_DIR } = require('../../storage');
const { GTA_CUP_KEY, GTA_CUP_DATE } = require('../events/loco-gta-cup-config');
const { listVisibleTeams } = require('../teams/team-service');
const { createGroupMatchdays } = require('../groups/group-matches');
const { getQualificationText } = require('../groups/group-embeds');
const { HALL_OF_FAME_TEST_CHANNEL_ID, buildLocoGtaCupCeremonyText } = require('../ceremony/ceremony-test-service');
const { generateLocoGtaCupLiveTableImage } = require('../../../utils/generateLocoZwergenCupLiveTableImage');
const { generateLocoGtaCupMatchesImage } = require('../../../utils/generateLocoZwergenCupMatchesImage');
const { renderKoImage } = require('../../../utils/ko-image-renderer');
const { renderLocoGtaProgression } = require('../../../utils/ko-progression-renderer');
const { renderLocoGtaCupCeremonyImage } = require('../../../utils/loco-gta-cup-ceremony-renderer');
const { renderTeamOfTheTournament } = require('../../../utils/team-of-the-tournament-renderer');
const { renderSpecialAwards } = require('../../../utils/special-awards-renderer');
const { buildIntroText, buildTestPerformances, selectSpecialAwards } = require('../team-of-the-tournament/team-of-the-tournament-post');

const rounds = [
  ['round_of_32', 16, 'Sechzehntelfinale'], ['round_of_16', 8, 'Achtelfinale'],
  ['quarter_final', 4, 'Viertelfinale'], ['semi_final', 2, 'Halbfinale'], ['final', 1, 'Finale'],
];

function participant(team, index) {
  return { type: 'team', teamId: String(team.id), displayName: team.clubName, participantKey: `gta-test:${index}` };
}

function confirm(match, index) {
  return { ...match, status: 'confirmed', result: { homeGoals: 2 + index % 4, awayGoals: index % 2 } };
}

async function postLocoGtaCupGraphicsTest({ guild }) {
  const channel = await guild?.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.send) throw new Error('Admin-Testkanal nicht erreichbar.');
  const teams = listVisibleTeams().filter(team => team.status === 'active' && team.clubName);
  if (!teams.length) throw new Error('Für die Vorschau wird mindestens ein aktives Team benötigt.');
  const logoTeams = teams.filter(team => team.logo?.fileName);
  const pool = logoTeams.length ? logoTeams : teams;
  const roster = Array.from({ length: 32 }, (_, index) => participant(pool[index % pool.length], index));
  const group = { groupKey: 'A', slots: roster.slice(0, 4).map((team, index) => ({ ...team, slot: index + 1 })) };
  group.matchdays = createGroupMatchdays({ eventKey: GTA_CUP_KEY, group, createdAt: new Date().toISOString() })
    .map(day => ({ ...day, matches: day.matches.map(confirm) }));
  const rows = group.slots.map((team, index) => ({
    teamId: team.teamId, name: team.displayName, played: 3, wins: 3 - index,
    losses: index, goalDifference: 6 - index * 4, points: (3 - index) * 3,
  }));
  const bracket = {};
  let advancing = roster;
  let semifinalLosers;
  for (const [key, count] of rounds) {
    const matches = Array.from({ length: count }, (_, index) => confirm({
      home: advancing[index * 2], away: advancing[index * 2 + 1],
    }, index));
    bracket[key] = { matches };
    if (key === 'semi_final') semifinalLosers = matches.map(match => match.away);
    advancing = matches.map(match => match.home);
  }
  bracket.third_place = { matches: [confirm({ home: semifinalLosers[0], away: semifinalLosers[1] }, 0)] };
  const ceremonyTeams = { first: pool[0], second: pool[16 % pool.length], third: pool[8 % pool.length] };
  let cursor = 0;
  const players = count => Array.from({ length: count }, () => {
    const index = cursor++;
    return { teamId: roster[index].teamId, playerId: `gta-test-${index}`, playerName: `ViceCityPlayer${index + 1}`, matches: 4, averageRating: 7 + index / 10 };
  });
  const selection = { goalkeeper: players(1), defender: players(3), midfielder: players(5), forward: players(2) };
  const eventId = `${GTA_CUP_KEY}_${GTA_CUP_DATE}`;
  const renderOptions = { eventKey: GTA_CUP_KEY, eventDate: GTA_CUP_DATE, serialNumber: 66 };
  let posted = 0;
  const failed = [];
  async function post(label, render, content = '') {
    try {
      const image = await render();
      await channel.send({
        content: `🧪 **${label}**${content ? `\n\n${content}` : ''}`,
        files: [{ attachment: Buffer.isBuffer(image) ? image : image.buffer, name: image.fileName || `gta-test-${posted + 1}.png` }],
        allowedMentions: { parse: [] },
      });
      posted += 1;
    } catch (error) {
      console.error(`[gta-graphics-test] ${label}`, error);
      failed.push(label);
    }
  }

  await post('Check-in-Banner', () => ({
    buffer: path.join(ROOT_DIR, 'assets/loco-gta-vi-cup/check-in.jpeg'), fileName: 'gta-test-check-in.jpeg',
  }));
  await post('Live-Tabelle', () => generateLocoGtaCupLiveTableImage({
    groupKey: 'A', rows, qualificationText: getQualificationText(44, GTA_CUP_KEY),
  }));
  await post('Gruppenspielplan', () => generateLocoGtaCupMatchesImage({ group }));
  for (const [phase, , label] of [...rounds, ['third_place', 1, 'Spiel um Platz 3']]) {
    await post(label, () => renderKoImage({ phase, eventId, matches: bracket[phase].matches }));
  }
  for (const [firstRoundKey, count] of rounds.slice(0, 4)) {
    const qualifiedTeams = bracket[firstRoundKey].matches.flatMap(match => [match.home, match.away]);
    await post(`K.O.-Qualifikation · ${count * 2} Teams`, () => renderKoImage({
      phase: 'qualification_overview', eventId, qualifiedTeams,
    }));
    await post(`Road to Glory · ${count * 2} Teams`, () => renderLocoGtaProgression({ firstRoundKey, rounds: bracket }));
  }
  await post('Siegerehrung', () => renderLocoGtaCupCeremonyImage({ teams: ceremonyTeams }),
    buildLocoGtaCupCeremonyText({ teams: ceremonyTeams }));
  await post('Team of the Tournament', () => renderTeamOfTheTournament({ ...renderOptions, selection }),
    buildIntroText(renderOptions));
  await post('Special Awards', () => renderSpecialAwards({
    ...renderOptions, awards: selectSpecialAwards(buildTestPerformances(selection)),
  }));
  return { channelId: channel.id, posted, failed };
}

module.exports = { postLocoGtaCupGraphicsTest };
