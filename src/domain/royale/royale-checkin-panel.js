'use strict';

const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { getRoyaleState } = require('./royale-service');
const { updateRoyale } = require('./royale-repository');

function timestamp(value) { return value ? `<t:${Math.floor(new Date(value).getTime() / 1000)}:F>` : 'nicht gesetzt'; }
function teamNames(ids) { return ids.length ? ids.map((id, index) => `${index + 1}. **${findTeamById(id)?.clubName || id}**`).join('\n') : 'Noch keine Teams.'; }

function buildRoyaleCheckinPayload(event) {
  const active = event.checkin?.activeTeamIds || [];
  const waitlist = event.checkin?.waitlistTeamIds || [];
  const count = (event.checkin?.entries || []).length;
  const size = event.format?.size;
  const next = [8, 16, 32].find(value => value > count) || null;
  const embed = new EmbedBuilder()
    .setColor(0x8f2cff)
    .setTitle('🐺 LOCO KNOCKOUT ROYALE • CHECK-IN')
    .setDescription([
      `Eventdatum: **${event.cycle?.eventDate || '-'}**`,
      `Turnierstart: ${timestamp(event.schedule?.tournamentStartAt)}`,
      `Format: **${size ? `${size}er Knockout Royale` : 'noch nicht erreicht'}**`,
      'Formatmarken: **8 → 16 → 32 Teams**',
      next ? `Bis zum nächsten Format fehlen **${Math.max(0, next - count)} Teams**.` : 'Das 32er-Format ist erreicht; weitere Teams kommen auf die Warteliste.',
      '',
      '**Aktive Teilnehmer**', teamNames(active),
      '',
      `**Warteliste (${waitlist.length})**`, teamNames(waitlist),
    ].join('\n'));
  const disabled = event.checkin?.isOpen !== true;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('royale_checkin_join').setLabel('Team anmelden').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('royale_checkin_leave').setLabel('Team abmelden').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  const files = [];
  const bannerPath = require('fs').existsSync(FILES.knockoutRoyaleCheckinBanner)
    ? FILES.knockoutRoyaleCheckinBanner
    : FILES.checkinBanner;
  if (require('fs').existsSync(bannerPath)) {
    embed.setImage('attachment://royale-check-in.png');
    files.push(new AttachmentBuilder(bannerPath, { name: 'royale-check-in.png' }));
  }
  return { embeds: [embed], components: [row], files, allowedMentions: { parse: [] } };
}

async function refreshRoyaleCheckin(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channel = await client.channels.fetch(settings.channels?.knockoutRoyaleCheckinChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  const event = getRoyaleState(); const payload = buildRoyaleCheckinPayload(event);
  let message = event.resources?.checkinMessageId ? await channel.messages.fetch(event.resources.checkinMessageId).catch(() => null) : null;
  if (message) await message.edit(payload); else message = await channel.send(payload);
  updateRoyale(current => { current.resources = current.resources || {}; current.resources.checkinChannelId = channel.id; current.resources.checkinMessageId = message.id; return current; });
  return message;
}

module.exports = { buildRoyaleCheckinPayload, refreshRoyaleCheckin };
