'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { getConfiguredGuild, getTeamUserIds } = require('../groups/group-roles');
const { applyGroupChannelPermissionOverwrites, buildGroupChannelPermissionOverwrites } = require('../groups/group-channels');
const { recalculateGroupStandings } = require('../groups/group-results');
const { createLeaguePhaseDraw, validateLeaguePhaseDraw } = require('./league-phase-draw');
const { renderLeagueSchedule, renderLeagueTable } = require('../../../utils/league-phase-renderer');
const { LEAGUE_PHASE_FORMATS, LEAGUE_PHASE_VIDEO_CHANNEL_NAME, isLeaguePhaseFormat } = require('../../app/constants');

function buildLeaguePhaseButtons(eventKey) { return new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`group_result_open:${eventKey}:league`).setLabel('Ergebnis eintragen').setEmoji('⚽').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`group_admin_result_open:${eventKey}:league`).setLabel('Admin-Ergebnis').setEmoji('🛠️').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId(`group_replacement_open:${eventKey}:league`).setLabel('Nachruecker einsetzen').setEmoji('🔁').setStyle(ButtonStyle.Secondary)
); }
async function findExistingImageMessage(channel, attachmentName) {
  if (!attachmentName) return null;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return null;
  return messages.find(message => (
    message.author?.id === channel.client.user.id
    && message.attachments?.some(attachment => attachment.name === attachmentName)
  )) || null;
}
async function upsert(channel, id, payload) {
  const attachmentName = payload.files?.[0]?.name || null;
  let old = id ? await channel.messages.fetch(id).catch(() => null) : null;
  if (!old) old = await findExistingImageMessage(channel, attachmentName);
  if (old) return old.edit(payload);
  return channel.send(payload);
}
function imagePayload(buffer, name, components = []) { return { content: null, embeds: [new EmbedBuilder().setImage(`attachment://${name}`)], attachments: [], files: [{ attachment: buffer, name }], components, allowedMentions: { parse: [] } }; }
const LEAGUE_PHASE_ROLE_NAME = 'Ligaphase';
const LEAGUE_PHASE_CATEGORY_ID = '1526896899934654464';

async function ensureLeaguePhaseRole(guild, settings) {
  const savedId = settings.roles?.leaguePhaseRoleId;
  let role = savedId ? await guild.roles.fetch(savedId).catch(() => null) : null;
  if (!role) role = guild.roles.cache.find(entry => entry.name === LEAGUE_PHASE_ROLE_NAME) || null;
  if (!role) role = await guild.roles.create({ name: LEAGUE_PHASE_ROLE_NAME, mentionable: false, reason: 'Dauerhafte Loco Night Cup Ligaphasenrolle' });
  if (savedId !== role.id) {
    updateJson(FILES.settings, createSettingsDefault(), current => {
      current.roles = current.roles || {};
      current.roles.leaguePhaseRoleId = role.id;
      return current;
    });
    settings.roles = settings.roles || {};
    settings.roles.leaguePhaseRoleId = role.id;
  }
  return role;
}

async function ensureLeaguePhaseChannel(guild, settings, id, name, roleId, userIds) {
  let channel = id ? await guild.channels.fetch(id).catch(() => null) : null;
  if (!channel) channel = guild.channels.cache.find(entry => entry.name === name && entry.type === ChannelType.GuildText) || null;
  const permissionOverwrites = buildGroupChannelPermissionOverwrites({ guild, settings, roleId, userIds });
  if (channel?.isTextBased?.()) {
    await applyGroupChannelPermissionOverwrites(channel, permissionOverwrites);
    if (channel.parentId !== LEAGUE_PHASE_CATEGORY_ID) await channel.setParent(LEAGUE_PHASE_CATEGORY_ID, { lockPermissions: false });
    return channel;
  }
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: LEAGUE_PHASE_CATEGORY_ID,
    permissionOverwrites,
    reason: 'Loco Night Cup Ligaphase',
  });
}

function overwriteSnapshot(channel, id) {
  const overwrite = channel.permissionOverwrites.cache.get(String(id));
  return overwrite ? { allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() } : null;
}

function expectedSnapshot(overwrite) {
  const allow = (overwrite.allow || []).reduce((value, flag) => value | flag, 0n);
  const deny = (overwrite.deny || []).reduce((value, flag) => value | flag, 0n);
  return { allow: allow.toString(), deny: deny.toString() };
}

async function getExistingGuildMemberIds(guild, userIds) {
  const existing = [];
  for (const userId of [...new Set((userIds || []).map(String))]) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) existing.push(member.id);
  }
  return existing;
}

async function verifyLeaguePhaseAccess({ guild, settings, phase }) {
  const role = await ensureLeaguePhaseRole(guild, settings);
  const participantUserIds = (phase.slots || []).filter(slot => slot.type === 'team').flatMap(slot => getTeamUserIds(findTeamById(slot.teamId)));
  const userIds = await getExistingGuildMemberIds(guild, participantUserIds);
  const expected = buildGroupChannelPermissionOverwrites({ guild, settings, roleId: role.id, userIds });
  const channels = [];
  for (const channelId of [phase.overviewChannelId, phase.resultsChannelId, phase.videoChannelId]) {
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel) throw new Error(`Ligaphasenkanal fehlt: ${channelId || 'keine ID'}`);
    const mismatches = expected.filter(overwrite => {
      const actual = overwriteSnapshot(channel, overwrite.id);
      const wanted = expectedSnapshot(overwrite);
      return !actual || actual.allow !== wanted.allow || actual.deny !== wanted.deny;
    });
    const unexpected = [...channel.permissionOverwrites.cache.keys()].filter(id => !expected.some(overwrite => String(overwrite.id) === String(id)));
    channels.push({ channelId: channel.id, ok: mismatches.length === 0 && unexpected.length === 0, mismatches: mismatches.map(item => String(item.id)), unexpected });
  }
  const missingMembers = [];
  for (const userId of userIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member?.roles.cache.has(role.id)) missingMembers.push(userId);
  }
  return { ok: channels.every(channel => channel.ok) && missingMembers.length === 0, roleId: role.id, expectedMemberCount: userIds.length, missingMembers, channels };
}
async function refreshLeaguePhasePosts(client, eventKey) {
  if (!client) return null; const event = readEventData(eventKey); const phase = event.leaguePhase; if (!phase) return null;
  recalculateGroupStandings(phase); const table = await renderLeagueTable(phase); const schedule = await renderLeagueSchedule(phase);
  const overview = await client.channels.fetch(phase.overviewChannelId).catch(() => null); const results = await client.channels.fetch(phase.resultsChannelId).catch(() => null); if (!overview || !results) return null;
  const ot = await upsert(overview, phase.messages?.overviewTableMessageId, imagePayload(table, `ligaphase-table-${eventKey}.png`));
  const os = await upsert(overview, phase.messages?.overviewScheduleMessageId, imagePayload(schedule, `ligaphase-schedule-${eventKey}.png`));
  const rt = await upsert(results, phase.messages?.resultsTableMessageId, imagePayload(table, `ligaphase-table-results-${eventKey}.png`));
  const rs = await upsert(results, phase.messages?.resultsScheduleMessageId, imagePayload(schedule, `ligaphase-schedule-results-${eventKey}.png`, [buildLeaguePhaseButtons(eventKey)]));
  updateEventData(eventKey, stored => { stored.leaguePhase.messages = stored.leaguePhase.messages || {}; Object.assign(stored.leaguePhase.messages, { overviewTableMessageId: ot.id, overviewScheduleMessageId: os.id, resultsTableMessageId: rt.id, resultsScheduleMessageId: rs.id }); stored.leaguePhase.standings = phase.standings; return stored; });
  const { refreshLiveSchedule } = require('../live-schedule');
  await refreshLiveSchedule(client, eventKey).catch(error => console.warn(`[league-phase] Oeffentlicher Spielplan konnte nicht aktualisiert werden: ${error.message}`));
  console.info(`[league-phase] ${eventKey}: Ligaphasengrafiken aktualisiert.`); return { ot, os, rt, rs };
}
async function drawLeaguePhaseForEvent({ eventKey, actorUserId = null, client = null, guild = null, now = new Date() }) {
  let result; updateEventData(eventKey, event => { if (!isLeaguePhaseFormat(event.format?.size) || !event.format?.lockedAt) throw new Error('Ligaphase ist ausschliesslich fuer die final gelockten Formate 14, 18 und 20 erlaubt.'); if (event.leaguePhase?.status && event.leaguePhase.status !== 'not_created') { result = { event, leaguePhase: event.leaguePhase, restored: true }; return event; }
    const phase = createLeaguePhaseDraw({ eventKey, participants: event.format.participants, createdAt: now.toISOString() }); validateLeaguePhaseDraw(phase); recalculateGroupStandings(phase); phase.drawnBy = actorUserId ? String(actorUserId) : null; event.status = 'league_phase'; event.phaseType = 'league'; event.leaguePhase = phase; event.groups = { ...(event.groups || {}), status: 'not_created', groups: {} }; result = { event, leaguePhase: phase, restored: false }; return event; });
  console.info(`[league-phase] ${eventKey}: ${result.leaguePhase.formatSize}er-Ligaphase erkannt; Auslosung mit ${LEAGUE_PHASE_FORMATS[result.leaguePhase.formatSize].totalMatches} Spielen erfolgreich validiert.`);
  if (!client) return result; const settings = readJson(FILES.settings, createSettingsDefault()); const targetGuild = guild || await getConfiguredGuild(client, settings); if (!targetGuild) return result;
  const role = await ensureLeaguePhaseRole(targetGuild, settings);
  const leagueUserIds = await getExistingGuildMemberIds(targetGuild, result.leaguePhase.slots.filter(item => item.type === 'team').flatMap(slot => getTeamUserIds(findTeamById(slot.teamId))));
  for (const userId of leagueUserIds) { const member = await targetGuild.members.fetch(userId).catch(() => null); if (member && !member.roles.cache.has(role.id)) await member.roles.add(role.id, 'Teilnahme an der Ligaphase').catch(() => null); }
  const overview = await ensureLeaguePhaseChannel(targetGuild, settings, result.leaguePhase.overviewChannelId, 'ligaphase', role.id, leagueUserIds); const results = await ensureLeaguePhaseChannel(targetGuild, settings, result.leaguePhase.resultsChannelId, 'ligaphase-ergebnisse', role.id, leagueUserIds); const video = await ensureLeaguePhaseChannel(targetGuild, settings, result.leaguePhase.videoChannelId, LEAGUE_PHASE_VIDEO_CHANNEL_NAME, role.id, leagueUserIds);
  updateEventData(eventKey, event => { event.leaguePhase.roleId = role.id; event.leaguePhase.overviewChannelId = overview.id; event.leaguePhase.resultsChannelId = results.id; event.leaguePhase.videoChannelId = video.id; result.event = event; result.leaguePhase = event.leaguePhase; return event; });
  updateJson(FILES.messages, createMessagesDefault(), messages => { messages.leaguePhase = messages.leaguePhase || {}; messages.leaguePhase[eventKey] = { ...(messages.leaguePhase[eventKey] || {}), cycleKey: result.event.cycle?.cycleKey || null, roleId: role.id, overviewChannelId: overview.id, resultsChannelId: results.id, videoChannelId: video.id }; return messages; });
  const accessCheck = await verifyLeaguePhaseAccess({ guild: targetGuild, settings, phase: result.leaguePhase });
  if (!accessCheck.ok) throw new Error(`Ligaphasen-Rollen-/Berechtigungspruefung fehlgeschlagen: ${JSON.stringify(accessCheck)}`);
  console.info(`[league-phase] ${eventKey}: Ligaphasenrolle und -kanaele erstellt/wiederverwendet.`); await refreshLeaguePhasePosts(client, eventKey);
  const { scheduleLeaguePhase } = require('./league-phase-releases');
  scheduleLeaguePhase(client, eventKey);
  return { ...result, event: readEventData(eventKey), leaguePhase: readEventData(eventKey).leaguePhase };
}
module.exports = { LEAGUE_PHASE_CATEGORY_ID, LEAGUE_PHASE_ROLE_NAME, LEAGUE_PHASE_VIDEO_CHANNEL_NAME, buildLeaguePhaseButtons, drawLeaguePhaseForEvent, ensureLeaguePhaseChannel, ensureLeaguePhaseRole, getExistingGuildMemberIds, refreshLeaguePhasePosts, verifyLeaguePhaseAccess };
