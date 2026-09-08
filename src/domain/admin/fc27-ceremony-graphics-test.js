'use strict';

const { AttachmentBuilder } = require('discord.js');
const { listVisibleTeams } = require('../teams/team-service');
const { CEREMONY_DAY_LABELS, HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { renderFc27CeremonyImage, resolveFc27TeamLogoPath } = require('../../../utils/fc27-ceremony-renderer');
const { renderSpecialAwards } = require('../../../utils/special-awards-renderer');

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

async function postFc27CeremonyGraphicsTest({ guild }) {
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

  return { channelId: channel.id, messageIds, teamCount: pool.length, days: DAYS.length, graphics: DAYS.length + 1 };
}

module.exports = {
  DAYS,
  REQUIRED_TEAM_COUNT,
  availableLogoTeams,
  buildFc27TestAwards,
  postFc27CeremonyGraphicsTest,
  spreadTeams,
  teamsForDay,
};
