'use strict';

const { EmbedBuilder } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readRoyale, updateRoyale } = require('./royale-repository');

const FALLBACK_CHANNEL_ID = '1516429776070508555';
let publicSyncPromise = null;
let pendingPublicSyncClient = null;
function name(value) { return value?.displayName || 'Noch offen'; }
function status(round) {
  if (round.status === 'completed') return '✅ Abgeschlossen';
  if (round.status === 'open') return round.openedAt ? '🟢 Läuft' : '🟡 Vorbereitet – Freigabe zum Turnierstart';
  if (round.status === 'not_needed') return round.roundKey === 'grand_final_reset' ? '⚪ Nur falls erforderlich' : '⚪ Nicht erforderlich';
  return '🔒 Noch nicht freigegeben';
}
function matchLine(match, index) {
  const score = match.result
    ? ` — **${match.result.homeGoals}:${match.result.awayGoals}**`
    : match.status === 'pending_confirmation'
      ? ' — ⏳ wartet auf Gegner'
      : match.status === 'admin_decision_required'
        ? ' — 🛠️ Admin-Entscheidung erforderlich'
        : ' — offen';
  return `**Spiel ${index + 1}:** ${name(match.home)} vs. ${name(match.away)}${score}`;
}
function embedFor(round, size) {
  return new EmbedBuilder().setColor(round.status === 'completed' ? 0x38b26c : round.status === 'open' ? 0x8f2cff : 0x59606b)
    .setTitle(`Loco Knockout Royale · ${round.label}`)
    .setDescription(`${status(round)}\n\n${round.matches.map(matchLine).join('\n')}`)
    .setFooter({ text: `${size}er-Format · Der Spielplan aktualisiert sich automatisch` });
}

async function performPublicScheduleSync(client) {
  const event = readRoyale(); if (!event.bracket) return [];
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = settings.channels?.liveScheduleChannelId || FALLBACK_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null); if (!channel?.isTextBased()) return [];
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const changed = [];
  for (const key of Object.keys(event.bracket.rounds)) {
    const round = event.bracket.rounds[key]; if (!round) continue;
    const signature = JSON.stringify({ status: round.status, openedAt: round.openedAt, matches: round.matches.map(match => [match.home, match.away, match.status, match.result]) });
    const title = `Loco Knockout Royale · ${round.label}`;
    const existing = recent ? [...recent.values()].filter(item => item.embeds?.some(embed => embed.title === title)) : [];
    let message = existing.sort((first, second) => Number(second.createdTimestamp || 0) - Number(first.createdTimestamp || 0))[0] || null;
    if (round.publicMessageId && round.publicSignature === signature && (!message || String(message.id) === String(round.publicMessageId))) continue;
    const payload = { embeds: [embedFor(round, event.bracket.formatSize)], components: [], allowedMentions: { parse: [] } };
    if (!message && round.publicMessageId) message = await channel.messages.fetch(round.publicMessageId).catch(() => null);
    if (message) await message.edit(payload); else message = await channel.send(payload);
    const item = { roundKey: key, publicMessageId: message.id, publicSignature: signature };
    changed.push(item);
    updateRoyale(current => { Object.assign(current.bracket.rounds[item.roundKey], { publicMessageId: item.publicMessageId, publicSignature: item.publicSignature }); current.publicScheduleChannelId = channel.id; return current; });
  }
  return changed;
}

function syncRoyalePublicSchedule(client) {
  pendingPublicSyncClient = client;
  if (!publicSyncPromise) {
    publicSyncPromise = (async () => {
      let result = [];
      while (pendingPublicSyncClient) {
        const targetClient = pendingPublicSyncClient; pendingPublicSyncClient = null;
        result = await performPublicScheduleSync(targetClient);
      }
      return result;
    })().finally(() => { publicSyncPromise = null; });
  }
  return publicSyncPromise;
}

module.exports = { syncRoyalePublicSchedule };
