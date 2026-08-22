'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { renderKoImage } = require('../../../utils/ko-image-renderer');
const { readRoyale, updateRoyale } = require('./royale-repository');

const ROUND_LIMIT_MS = 25 * 60 * 1000;
function slug(value) { return value.toLowerCase().replace(/[ö]/g, 'oe').replace(/[ä]/g, 'ae').replace(/[ü]/g, 'ue').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function label(value) { return value?.displayName || findTeamById(value?.teamId)?.clubName || 'Noch offen'; }
function teamIds(round) { return [...new Set(round.matches.flatMap(match => [match.home?.teamId, match.away?.teamId]).filter(Boolean).map(String))]; }
function roundSignature(round) { return JSON.stringify({ status: round.status, matches: round.matches.map(match => [match.home, match.away, match.status, match.result]) }); }
function userIdsForTeams(ids) { return [...new Set(ids.flatMap(id => { const team = findTeamById(id); return [team?.manager?.userId, ...(team?.coManagers || []).map(co => co.userId)].filter(Boolean).map(String); }))]; }

async function ensureChannel(guild, name, parentId, roleId, staffIds) {
  let channel = guild.channels.cache.find(item => item.type === ChannelType.GuildText && item.name === name && item.parentId === parentId);
  if (channel) return channel;
  const allowed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId, permissionOverwrites: [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: roleId, allow: allowed }, ...staffIds.map(id => ({ id, allow: allowed })),
  ], reason: 'Knockout Royale Runde freigeben' });
}

function phaseFor(roundKey, size) {
  if (['grand_final', 'grand_final_reset'].includes(roundKey)) return `royal_${roundKey}`;
  return [8, 16, 32].includes(size) ? `royal_${size}_${roundKey}` : null;
}

async function syncOneRound({ event, round, guild, settings, now }) {
  const roleId = settings.roles?.knockoutRoyaleRoleIds?.[round.roleKey];
  const role = roleId ? guild.roles.cache.get(String(roleId)) : null;
  if (!role) throw new Error(`Royal-Rolle fehlt: ${round.roleKey}`);
  const staffIds = [...new Set([...(settings.roles?.adminRoleIds || []), ...(settings.roles?.cupLeadRoleIds || [])].map(String))];
  const base = slug(round.label); const parentId = settings.categories.knockoutRoyaleCategoryId;
  const main = await ensureChannel(guild, base, parentId, role.id, staffIds);
  const results = await ensureChannel(guild, `${base}-ergebnisse`, parentId, role.id, staffIds);
  const video = await ensureChannel(guild, `${base}-groessenvideo`, parentId, role.id, staffIds);
  const embed = new EmbedBuilder().setColor(0x8f2cff).setTitle(`🐺 ${round.label}`).setDescription(round.matches.map((match, index) => `${index + 1}. **${label(match.home)}** vs. **${label(match.away)}**`).join('\n'));
  const phase = phaseFor(round.roundKey, event.bracket.formatSize);
  const image = phase ? await renderKoImage({ phase, matches: round.matches, eventId: event.cycle?.cycleKey || 'royale' }).catch(() => null) : null;
  if (image) embed.setImage(`attachment://${image.fileName}`);
  const mainPayload = { embeds: [embed], files: image ? [{ attachment: image.buffer, name: image.fileName }] : [], allowedMentions: { parse: [] } };
  let mainMessage = round.messageId ? await main.messages.fetch(round.messageId).catch(() => null) : null;
  if (mainMessage) await mainMessage.edit({ ...mainPayload, attachments: [] }); else mainMessage = await main.send(mainPayload);
  let resultMessage = round.resultsMessageId ? await results.messages.fetch(round.resultsMessageId).catch(() => null) : null;
  const disabled = round.status !== 'open';
  const payload = { content: disabled ? `**${round.label}** ist abgeschlossen.` : `Ergebnisse für **${round.label}** melden:`, components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`royale_result_open:${round.roundKey}`).setLabel('Ergebnis melden').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`royale_admin_result_open:${round.roundKey}`).setLabel('Admin-Ergebnis').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`royale_replace_open:${round.roundKey}`).setLabel('Team ersetzen').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  )] };
  if (resultMessage) await resultMessage.edit(payload); else resultMessage = await results.send(payload);
  return { channelId: main.id, resultsChannelId: results.id, videoChannelId: video.id, messageId: mainMessage.id, resultsMessageId: resultMessage.id, privateSignature: roundSignature(round), openedAt: round.openedAt || now.toISOString(), reminderAt: round.reminderAt || new Date(now.getTime() + ROUND_LIMIT_MS).toISOString() };
}

async function guildAndSettings(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const guild = settings.guild?.guildId ? await client.guilds.fetch(settings.guild.guildId).catch(() => null) : client.guilds.cache.first();
  return { guild, settings };
}

async function syncRoyaleRoundResources(client, now = new Date()) {
  const event = readRoyale(); if (!event.bracket) return [];
  const allRounds = Object.values(event.bracket.rounds); const openRounds = allRounds.filter(item => item.status === 'open');
  const resourceRounds = allRounds.filter(round => round.status === 'open' || (round.channelId && round.privateSignature !== roundSignature(round)));
  const { guild, settings } = await guildAndSettings(client); if (!guild) return [];
  await guild.channels.fetch(); await guild.roles.fetch();
  const roleMap = settings.roles?.knockoutRoyaleRoleIds || {}; const desired = new Map();
  for (const round of openRounds) for (const userId of userIdsForTeams(teamIds(round))) {
    if (!desired.has(userId)) desired.set(userId, new Set());
    if (roleMap[round.roleKey]) desired.get(userId).add(String(roleMap[round.roleKey]));
  }
  const allRoleIds = Object.values(roleMap).map(String);
  for (const userId of userIdsForTeams((event.format?.participants || []).map(item => String(item.teamId)))) {
    const member = await guild.members.fetch(userId).catch(() => null); if (!member) continue;
    const wanted = desired.get(String(userId)) || new Set();
    const remove = allRoleIds.filter(id => member.roles.cache.has(id) && !wanted.has(id)); const add = [...wanted].filter(id => !member.roles.cache.has(id));
    if (remove.length) await member.roles.remove(remove, 'Knockout Royale Rundenwechsel').catch(() => null);
    if (add.length) await member.roles.add(add, 'Knockout Royale Rundenfreigabe').catch(() => null);
  }
  const synced = [];
  for (const round of resourceRounds) synced.push({ roundKey: round.roundKey, ...(await syncOneRound({ event, round, guild, settings, now })) });
  if (synced.length) updateRoyale(current => { for (const item of synced) Object.assign(current.bracket.rounds[item.roundKey], item); return current; });
  return synced;
}

async function sendRoyaleRoundReminders(client, now = new Date()) {
  const event = readRoyale();
  const due = Object.values(event.bracket?.rounds || {}).filter(round => round.status === 'open' && round.reminderAt && !round.reminderSentAt && now >= new Date(round.reminderAt));
  if (!due.length) return [];
  const { guild, settings } = await guildAndSettings(client); if (!guild) return [];
  const staffIds = [...new Set([...(settings.roles?.adminRoleIds || []), ...(settings.roles?.cupLeadRoleIds || [])].map(String))]; const mentions = staffIds.map(id => `<@&${id}>`).join(' '); const sent = [];
  for (const round of due) {
    const channel = await guild.channels.fetch(round.resultsChannelId).catch(() => null); if (!channel?.isTextBased()) continue;
    const unresolved = round.matches.filter(match => match.status !== 'confirmed').map(match => `• ${label(match.home)} vs. ${label(match.away)}`).join('\n');
    await channel.send({ content: `${mentions}\n⏰ **25-Minuten-Erinnerung – ${round.label}**\nBitte sorgt jetzt für die ausstehenden Ergebnisse:\n${unresolved}`, allowedMentions: { roles: staffIds, parse: [] } }); sent.push(round.roundKey);
  }
  if (sent.length) updateRoyale(current => { for (const key of sent) current.bracket.rounds[key].reminderSentAt = now.toISOString(); return current; });
  return sent;
}

async function cleanupRoyaleResources(client) {
  const event = readRoyale(); if (event.bracket?.status !== 'completed' || event.resourcesCleanedAt) return false;
  const { guild, settings } = await guildAndSettings(client); if (!guild) return false;
  const roleIds = Object.values(settings.roles?.knockoutRoyaleRoleIds || {}).map(String);
  for (const userId of userIdsForTeams((event.format?.participants || []).map(item => String(item.teamId)))) {
    const member = await guild.members.fetch(userId).catch(() => null); const remove = roleIds.filter(id => member?.roles.cache.has(id));
    if (remove.length) await member.roles.remove(remove, 'Knockout Royale beendet').catch(() => null);
  }
  const channelIds = [...new Set(Object.values(event.bracket.rounds).flatMap(round => [round.channelId, round.resultsChannelId, round.videoChannelId]).filter(Boolean))];
  for (const id of channelIds) { const channel = await guild.channels.fetch(id).catch(() => null); if (channel) await channel.delete('Knockout Royale beendet').catch(() => null); }
  updateRoyale(current => { current.resourcesCleanedAt = new Date().toISOString(); return current; }); return true;
}

module.exports = { cleanupRoyaleResources, sendRoyaleRoundReminders, syncRoyaleRoundResources };
