'use strict';

const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { ROOT_DIR } = require('../../storage');
const { listVisibleTeams } = require('../teams/team-service');
const { CEREMONY_DAY_LABELS, HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { renderFc27CeremonyImage, resolveFc27TeamLogoPath } = require('../../../utils/fc27-ceremony-renderer');
const { renderSpecialAwards } = require('../../../utils/special-awards-renderer');
const { getWeekWindow } = require('../power-ranking/power-ranking-core');
const { renderChampionGraphic } = require('../power-ranking/power-ranking-renderer');
const { generateFc27LiveTableImage } = require('../../../utils/generateFc27LiveTableImage');
const { generateFc27GroupScheduleImage } = require('../../../utils/generateFc27GroupScheduleImage');
const { renderKoImage } = require('../../../utils/ko-image-renderer');
const { renderKoProgression16 } = require('../../../utils/ko-progression-renderer');

const DAYS = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
const REQUIRED_TEAM_COUNT = DAYS.length * 3;

function availableLogoTeams() {
  return listVisibleTeams()
    .filter(team => team?.status === 'active' && team?.clubName && resolveFc27TeamLogoPath(team))
    .sort((left, right) => String(left.clubName).localeCompare(String(right.clubName), 'de', { sensitivity: 'base' }));
}

function spreadTeams(teams, count) {
  if (teams.length <= count) return teams.slice(0, count);
  const selected = [];
  const used = new Set();
  for (let index = 0; index < count; index += 1) {
    let cursor = Math.floor(index * teams.length / count);
    while (used.has(cursor)) cursor = (cursor + 1) % teams.length;
    used.add(cursor);
    selected.push(teams[cursor]);
  }
  return selected;
}

function teamsForDay(pool, dayIndex) {
  const offset = dayIndex * 3;
  return { first: pool[offset], second: pool[offset + 1], third: pool[offset + 2] };
}

function buildFc27TestAwards(teams) {
  const samples = [
    ['goals', 'Knipser27', 16],
    ['assists', 'VorlagenBoss', 12],
    ['tacklesMade', 'Abräumer27', 23],
    ['saves', 'SafeHands', 31],
    ['cleanSheets', 'AbwehrChef', 5],
    ['passesMade', 'PassMaschine', 140],
    ['averageRating', 'MVPderNacht', 8.93],
    ['manOfTheMatch', 'Matchwinner', 4],
  ];
  return Object.fromEntries(samples.map(([key, playerName, value], index) => [key, {
    teamId: teams[index]?.id,
    playerId: `fc27-award-test-${index}`,
    playerName,
    [key]: value,
    averageRating: key === 'averageRating' ? value : 8.25,
  }]));
}

function buildFc27TestChampion(team) {
  return {
    teamId: String(team.id),
    teamName: team.clubName,
    points: 50,
    wins: 3,
    finalAppearances: 5,
    cups: 7,
  };
}

function buildFc27TestGroup(teams) {
  const participants = teams.slice(0, 4).map(team => ({
    type: 'team',
    teamId: String(team.id),
    participantKey: `team:${team.id}`,
    displayName: team.clubName,
  }));
  const pairings = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];
  return {
    groupKey: 'A',
    matchdays: pairings.map((day, dayIndex) => ({
      matchday: dayIndex + 1,
      matches: day.map(([home, away], matchIndex) => ({
        id: `fc27-test-${dayIndex + 1}-${matchIndex + 1}`,
        home: participants[home],
        away: participants[away],
        status: 'confirmed',
        release: { releasedAt: new Date().toISOString() },
        result: { homeGoals: dayIndex + matchIndex + 1, awayGoals: matchIndex, source: 'admin' },
      })),
    })),
  };
}

function fc27KoParticipant(team, index) {
  return {
    type: 'team',
    teamId: String(team.id),
    participantKey: `team:${team.id}:fc27-ko-test:${index}`,
    displayName: team.clubName,
  };
}

function buildFc27KoMatches(teams, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `fc27-ko-test-${count}-${index + 1}`,
    home: fc27KoParticipant(teams[(index * 2) % teams.length], index * 2),
    away: fc27KoParticipant(teams[(index * 2 + 1) % teams.length], index * 2 + 1),
    status: 'confirmed',
    result: { homeGoals: (index + 2) % 6, awayGoals: (index + 4) % 5, source: 'admin-random-test' },
  }));
}

function buildFc27ProgressionRounds(teams) {
  const participants = teams.slice(0, 16).map(fc27KoParticipant);
  const match = (id, home, away, homeGoals, awayGoals) => ({
    id: `fc27-progression-test-${id}`,
    home,
    away,
    status: 'confirmed',
    result: { homeGoals, awayGoals, source: 'admin-random-test' },
  });
  const roundOf16 = Array.from({ length: 8 }, (_, index) => match(
    `r16-${index + 1}`,
    participants[index * 2],
    participants[index * 2 + 1],
    index % 3 + 2,
    index % 3,
  ));
  const r16Winners = roundOf16.map(entry => entry.home);
  const quarterFinal = [
    match('qf-1', r16Winners[0], r16Winners[1], 3, 1),
    match('qf-2', r16Winners[2], r16Winners[3], 1, 2),
    match('qf-3', r16Winners[4], r16Winners[5], 2, 0),
    match('qf-4', r16Winners[6], r16Winners[7], 1, 3),
  ];
  const semiFinal = [
    match('sf-1', quarterFinal[0].home, quarterFinal[1].away, 2, 1),
    match('sf-2', quarterFinal[2].home, quarterFinal[3].away, 1, 3),
  ];
  return {
    round_of_16: { matches: roundOf16 },
    quarter_final: { matches: quarterFinal },
    semi_final: { matches: semiFinal },
    final: { matches: [match('final', semiFinal[0].home, semiFinal[1].away, 2, 1)] },
    third_place: { matches: [match('third', semiFinal[0].away, semiFinal[1].home, 3, 2)] },
  };
}

async function postFc27KoTestImage(channel, title, rendered) {
  const message = await channel.send({
    content: `🧪 **FC 27 • ${title}**\nNur Vorschau; die aktiven K.O.-Grafiken bleiben unverändert.`,
    files: [new AttachmentBuilder(rendered.buffer, { name: rendered.fileName })],
    allowedMentions: { parse: [] },
  });
  return message.id;
}

async function postFc27CeremonyGraphicsTest({ guild, now = new Date() }) {
  if (!guild) throw new Error('Der FC-27-Siegerehrungstest ist nur auf dem Server nutzbar.');
  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.() || !channel?.send) {
    throw new Error(`Admin-Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);
  }

  const available = availableLogoTeams();
  if (available.length < REQUIRED_TEAM_COUNT) {
    throw new Error(`Für sieben unterschiedliche Vorschauen werden mindestens ${REQUIRED_TEAM_COUNT} aktive Teams mit gespeicherter Logo-Datei benötigt. Gefunden: ${available.length}.`);
  }
  const pool = spreadTeams(available, REQUIRED_TEAM_COUNT);
  const messageIds = [];
  const intro = await channel.send({
    content: '🧪 **FC 27 • SIEGEREHRUNGEN MONTAG BIS SONNTAG**\n\nNur Vorschau. Jeder Tag verwendet drei andere registrierte Teams. Es werden keine Turnierdaten, Siege, Statistiken oder Rollen verändert.',
    allowedMentions: { parse: [] },
  });
  messageIds.push(intro.id);

  const checkinMessage = await channel.send({
    content: '🧪 **FC 27 • CHECK-IN**\nFeste FC-27-Vorlage ohne Änderung an einem echten Check-in.',
    files: [new AttachmentBuilder(path.resolve(ROOT_DIR, 'assets/banners/check-in-fc27.jpeg'), { name: 'check-in-fc27-test.jpeg' })],
    allowedMentions: { parse: [] },
  });
  messageIds.push(checkinMessage.id);

  for (const [dayIndex, dayKey] of DAYS.entries()) {
    const teams = teamsForDay(pool, dayIndex);
    const rendered = await renderFc27CeremonyImage({ dayKey, teams });
    const message = await channel.send({
      content: [
        `🧪 **FC 27 • ${CEREMONY_DAY_LABELS[dayKey]}**`,
        `🥇 ${teams.first.clubName}  •  🥈 ${teams.second.clubName}  •  🥉 ${teams.third.clubName}`,
      ].join('\n'),
      files: [new AttachmentBuilder(rendered.buffer, { name: `fc27-ceremony-test-${dayKey}.png` })],
      allowedMentions: { parse: [] },
    });
    messageIds.push(message.id);
  }

  const specialAwards = buildFc27TestAwards(pool.slice(0, 8));
  const awardsRendered = await renderSpecialAwards({ awards: specialAwards, serialNumber: 27, variant: 'fc27' });
  const awardsMessage = await channel.send({
    content: '🧪 **FC 27 • SPECIAL AWARDS**\nAcht unterschiedliche registrierte Teamlogos mit Testnamen und Testwerten.',
    files: [new AttachmentBuilder(awardsRendered.buffer, { name: 'special-awards-fc27-test.png' })],
    allowedMentions: { parse: [] },
  });
  messageIds.push(awardsMessage.id);

  const championTeam = pool[8] || pool[0];
  const championRendered = await renderChampionGraphic({
    week: getWeekWindow(now),
    champion: buildFc27TestChampion(championTeam),
    logoSnapshot: championTeam.logo || null,
    variant: 'fc27',
  });
  const championMessage = await channel.send({
    content: `🧪 **FC 27 • POWER-RANKING-CHAMPION**\nTestteam: ${championTeam.clubName}. Nur Vorschau; die aktive Wochenchampion-Grafik bleibt unverändert.`,
    files: [new AttachmentBuilder(championRendered.buffer, { name: 'power-ranking-champion-fc27-test.png' })],
    allowedMentions: { parse: [] },
  });
  messageIds.push(championMessage.id);

  const groupTeams = pool.slice(9, 13);
  const tableRows = groupTeams.map((team, index) => ({
    name: team.clubName,
    played: 3,
    wins: 3 - index,
    draws: index % 2,
    losses: index,
    goalDifference: 6 - index * 3,
    points: 9 - index * 2,
  }));
  const tableRendered = await generateFc27LiveTableImage({
    groupKey: 'A',
    rows: tableRows,
    qualificationText: 'Platz 1-2 + die 2 besten Drittplatzierten qualifizieren sich',
  });
  const tableMessage = await channel.send({
    content: '🧪 **FC 27 • LIVE-TABELLE**\nVier registrierte Teams mit Testwerten. Nur Vorschau.',
    files: [new AttachmentBuilder(tableRendered, { name: 'live-table-fc27-test.png' })],
    allowedMentions: { parse: [] },
  });
  messageIds.push(tableMessage.id);

  const scheduleRendered = await generateFc27GroupScheduleImage({ group: buildFc27TestGroup(groupTeams) });
  const scheduleMessage = await channel.send({
    content: '🧪 **FC 27 • MATCHES**\nDrei Spieltage mit jeweils zwei Begegnungen. Nur Vorschau.',
    files: [new AttachmentBuilder(scheduleRendered.buffer, { name: 'matches-fc27-test.png' })],
    allowedMentions: { parse: [] },
  });
  messageIds.push(scheduleMessage.id);

  for (const [teamCount, title] of [[16, 'K.O.-ÜBERSICHT • 16 TEAMS'], [8, 'K.O.-ÜBERSICHT • 8 TEAMS'], [4, 'K.O.-ÜBERSICHT • 4 TEAMS']]) {
    const rendered = await renderKoImage({
      phase: 'qualification_overview',
      qualifiedTeams: pool.slice(0, teamCount).map(fc27KoParticipant),
      eventId: `fc27-admin-test-qualification-${teamCount}`,
      version: Date.now(),
      variant: 'fc27',
    });
    messageIds.push(await postFc27KoTestImage(channel, title, rendered));
  }

  for (const [phase, matchCount, title] of [
    ['round_of_16', 8, 'ACHTELFINALE'],
    ['quarter_final', 4, 'VIERTELFINALE'],
    ['semi_final', 2, 'HALBFINALE'],
    ['third_place', 1, 'SPIEL UM PLATZ 3'],
    ['final', 1, 'FINALE'],
  ]) {
    const rendered = await renderKoImage({
      phase,
      matches: buildFc27KoMatches(pool, matchCount),
      eventId: `fc27-admin-test-${phase}`,
      version: Date.now(),
      variant: 'fc27',
    });
    messageIds.push(await postFc27KoTestImage(channel, title, rendered));
  }

  const progressionRendered = await renderKoProgression16({
    rounds: buildFc27ProgressionRounds(pool),
    serialNumber: 27,
    eventId: 'fc27-admin-test-progression-16',
    version: Date.now(),
  });
  messageIds.push(await postFc27KoTestImage(channel, 'ROAD TO GLORY • 16 TEAMS', progressionRendered));

  return { channelId: channel.id, messageIds, teamCount: pool.length, days: DAYS.length, graphics: DAYS.length + 14 };
}

module.exports = {
  DAYS,
  REQUIRED_TEAM_COUNT,
  availableLogoTeams,
  buildFc27TestAwards,
  buildFc27TestChampion,
  buildFc27TestGroup,
  buildFc27KoMatches,
  buildFc27ProgressionRounds,
  postFc27CeremonyGraphicsTest,
  spreadTeams,
  teamsForDay,
};
