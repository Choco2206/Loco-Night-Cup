'use strict';

const { listVisibleTeams } = require('../teams/team-service');

const TARGET_CHANNEL_ID = '1521071200808206356';
const MY_TEAM_CHANNEL_ID = '1522775227703103589';
const MESSAGE_LIMIT = 1900;

function teamsWithoutEa() {
  return listVisibleTeams()
    .filter(team => team?.status === 'active')
    .filter(team => !team?.eaClub?.clubId)
    .sort((a, b) => String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de', { sensitivity: 'base' }));
}

function teamLine(team, index) {
  const managerId = team?.manager?.userId ? String(team.manager.userId) : null;
  return `${index + 1}. **${team.clubName || team.id}**${managerId ? ` — <@${managerId}>` : ''}`;
}

function buildChunks(teams) {
  if (!teams.length) {
    return ['✅ **Alle Teams haben eine EA Club-ID hinterlegt.**'];
  }

  const intro = [
    '⚠️ **Teams ohne EA Club-ID**',
    '',
    'Folgende Teams haben ihren echten EA Club noch nicht verbunden. Bitte holt das nach, da ihr sonst **nicht für das Team of the Tournament berücksichtigt werden könnt**.',
    '',
    `➡️ Geht zu <#${MY_TEAM_CHANNEL_ID}> → **Mein Team anzeigen** → **EA Club ändern** und verbindet dort euren EA Club.`,
    '',
    '👀 **Betroffene Teams:**',
    '',
  ].join('\n');

  const continuation = '👀 **Betroffene Teams (Fortsetzung):**\n\n';
  const chunks = [];
  let current = intro;

  teams.forEach((team, index) => {
    const line = teamLine(team, index);
    const next = `${current}${current.endsWith('\n') ? '' : '\n'}${line}`;
    if (next.length > MESSAGE_LIMIT) {
      chunks.push(current);
      current = `${continuation}${line}`;
    } else {
      current = next;
    }
  });

  if (current) chunks.push(current);
  return chunks;
}

async function postTeamsWithoutEa({ client, guild }) {
  const channel = await client?.channels?.fetch?.(TARGET_CHANNEL_ID).catch(() => null)
    || await guild?.channels?.fetch?.(TARGET_CHANNEL_ID).catch(() => null);
  if (!channel?.send) throw new Error(`Kanal ${TARGET_CHANNEL_ID} wurde nicht gefunden oder ist nicht beschreibbar.`);

  const teams = teamsWithoutEa();
  const chunks = buildChunks(teams);
  const messageIds = [];

  for (const content of chunks) {
    const mentions = [...content.matchAll(/<@(\d+)>/g)].map(match => match[1]);
    const message = await channel.send({ content, allowedMentions: { users: mentions } });
    messageIds.push(String(message.id));
  }

  return { affectedCount: teams.length, messageIds, channelId: TARGET_CHANNEL_ID };
}

module.exports = { postTeamsWithoutEa, teamsWithoutEa };
