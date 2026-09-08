'use strict';

const { AttachmentBuilder } = require('discord.js');
const { listVisibleTeams } = require('../teams/team-service');
const { CEREMONY_DAY_LABELS, HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { renderFc27CeremonyImage, resolveFc27TeamLogoPath } = require('../../../utils/fc27-ceremony-renderer');

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

  return { channelId: channel.id, messageIds, teamCount: pool.length, days: DAYS.length };
}

module.exports = {
  DAYS,
  REQUIRED_TEAM_COUNT,
  availableLogoTeams,
  postFc27CeremonyGraphicsTest,
  spreadTeams,
  teamsForDay,
};
