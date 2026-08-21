'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { readRoyale, updateRoyale } = require('./royale-repository');
const { renderRoyaleCeremony } = require('./royale-ceremony-renderer');

const ROYALE_CEREMONY_CHANNEL_ID = '1517040877787287653';
let posting = false;

function userIds(team) {
  return [...new Set([
    team?.manager?.userId,
    ...(team?.coManagers || []).map(coManager => coManager.userId),
  ].filter(Boolean).map(String))];
}

function mentions(ids) {
  return ids.length ? ids.map(id => `<@${id}>`).join(', ') : 'nicht hinterlegt';
}

function buildRoyaleCeremonyText(team, winnerNumber = null) {
  const managerId = team?.manager?.userId ? [String(team.manager.userId)] : [];
  const coManagerIds = (team?.coManagers || []).map(item => String(item.userId)).filter(Boolean);
  return [
    '@everyone',
    '',
    `# 👑 DER THRON HAT SEINEN CHAMPION${winnerNumber ? ` #${winnerNumber}` : ''}`,
    '',
    `## 🏆 **${team.clubName}** gewinnt das **Loco Knockout Royale**!`,
    '',
    `**VM:** ${mentions(managerId)}`,
    `**Co-VM:** ${mentions(coManagerIds)}`,
    '',
    'Ihr habt euch bewiesen. Ihr seid den Pfad des Königs gegangen, wurdet von den Schatten geprüft und habt euch durch jede Schlacht zurück auf den Thron gekämpft.',
    '',
    'Wo andere gefallen sind, seid ihr stehen geblieben. Wo der Druck am größten wurde, seid ihr noch stärker geworden. Zwei Wege, ein Ziel – und am Ende trägt nur ein Team die Krone.',
    '',
    `🔥 **${team.clubName} – ihr seid die ersten wahren Champions des Loco Knockout Royale.**`,
    '',
    'Die Krone gehört euch. Der Thron gehört euch. Eure Namen gehören von jetzt an zur Geschichte des Rudels. 🐺👑',
    '',
    '**NUR DIE STÄRKSTEN ERREICHEN DEN THRON.**',
  ].join('\n');
}

async function postRoyaleCeremony(client) {
  if (posting) return { posted: false, reason: 'posting' };
  const event = readRoyale();
  if (event.bracket?.status !== 'completed' || !event.bracket?.championTeamId) return { posted: false, reason: 'not_completed' };
  if (event.ceremony?.postedAt) return { posted: false, reason: 'already_posted', messageId: event.ceremony.messageId };

  const team = findTeamById(event.bracket.championTeamId);
  if (!team) throw new Error(`Royale-Champion wurde nicht gefunden: ${event.bracket.championTeamId}`);
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels?.hallOfFameChannelId || ROYALE_CEREMONY_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error(`Siegerehrungs-Kanal ${channelId} wurde nicht gefunden.`);

  posting = true;
  try {
    const winnerNumber = Number(event.ceremony?.winnerNumber || event.history?.completedCount || 0) + (event.ceremony?.winnerNumber ? 0 : 1);
    const graphic = await renderRoyaleCeremony({ team, winnerNumber });
    const allowedUserIds = userIds(team);
    const message = await channel.send({
      content: buildRoyaleCeremonyText(team, winnerNumber),
      files: [{ attachment: graphic.buffer, name: graphic.fileName }],
      allowedMentions: { parse: ['everyone'], users: allowedUserIds },
    });
    const timestamp = new Date().toISOString();
    updateRoyale(current => {
      current.ceremony = {
        status: 'posted',
        postedAt: timestamp,
        channelId: String(channel.id),
        messageId: String(message.id),
        championTeamId: String(team.id),
        winnerNumber,
      };
      current.history = current.history || { completedCount: 0, winners: [] };
      current.history.completedCount = Math.max(Number(current.history.completedCount || 0), winnerNumber);
      current.history.winners = Array.isArray(current.history.winners) ? current.history.winners : [];
      if (!current.history.winners.some(winner => Number(winner.number) === winnerNumber)) {
        current.history.winners.push({ number: winnerNumber, teamId: String(team.id), clubName: team.clubName, cycleKey: current.cycle?.cycleKey || null, postedAt: timestamp });
      }
      current.meta = { ...(current.meta || {}), updatedAt: timestamp };
      return current;
    });
    return { posted: true, messageId: message.id, championTeamId: String(team.id), winnerNumber };
  } finally {
    posting = false;
  }
}

module.exports = {
  ROYALE_CEREMONY_CHANNEL_ID,
  buildRoyaleCeremonyText,
  postRoyaleCeremony,
};
