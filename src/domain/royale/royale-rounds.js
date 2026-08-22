'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { renderKoImage } = require('../../../utils/ko-image-renderer');
const { readRoyale, updateRoyale } = require('./royale-repository');
const { ensureRoyaleAttendancePost } = require('./royale-attendance');

const ROUND_LIMIT_MS = 25 * 60 * 1000;
let resourceSyncPromise = null;
let pendingResourceSync = null;
function slug(value) { return value.toLowerCase().replace(/[ö]/g, 'oe').replace(/[ä]/g, 'ae').replace(/[ü]/g, 'ue').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function label(value) { return value?.displayName || findTeamById(value?.teamId)?.clubName || 'Noch offen'; }
function pendingTeamIds(round) {
  return [...new Set([
    ...(round.pendingParticipants || []).map(item => item?.teamId),
    ...round.matches.flatMap(match => match.status === 'confirmed'
    ? []
    : [match.home?.teamId, match.away?.teamId]
    ),
  ].filter(Boolean).map(String))];
}
function roundSignature(round) { return JSON.stringify({ status: round.status, drawnAt: round.drawnAt, matches: round.matches.map(match => [match.home, match.away, match.status, match.result]) }); }
function userIdsForTeams(ids) { return [...new Set(ids.flatMap(id => { const team = findTeamById(id); return [team?.manager?.userId, ...(team?.coManagers || []).map(co => co.userId)].filter(Boolean).map(String); }))]; }

function roundTiming(event, round, now = new Date()) {
  const tournamentStartAt = new Date(event.schedule?.tournamentStartAt || 0);
  const released = now.getTime() >= tournamentStartAt.getTime();
  const reminderBase = Math.max(now.getTime(), tournamentStartAt.getTime());
  return {
    released,
    preparedAt: round.preparedAt || now.toISOString(),
    openedAt: round.openedAt || (released ? now.toISOString() : null),
    reminderAt: round.reminderAt || new Date(reminderBase + ROUND_LIMIT_MS).toISOString(),
  };
}

function matchingChannels(guild, name, parentId) {
  return [...guild.channels.cache.values()].filter(item => item.type === ChannelType.GuildText && item.name === name && item.parentId === parentId);
}

async function ensureChannel(guild, name, parentId, roleId, staffIds, preferredId = null) {
  const matches = matchingChannels(guild, name, parentId);
  let channel = matches.find(item => String(item.id) === String(preferredId))
    || matches.sort((first, second) => Number(first.createdTimestamp || 0) - Number(second.createdTimestamp || 0))[0];
  if (channel) return channel;
  const allowed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId, permissionOverwrites: [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: roleId, allow: allowed }, ...staffIds.map(id => ({ id, allow: allowed })),
  ], reason: 'Knockout Royale Runde freigeben' });
}

async function findExistingMessage(channel, preferredId, predicate) {
  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const matches = fetched ? [...fetched.values()].filter(predicate) : [];
  let message = preferredId ? matches.find(item => String(item.id) === String(preferredId)) : null;
  return message || matches.sort((first, second) => Number(second.createdTimestamp || 0) - Number(first.createdTimestamp || 0))[0] || null;
}

function hasGraphicTitle(message, title) { return message.embeds?.some(embed => embed.title === title); }
function hasButton(message, customId) {
  return message.components?.some(row => row.components?.some(component => component.customId === customId || component.custom_id === customId));
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
  const main = await ensureChannel(guild, base, parentId, role.id, staffIds, round.channelId);
  const results = await ensureChannel(guild, `${base}-ergebnisse`, parentId, role.id, staffIds, round.resultsChannelId);
  const video = await ensureChannel(guild, `${base}-groessenvideo`, parentId, role.id, staffIds, round.videoChannelId);
  const embed = new EmbedBuilder().setColor(0x8f2cff).setTitle(`🐺 ${round.label}`).setDescription(round.matches.map((match, index) => `${index + 1}. **${label(match.home)}** vs. **${label(match.away)}**`).join('\n'));
  const phase = phaseFor(round.roundKey, event.bracket.formatSize);
  const image = phase ? await renderKoImage({ phase, matches: round.matches, eventId: event.cycle?.cycleKey || 'royale' }).catch(() => null) : null;
  if (image) embed.setImage(`attachment://${image.fileName}`);
  const mainPayload = { embeds: [embed], files: image ? [{ attachment: image.buffer, name: image.fileName }] : [], allowedMentions: { parse: [] } };
  const graphicTitle = `🐺 ${round.label}`;
  let mainMessage = await findExistingMessage(main, round.messageId, message => hasGraphicTitle(message, graphicTitle));
  if (mainMessage) await mainMessage.edit({ ...mainPayload, attachments: [] }); else mainMessage = await main.send(mainPayload);
  let resultMessage = await findExistingMessage(results, round.resultsMessageId, message => hasButton(message, `royale_result_open:${round.roundKey}`));
  let resultsGraphicMessage = await findExistingMessage(results, round.resultsGraphicMessageId, message => hasGraphicTitle(message, graphicTitle));
  if (!resultsGraphicMessage && resultMessage) {
    await resultMessage.delete().catch(() => null);
    resultMessage = null;
  }
  if (resultsGraphicMessage) await resultsGraphicMessage.edit({ ...mainPayload, attachments: [] });
  else resultsGraphicMessage = await results.send(mainPayload);
  const timing = roundTiming(event, round, now);
  const released = timing.released;
  const disabled = round.status !== 'open' || !released;
  const content = round.status === 'completed'
    ? `**${round.label}** ist abgeschlossen.`
    : round.status !== 'open'
      ? `**${round.label}** ist vorbereitet. Die Freigabe erfolgt, sobald alle Begegnungen feststehen.`
    : released
      ? `Ergebnisse für **${round.label}** melden:`
      : `**${round.label}** ist vorbereitet. Die Freigabe erfolgt zum Turnierstart.`;
  const payload = { content, components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`royale_result_open:${round.roundKey}`).setLabel('Ergebnis melden').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`royale_admin_result_open:${round.roundKey}`).setLabel('Admin-Ergebnis').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`royale_replace_open:${round.roundKey}`).setLabel('Team ersetzen').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  )] };
  if (resultMessage) await resultMessage.edit(payload); else resultMessage = await results.send(payload);
  return {
    channelId: main.id, resultsChannelId: results.id, videoChannelId: video.id,
    messageId: mainMessage.id, resultsGraphicMessageId: resultsGraphicMessage.id, resultsMessageId: resultMessage.id,
    privateSignature: roundSignature(round),
    preparedAt: timing.preparedAt,
    openedAt: timing.openedAt,
    reminderAt: timing.reminderAt,
  };
}

async function guildAndSettings(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const guild = settings.guild?.guildId ? await client.guilds.fetch(settings.guild.guildId).catch(() => null) : client.guilds.cache.first();
  return { guild, settings };
}

async function performRoyaleRoundResourceSync(client, now = new Date()) {
  const event = readRoyale(); if (!event.bracket) return [];
  const allRounds = Object.values(event.bracket.rounds);
  const resourceRounds = allRounds.filter(round => !round.channelId || round.privateSignature !== roundSignature(round));
  const { guild, settings } = await guildAndSettings(client); if (!guild) return [];
  await guild.channels.fetch(); await guild.roles.fetch();
  const roleMap = settings.roles?.knockoutRoyaleRoleIds || {}; const desired = new Map();
  for (const round of allRounds) for (const userId of userIdsForTeams(pendingTeamIds(round))) {
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
  for (const round of resourceRounds) {
    const item = { roundKey: round.roundKey, ...(await syncOneRound({ event, round, guild, settings, now })) };
    synced.push(item);
    updateRoyale(current => { Object.assign(current.bracket.rounds[item.roundKey], item); return current; });
    if (round.roundKey === 'kings_round_1') await ensureRoyaleAttendancePost(client);
  }
  await ensureRoyaleAttendancePost(client);
  return synced;
}

function syncRoyaleRoundResources(client, now = new Date()) {
  pendingResourceSync = { client, now };
  if (!resourceSyncPromise) {
    resourceSyncPromise = (async () => {
      let result = [];
      while (pendingResourceSync) {
        const request = pendingResourceSync; pendingResourceSync = null;
        result = await performRoyaleRoundResourceSync(request.client, request.now);
      }
      return result;
    })().finally(() => { resourceSyncPromise = null; });
  }
  return resourceSyncPromise;
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

module.exports = { cleanupRoyaleResources, roundTiming, sendRoyaleRoundReminders, syncRoyaleRoundResources };
