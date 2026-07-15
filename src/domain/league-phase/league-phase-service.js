'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');
const { getConfiguredGuild, getTeamUserIds } = require('../groups/group-roles');
const { recalculateGroupStandings } = require('../groups/group-results');
const { createLeaguePhaseDraw, validateLeaguePhaseDraw } = require('./league-phase-draw');
const { renderLeagueSchedule, renderLeagueTable } = require('../../../utils/league-phase-renderer');

function buttons(eventKey) { return new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`group_result_open:${eventKey}:league`).setLabel('Ergebnis eintragen').setEmoji('⚽').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`group_admin_result_open:${eventKey}:league`).setLabel('Admin-Ergebnis').setEmoji('🛠️').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId(`group_replacement_open:${eventKey}:league`).setLabel('Nachruecker einsetzen').setEmoji('🔁').setStyle(ButtonStyle.Secondary)
); }
async function upsert(channel, id, payload) { const old = id ? await channel.messages.fetch(id).catch(() => null) : null; return old ? old.edit(payload) : channel.send(payload); }
function imagePayload(buffer, name, components = []) { return { content: null, embeds: [new EmbedBuilder().setImage(`attachment://${name}`)], attachments: [], files: [{ attachment: buffer, name }], components, allowedMentions: { parse: [] } }; }
async function ensureRole(guild, phase) { if (phase.roleId) { const role = await guild.roles.fetch(phase.roleId).catch(() => null); if (role) return role; } return guild.roles.cache.find(role => role.name === 'LNC Ligaphase') || guild.roles.create({ name: 'LNC Ligaphase', mentionable: false, reason: 'Loco Night Cup 20er-Ligaphase' }); }
async function ensureChannel(guild, settings, id, name, roleId, isPublic = false) {
  const found = id ? await guild.channels.fetch(id).catch(() => null) : guild.channels.cache.find(channel => channel.name === name && channel.type === ChannelType.GuildText);
  if (found?.isTextBased?.()) {
    await found.permissionOverwrites.edit(guild.roles.everyone.id, isPublic ? { ViewChannel: true, ReadMessageHistory: true } : { ViewChannel: false }).catch(() => null);
    await found.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).catch(() => null);
    return found;
  }
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: settings.categories?.groupCategoryId || undefined, permissionOverwrites: [
    isPublic ? { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] } : { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    { id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
  ], reason: 'Loco Night Cup 20er-Ligaphase' });
}
async function refreshLeaguePhasePosts(client, eventKey) {
  if (!client) return null; const event = readEventData(eventKey); const phase = event.leaguePhase; if (!phase) return null;
  recalculateGroupStandings(phase); const table = await renderLeagueTable(phase); const schedule = await renderLeagueSchedule(phase);
  const overview = await client.channels.fetch(phase.overviewChannelId).catch(() => null); const results = await client.channels.fetch(phase.resultsChannelId).catch(() => null); if (!overview || !results) return null;
  const ot = await upsert(overview, phase.messages.overviewTableMessageId, imagePayload(table, `ligaphase-table-${eventKey}.png`));
  const os = await upsert(overview, phase.messages.overviewScheduleMessageId, imagePayload(schedule, `ligaphase-schedule-${eventKey}.png`));
  const rt = await upsert(results, phase.messages.resultsTableMessageId, imagePayload(table, `ligaphase-table-results-${eventKey}.png`));
  const rs = await upsert(results, phase.messages.resultsScheduleMessageId, imagePayload(schedule, `ligaphase-schedule-results-${eventKey}.png`, [buttons(eventKey)]));
  updateEventData(eventKey, stored => { Object.assign(stored.leaguePhase.messages, { overviewTableMessageId: ot.id, overviewScheduleMessageId: os.id, resultsTableMessageId: rt.id, resultsScheduleMessageId: rs.id }); stored.leaguePhase.standings = phase.standings; return stored; });
  const { refreshLiveSchedule } = require('../live-schedule');
  await refreshLiveSchedule(client, eventKey).catch(error => console.warn(`[league-phase] Oeffentlicher Spielplan konnte nicht aktualisiert werden: ${error.message}`));
  console.info(`[league-phase] ${eventKey}: Ligaphasengrafiken aktualisiert.`); return { ot, os, rt, rs };
}
async function drawLeaguePhaseForEvent({ eventKey, actorUserId = null, client = null, guild = null, now = new Date() }) {
  let result; updateEventData(eventKey, event => { if (Number(event.format?.size) !== 20 || !event.format?.lockedAt) throw new Error('Ligaphase ist ausschliesslich fuer das final gelockte 20er-Format erlaubt.'); if (event.leaguePhase?.status && event.leaguePhase.status !== 'not_created') { result = { event, leaguePhase: event.leaguePhase, restored: true }; return event; }
    const phase = createLeaguePhaseDraw({ eventKey, participants: event.format.participants, createdAt: now.toISOString() }); validateLeaguePhaseDraw(phase); recalculateGroupStandings(phase); phase.drawnBy = actorUserId ? String(actorUserId) : null; event.status = 'league_phase'; event.phaseType = 'league'; event.leaguePhase = phase; event.groups = { ...(event.groups || {}), status: 'not_created', groups: {} }; result = { event, leaguePhase: phase, restored: false }; return event; });
  console.info(`[league-phase] ${eventKey}: 20er-Ligaphase erkannt; Auslosung erfolgreich validiert.`);
  if (!client) return result; const settings = readJson(FILES.settings, createSettingsDefault()); const targetGuild = guild || await getConfiguredGuild(client, settings); if (!targetGuild) return result;
  const role = await ensureRole(targetGuild, result.leaguePhase); for (const slot of result.leaguePhase.slots.filter(item => item.type === 'team')) for (const userId of getTeamUserIds(findTeamById(slot.teamId))) { const member = await targetGuild.members.fetch(userId).catch(() => null); if (member && !member.roles.cache.has(role.id)) await member.roles.add(role.id).catch(() => null); }
  const overview = await ensureChannel(targetGuild, settings, result.leaguePhase.overviewChannelId, 'ligaphase', role.id, true); const results = await ensureChannel(targetGuild, settings, result.leaguePhase.resultsChannelId, 'ligaphase-ergebnisse', role.id, false);
  updateEventData(eventKey, event => { event.leaguePhase.roleId = role.id; event.leaguePhase.overviewChannelId = overview.id; event.leaguePhase.resultsChannelId = results.id; result.event = event; result.leaguePhase = event.leaguePhase; return event; });
  updateJson(FILES.messages, createMessagesDefault(), messages => { messages.leaguePhase = messages.leaguePhase || {}; messages.leaguePhase[eventKey] = { ...(messages.leaguePhase[eventKey] || {}), cycleKey: result.event.cycle?.cycleKey || null, roleId: role.id, overviewChannelId: overview.id, resultsChannelId: results.id }; return messages; });
  console.info(`[league-phase] ${eventKey}: Ligaphasenrolle und -kanaele erstellt/wiederverwendet.`); await refreshLeaguePhasePosts(client, eventKey);
  const { scheduleLeaguePhase } = require('./league-phase-releases');
  scheduleLeaguePhase(client, eventKey);
  return { ...result, event: readEventData(eventKey), leaguePhase: readEventData(eventKey).leaguePhase };
}
module.exports = { drawLeaguePhaseForEvent, refreshLeaguePhasePosts };
