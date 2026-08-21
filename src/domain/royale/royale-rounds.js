'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { renderKoImage } = require('../../../utils/ko-image-renderer');
const { readRoyale, updateRoyale } = require('./royale-repository');

function slug(value) { return value.toLowerCase().replace(/[ö]/g, 'oe').replace(/[ä]/g, 'ae').replace(/[ü]/g, 'ue').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function label(participant) { return participant?.displayName || findTeamById(participant?.teamId)?.clubName || 'TBD'; }
function teamIds(round) { return [...new Set(round.matches.flatMap(match => [match.home?.teamId, match.away?.teamId]).filter(Boolean).map(String))]; }
function userIdsForTeams(ids) {
  return [...new Set(ids.flatMap(id => { const team = findTeamById(id); return [team?.manager?.userId, ...(team?.coManagers || []).map(co => co.userId)].filter(Boolean).map(String); }))];
}

async function ensureChannel(guild, name, parentId, roleId, staffIds) {
  let channel = guild.channels.cache.find(item => item.type === ChannelType.GuildText && item.name === name && item.parentId === parentId);
  if (channel) return channel;
  const full = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true };
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId, permissionOverwrites: [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    ...staffIds.map(id => ({ id, allow: Object.entries(full).filter(([, value]) => value).map(([key]) => PermissionFlagsBits[key]) })),
  ], reason: 'Knockout Royale Runde freigeben' });
}

async function syncRoyaleRoundResources(client) {
  const event = readRoyale();
  if (!event.bracket) return null;
  const round = Object.values(event.bracket.rounds).find(item => item.status === 'open');
  if (!round) return null;
  const settings = readJson(FILES.settings, createSettingsDefault());
  const guild = settings.guild?.guildId ? await client.guilds.fetch(settings.guild.guildId).catch(() => null) : client.guilds.cache.first();
  if (!guild) return null;
  await guild.channels.fetch(); await guild.roles.fetch();
  const roleId = settings.roles?.knockoutRoyaleRoleIds?.[round.roleKey];
  const role = roleId ? guild.roles.cache.get(String(roleId)) : null;
  if (!role) throw new Error(`Royal-Rolle fehlt: ${round.roleKey}`);
  const allRoleIds = Object.values(settings.roles?.knockoutRoyaleRoleIds || {}).map(String);
  const currentUserIds = new Set(userIdsForTeams(teamIds(round)));
  const allParticipantIds = (event.format?.participants || []).map(item => String(item.teamId));
  for (const userId of userIdsForTeams(allParticipantIds)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const shouldHaveCurrent = currentUserIds.has(String(userId));
    const remove = allRoleIds.filter(id => (!shouldHaveCurrent || id !== role.id) && member.roles.cache.has(id));
    if (remove.length) await member.roles.remove(remove, 'Knockout Royale Rundenwechsel').catch(() => null);
    if (shouldHaveCurrent && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Knockout Royale Rundenfreigabe').catch(() => null);
  }
  const staffIds = [...new Set([...(settings.roles?.adminRoleIds || []), ...(settings.roles?.cupLeadRoleIds || [])].map(String))];
  const base = slug(round.label);
  const parentId = settings.categories.knockoutRoyaleCategoryId;
  const main = await ensureChannel(guild, base, parentId, role.id, staffIds);
  const results = await ensureChannel(guild, `${base}-ergebnisse`, parentId, role.id, staffIds);
  const video = await ensureChannel(guild, `${base}-groessenvideo`, parentId, role.id, staffIds);
  const embed = new EmbedBuilder().setColor(0x8f2cff).setTitle(`🐺 ${round.label}`).setDescription(round.matches.map((match, index) => `${index + 1}. **${label(match.home)}** vs. **${label(match.away)}**`).join('\n'));
  const phaseByRound = event.bracket.formatSize === 8 ? {
    kings_round_1: 'royal_8_kings_round_1', kings_round_2: 'royal_8_kings_round_2', kings_final: 'royal_8_kings_final',
    shadows_round_1: 'royal_8_shadows_round_1', shadows_round_2: 'royal_8_shadows_round_2', shadows_round_3: 'royal_8_shadows_round_3', shadows_final: 'royal_8_shadows_final',
    grand_final: 'royal_grand_final', grand_final_reset: 'royal_grand_final_reset',
  } : {};
  const phase = phaseByRound[round.roundKey];
  const image = phase ? await renderKoImage({ phase, matches: round.matches, eventId: event.cycle?.cycleKey || 'royale' }) : null;
  if (image) embed.setImage(`attachment://${image.fileName}`);
  const mainPayload = { embeds: [embed], files: image ? [{ attachment: image.buffer, name: image.fileName }] : [], allowedMentions: { parse: [] } };
  let mainMessage = round.messageId ? await main.messages.fetch(round.messageId).catch(() => null) : null;
  if (mainMessage) await mainMessage.edit({ ...mainPayload, attachments: [] }); else mainMessage = await main.send(mainPayload);
  let resultMessage = round.resultsMessageId ? await results.messages.fetch(round.resultsMessageId).catch(() => null) : null;
  const payload = { content: `Ergebnisse für **${round.label}** melden:`, components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`royale_result_open:${round.roundKey}`).setLabel('Ergebnis melden').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`royale_admin_result_open:${round.roundKey}`).setLabel('Admin-Ergebnis').setStyle(ButtonStyle.Secondary),
  )] };
  if (resultMessage) await resultMessage.edit(payload); else resultMessage = await results.send(payload);
  updateRoyale(current => { const stored = current.bracket.rounds[round.roundKey]; stored.channelId = main.id; stored.resultsChannelId = results.id; stored.videoChannelId = video.id; stored.messageId = mainMessage.id; stored.resultsMessageId = resultMessage.id; return current; });
  return { roundKey: round.roundKey, channelId: main.id, resultsChannelId: results.id, videoChannelId: video.id };
}

module.exports = { syncRoyaleRoundResources };
