'use strict';

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
} = require('discord.js');
const { EVENT_KEYS } = require('../../app/constants');
const { FILES, ROOT_DIR, readJson, updateJson } = require('../../storage');
const { createSettingsDefault, createTournamentLeadershipDefault } = require('../../storage/defaults');
const { getPlannedSchedule, parseDateTime, toDateOnly } = require('../checkins/checkin-schedule');
const { readEventData } = require('../events/event-repository');
const { applyGroupChannelPermissionOverwrites, buildGroupChannelPermissionOverwrites } = require('../groups/group-channels');
const { getConfiguredGuild, getTeamUserIds } = require('../groups/group-roles');
const { findTeamById } = require('../teams/team-service');

const INTERNAL_CHANNEL_ID = '1534523164783280158';
const TIMEZONE = 'Europe/Berlin';
const BANNER_NAME = 'turnierleitung-banner.png';
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const ROUND_INFO = {
  round_of_16: ['Achtelfinale', 'nightcup-info-achtelfinale'],
  quarter_final: ['Viertelfinale', 'nightcup-info-viertelfinale'],
  semi_final: ['Halbfinale', 'nightcup-info-halbfinale'],
  third_place: ['Platz 3', 'nightcup-info-platz-3'],
  final: ['Finale', 'nightcup-info-finale'],
};
const locks = new Map();
let activeClient = null;
let reconcileTimer = null;

function nowIso(now = new Date()) { return now.toISOString(); }
function unique(values) { return [...new Set((values || []).filter(Boolean).map(String))]; }
function readSettings() { return readJson(FILES.settings, createSettingsDefault()); }
function readStore() { return readJson(FILES.tournamentLeadership, createTournamentLeadershipDefault()); }
function mentionUsers(ids) { return unique(ids).length ? unique(ids).map(id => `<@${id}>`).join('\n') : 'Noch niemand'; }
function roleIds(settings) { return unique([...(settings.roles?.adminRoleIds || []), ...(settings.roles?.cupLeadRoleIds || []), ...(settings.permissions?.adminRoleIds || []), ...(settings.permissions?.cupLeadRoleIds || [])]); }
function adminRoleIds(settings) { return unique([...(settings.roles?.adminRoleIds || []), ...(settings.permissions?.adminRoleIds || [])]); }
function roleMentionContent(settings) { return roleIds(settings).map(id => `<@&${id}>`).join(' '); }
function isAuthorized(member, settings) { return roleIds(settings).some(id => member?.roles?.cache?.has(id)); }
function isAdmin(member, settings) { return adminRoleIds(settings).some(id => member?.roles?.cache?.has(id)); }
function dateTitle(dateValue) {
  const date = new Date(`${dateValue}T12:00:00.000Z`);
  const day = DAY_LABELS[date.getUTCDay()];
  return `${day}, ${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCFullYear()).slice(-2)}`;
}
function currentEventKey(now = new Date()) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(now);
  return DAY_KEYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short)];
}
function getCycle(cycleKey) { return readStore().cycles?.[cycleKey] || null; }
function updateCycle(cycleKey, updater) {
  let result;
  updateJson(FILES.tournamentLeadership, createTournamentLeadershipDefault(), store => {
    store.cycles = store.cycles || {};
    const current = store.cycles[cycleKey] || null;
    result = updater(current, store);
    store.cycles[cycleKey] = result;
    store.meta = { ...(store.meta || {}), updatedAt: nowIso() };
    return store;
  });
  return result;
}
async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => next);
  locks.set(key, queued);
  await previous;
  try { return await task(); } finally { release(); if (locks.get(key) === queued) locks.delete(key); }
}
function createCycleState(eventKey, eventDate, cycleKey, endsAt) {
  return {
    cycleKey, eventKey, eventDate, status: 'active', createdAt: nowIso(), updatedAt: nowIso(),
    availability: { status: 'open', channelId: null, messageId: null, endsAt, yesUserIds: [], noUserIds: [] },
    assignment: { status: 'not_created', type: null, messageId: null, groups: {}, leagueUserIds: [], knockoutUserIds: [], remindedAt: null, lockedAt: null },
    infoChannels: { groups: {}, league: null, knockout: {} }, systemMessageIds: [],
  };
}
function bannerPath(settings) { return path.resolve(ROOT_DIR, settings.assets?.tournamentLeadershipBannerPath || 'assets/tournament-leadership/tournament-leadership-banner.png'); }
function bannerPayload(embed, components, settings, content) {
  const filePath = bannerPath(settings);
  if (!fs.existsSync(filePath)) throw new Error(`Turnierleitungs-Banner fehlt: ${filePath}`);
  embed.setImage(`attachment://${BANNER_NAME}`);
  return { content, embeds: [embed], components, attachments: [], files: [new AttachmentBuilder(filePath, { name: BANNER_NAME })], allowedMentions: { parse: [], roles: roleIds(settings) } };
}
function availabilityEmbed(state) {
  return new EmbedBuilder().setColor(0xc51f33).setTitle(`Turnierleitung \u2013 ${dateTitle(state.eventDate)}`).setDescription([
    'Wer \u00fcbernimmt heute die Turnierleitung f\u00fcr den Loco Night Cup?',
    '', 'Bitte stimmt immer ab, auch wenn bereits gen\u00fcgend Turnierleitungen zugesagt haben. Die Zusagen werden sp\u00e4ter f\u00fcr die Verteilung der Gruppen, der Liga und der K.O.-Phase verwendet.',
    '', 'Die Abstimmung endet heute um **22:00 Uhr**.',
  ].join('\n')).addFields(
    { name: `\u00dcbernimmt heute (${state.availability.yesUserIds.length})`, value: mentionUsers(state.availability.yesUserIds), inline: true },
    { name: `Keine Zeit (${state.availability.noUserIds.length})`, value: mentionUsers(state.availability.noUserIds), inline: true },
  ).setFooter({ text: state.availability.status === 'open' ? 'Abstimmung ge\u00f6ffnet' : 'Abstimmung beendet' });
}
function availabilityComponents(state) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tl_availability:${state.cycleKey}:yes`).setLabel('Ja').setStyle(ButtonStyle.Success).setDisabled(state.availability.status !== 'open'),
    new ButtonBuilder().setCustomId(`tl_availability:${state.cycleKey}:no`).setLabel('Nein').setStyle(ButtonStyle.Danger).setDisabled(state.availability.status !== 'open'),
  )];
}
async function getInternalChannel(client, settings) {
  const id = settings.channels?.tournamentLeadershipChannelId || INTERNAL_CHANNEL_ID;
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel?.send) throw new Error(`Interner Turnierleitungs-Kanal nicht erreichbar: ${id}`);
  return channel;
}
async function refreshAvailabilityMessage(client, state) {
  const settings = readSettings(); const channel = await getInternalChannel(client, settings);
  const message = state.availability.messageId ? await channel.messages.fetch(state.availability.messageId).catch(() => null) : null;
  const payload = bannerPayload(availabilityEmbed(state), availabilityComponents(state), settings, roleMentionContent(settings));
  return message ? message.edit(payload) : channel.send(payload);
}
async function ensureDailyAvailability(client, now = new Date(), { immediate = false } = {}) {
  const settings = readSettings(); const eventKey = currentEventKey(now); const event = readEventData(eventKey);
  const planned = getPlannedSchedule(eventKey, event, settings, now); const date = toDateOnly(now, TIMEZONE);
  if (planned.eventDate !== date) return null;
  const pollAt = parseDateTime(date, '20:00', false, TIMEZONE); const endsAt = parseDateTime(date, '22:00', false, TIMEZONE);
  const firstDeploymentPending = !readStore().meta?.firstDeploymentPollCreatedAt;
  if ((!immediate || !firstDeploymentPending) && now < pollAt) return null;
  const existing = getCycle(planned.cycleKey);
  if (existing && ['active', 'completed', 'cleaned'].includes(existing.status)) {
    if (firstDeploymentPending) updateJson(FILES.tournamentLeadership, createTournamentLeadershipDefault(), store => ({ ...store, meta: { ...(store.meta || {}), firstDeploymentPollCreatedAt: nowIso(now), updatedAt: nowIso(now) } }));
    return existing;
  }
  const state = createCycleState(eventKey, date, planned.cycleKey, endsAt.toISOString());
  const message = await refreshAvailabilityMessage(client, state);
  state.availability.channelId = message.channel.id; state.availability.messageId = message.id; state.systemMessageIds.push(message.id);
  updateCycle(state.cycleKey, (current, store) => { store.meta = { ...(store.meta || {}), firstDeploymentPollCreatedAt: store.meta?.firstDeploymentPollCreatedAt || nowIso(now) }; return state; });
  console.log(`[tournament-leadership] Verf\u00fcgbarkeitsabfrage erstellt: ${state.cycleKey}`);
  return state;
}
async function closeAvailability(client, cycleKey, now = new Date()) {
  let state = getCycle(cycleKey); if (!state || state.availability.status !== 'open' || now < new Date(state.availability.endsAt)) return state;
  state = updateCycle(cycleKey, current => ({ ...current, updatedAt: nowIso(now), availability: { ...current.availability, status: 'closed', closedAt: nowIso(now) } }));
  await refreshAvailabilityMessage(client, state); console.log(`[tournament-leadership] Abstimmung beendet: ${cycleKey}`); return state;
}
function assignmentScopes(state, event) {
  if (state.assignment.type === 'groups') return [...Object.keys(event.groups?.groups || {}).sort().map(key => ({ key: `group_${key}`, label: `Gruppe ${key}` })), { key: 'knockout', label: 'K.O.-Phase' }];
  return [{ key: 'league', label: 'Liga' }, { key: 'knockout', label: 'K.O.-Phase' }];
}
function assignmentComponents(state, event) {
  const disabled = state.assignment.status === 'locked'; const scopes = assignmentScopes(state, event); const rows = [];
  for (let index = 0; index < scopes.length; index += 5) rows.push(new ActionRowBuilder().addComponents(scopes.slice(index, index + 5).map(scope => new ButtonBuilder().setCustomId(`tl_assignment:${state.cycleKey}:${scope.key}`).setLabel(scope.label).setStyle(ButtonStyle.Primary).setDisabled(disabled))));
  return rows;
}
function openScopes(state, event) {
  const open = [];
  if (state.assignment.type === 'groups') for (const key of Object.keys(event.groups?.groups || {}).sort()) if (!state.assignment.groups?.[key]) open.push(`Gruppe ${key}`);
  if (state.assignment.type === 'league' && !(state.assignment.leagueUserIds || []).length) open.push('Liga');
  if (!(state.assignment.knockoutUserIds || []).length) open.push('K.O.-Phase');
  return open;
}
function assignmentEmbed(state, event) {
  const groups = state.assignment.type === 'groups'; const embed = new EmbedBuilder().setColor(0xc51f33).setTitle(`Turnierleitung einteilen \u2013 ${dateTitle(state.eventDate)}`);
  embed.setDescription(groups ? [
    'Bitte w\u00e4hlt vor Turnierstart die Gruppen und Bereiche aus, die ihr heute betreuen m\u00f6chtet.', '',
    '\u2022 Eine Turnierleitung darf mehrere Gruppen \u00fcbernehmen.', '\u2022 Jede Gruppe kann nur von einer Person geleitet werden.', '\u2022 Die K.O.-Phase kann von mehreren Personen \u00fcbernommen werden.', '\u2022 Gruppen und K.O.-Phase d\u00fcrfen gleichzeitig gew\u00e4hlt werden.', '\u2022 Nicht vergebene Bereiche werden zum Turnierstart automatisch zugewiesen.', '\u2022 Verf\u00fcgbare Personen m\u00fcssen nicht zwingend einen Bereich \u00fcbernehmen.',
  ].join('\n') : [
    'Bitte w\u00e4hlt vor Turnierstart die Bereiche aus, die ihr heute betreuen m\u00f6chtet.', '', '\u2022 Liga und K.O.-Phase k\u00f6nnen jeweils von mehreren Personen \u00fcbernommen werden.', '\u2022 Eine Person darf beide Bereiche ausw\u00e4hlen.', '\u2022 Nicht besetzte Bereiche werden zum Turnierstart automatisch zugewiesen.', '\u2022 Verf\u00fcgbare Personen m\u00fcssen nicht zwingend einen Bereich \u00fcbernehmen.',
  ].join('\n'));
  if (groups) for (const key of Object.keys(event.groups?.groups || {}).sort()) embed.addFields({ name: `Gruppe ${key}`, value: state.assignment.groups?.[key] ? `<@${state.assignment.groups[key]}>` : 'Noch offen', inline: true });
  else embed.addFields({ name: 'Liga', value: mentionUsers(state.assignment.leagueUserIds), inline: true });
  embed.addFields({ name: 'K.O.-Phase', value: mentionUsers(state.assignment.knockoutUserIds), inline: true });
  const open = openScopes(state, event); if (state.assignment.remindedAt && open.length) embed.addFields({ name: 'Noch nicht vergeben', value: open.map(item => `\u2022 ${item}`).join('\n') });
  return embed.setFooter({ text: state.assignment.status === 'locked' ? 'Zuweisung zum Turnierstart gesperrt' : 'Erneut klicken, um die eigene Auswahl freizugeben' });
}
async function refreshAssignmentMessage(client, state, event = readEventData(state.eventKey)) {
  const settings = readSettings(); const channel = await getInternalChannel(client, settings); const old = state.assignment.messageId ? await channel.messages.fetch(state.assignment.messageId).catch(() => null) : null;
  const payload = bannerPayload(assignmentEmbed(state, event), assignmentComponents(state, event), settings, roleMentionContent(settings));
  return old ? old.edit(payload) : channel.send(payload);
}
async function ensureAssignmentForEvent({ client, eventKey }) {
  const event = readEventData(eventKey); const cycleKey = event.cycle?.cycleKey; if (!cycleKey) return null; let state = getCycle(cycleKey); if (!state || state.status !== 'active') return null;
  const isLeague = event.leaguePhase?.phaseType === 'league' && event.leaguePhase?.status !== 'not_created';
  const hasGroups = Object.keys(event.groups?.groups || {}).length > 0;
  if (!isLeague && !hasGroups) return null;
  if (state.assignment.status !== 'not_created') return state;
  state = updateCycle(cycleKey, current => ({ ...current, assignment: { ...current.assignment, status: 'active', type: isLeague ? 'league' : 'groups', createdAt: nowIso() }, updatedAt: nowIso() }));
  const message = await refreshAssignmentMessage(client, state, event);
  state = updateCycle(cycleKey, current => ({ ...current, assignment: { ...current.assignment, messageId: message.id }, systemMessageIds: unique([...(current.systemMessageIds || []), message.id]) }));
  console.log(`[tournament-leadership] ${state.assignment.type === 'league' ? 'Liga-/K.O.' : 'Gruppen-/K.O.'}-Zuweisung erstellt: ${cycleKey}`); return state;
}
function availableUserIds(state) { return unique(state.availability?.yesUserIds); }
function balancedGroupAssignments(groupKeys, existing, eligible) {
  const result = { ...(existing || {}) }; if (!eligible.length) return result;
  const counts = new Map(eligible.map(id => [id, Object.values(result).filter(value => value === id).length]));
  for (const key of groupKeys.sort()) if (!result[key]) { const selected = eligible.slice().sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0) || a.localeCompare(b))[0]; result[key] = selected; counts.set(selected, (counts.get(selected) || 0) + 1); }
  return result;
}
async function fallbackUsers(guild, settings) {
  await guild.members.fetch().catch(() => null); const roles = roleIds(settings);
  return [...guild.members.cache.values()].filter(member => !member.user?.bot && roles.some(id => member.roles.cache.has(id))).map(member => member.id).sort();
}
async function autoAssignAtStart(client, state, event) {
  if (state.assignment.status !== 'active') return state; const settings = readSettings(); const guild = await getConfiguredGuild(client, settings); if (!guild) return state;
  let eligible = availableUserIds(state); let fallback = false;
  if (!eligible.length) { eligible = await fallbackUsers(guild, settings); fallback = true; }
  if (!eligible.length) { await postWarning(client, state, 'Keine verf\u00fcgbare Turnierleitung konnte sicher ermittelt werden. Info-Kan\u00e4le wurden nicht erstellt.'); return state; }
  state = updateCycle(state.cycleKey, current => {
    const assignment = { ...current.assignment, status: 'locked', lockedAt: nowIso() };
    if (assignment.type === 'groups') assignment.groups = balancedGroupAssignments(Object.keys(event.groups?.groups || {}), assignment.groups, eligible);
    else if (!(assignment.leagueUserIds || []).length) assignment.leagueUserIds = [eligible[0]];
    if (!(assignment.knockoutUserIds || []).length) assignment.knockoutUserIds = [eligible[0]];
    return { ...current, assignment, updatedAt: nowIso() };
  });
  if (fallback) await postWarning(client, state, 'Niemand hat mit Ja abgestimmt. Die Zust\u00e4ndigkeiten wurden mit dem vorhandenen Admin-/Turnierleitungs-Fallback besetzt.');
  await refreshAssignmentMessage(client, state, event); await syncPhaseInfoChannels(client, state.eventKey);
  console.log(`[tournament-leadership] Automatische Verteilung abgeschlossen: ${state.cycleKey}`); return state;
}
async function postWarning(client, state, text) {
  const settings = readSettings(); const channel = await getInternalChannel(client, settings); const message = await channel.send({ content: `${roleMentionContent(settings)}\n\u26a0\ufe0f **Turnierleitung \u2013 ${dateTitle(state.eventDate)}**\n${text}`, allowedMentions: { parse: [], roles: roleIds(settings) } });
  updateCycle(state.cycleKey, current => ({ ...current, systemMessageIds: unique([...(current.systemMessageIds || []), message.id]) })); return message;
}
function infoEmbed(label, leadIds, settings) {
  const rulesId = settings.channels?.rulebookChannelId || settings.channels?.rulesChannelId;
  return new EmbedBuilder().setColor(0xc51f33).setTitle(`Night Cup Informationen \u2013 ${label}`).addFields(
    { name: 'Zust\u00e4ndige Turnierleitung', value: mentionUsers(leadIds) },
    { name: 'Regelwerk', value: rulesId ? `<#${rulesId}>` : 'Bitte beachtet das aktuelle Loco-Night-Cup-Regelwerk.' },
    { name: 'Wichtiger Hinweis', value: 'Bei Fragen, Problemen oder Protesten bitte ausschlie\u00dflich die hier genannte Turnierleitung pingen. Bitte nicht gleichzeitig weitere Moderatoren oder Admins anschreiben, damit es keine unterschiedlichen Aussagen gibt.' },
  );
}
async function ensureInfoChannel({ guild, settings, name, parentId, overwrites, existing, label, leadIds }) {
  let channel = existing?.channelId ? await guild.channels.fetch(existing.channelId).catch(() => null) : null;
  if (!channel) channel = guild.channels.cache.find(item => item.name === name && item.parentId === parentId) || null;
  if (!channel) channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId || undefined, permissionOverwrites: overwrites, reason: 'Loco Night Cup Turnierleitungs-Info' });
  else await applyGroupChannelPermissionOverwrites(channel, overwrites);
  let message = existing?.messageId ? await channel.messages.fetch(existing.messageId).catch(() => null) : null;
  const payload = { embeds: [infoEmbed(label, leadIds, settings)], allowedMentions: { parse: [], users: unique(leadIds) } };
  message = message ? await message.edit(payload) : await channel.send(payload);
  return { channel, message };
}
function groupTeamUsers(group) { return unique((group.slots || []).filter(slot => slot.type === 'team').flatMap(slot => getTeamUserIds(findTeamById(slot.teamId)))); }
function leagueTeamUsers(phase) { return unique((phase.slots || []).filter(slot => slot.type === 'team').flatMap(slot => getTeamUserIds(findTeamById(slot.teamId)))); }
function roundTeamUsers(round) { return unique((round?.matches || []).flatMap(match => [match.home, match.away]).filter(item => item?.type === 'team').flatMap(item => getTeamUserIds(findTeamById(item.teamId)))); }
async function orderChannels(channels) { const existing = channels.filter(Boolean); if (!existing.length) return; const base = Math.min(...existing.map(channel => Number(channel.position || 0))); for (let index = 0; index < existing.length; index += 1) if (typeof existing[index].setPosition === 'function') await existing[index].setPosition(base + index).catch(() => null); }
async function syncPhaseInfoChannels(client, eventKey) {
  const event = readEventData(eventKey); const state = getCycle(event.cycle?.cycleKey); if (!state || state.assignment.status !== 'locked') return null;
  const settings = readSettings(); const guild = await getConfiguredGuild(client, settings); if (!guild) return null; const refs = JSON.parse(JSON.stringify(state.infoChannels || { groups: {}, league: null, knockout: {} }));
  if (state.assignment.type === 'groups') for (const [key, group] of Object.entries(event.groups?.groups || {})) {
    const leadIds = state.assignment.groups?.[key] ? [state.assignment.groups[key]] : []; if (!leadIds.length) continue;
    const main = await guild.channels.fetch(group.channelId).catch(() => null); if (!main) continue;
    const overwrites = buildGroupChannelPermissionOverwrites({ guild, settings, roleId: group.roleId, userIds: unique([...groupTeamUsers(group), ...leadIds]) });
    const info = await ensureInfoChannel({ guild, settings, name: `nightcup-info-gruppe-${key.toLowerCase()}`, parentId: main.parentId, overwrites, existing: refs.groups?.[key], label: `Gruppe ${key}`, leadIds });
    refs.groups[key] = { channelId: info.channel.id, messageId: info.message.id }; const results = await guild.channels.fetch(group.resultsChannelId).catch(() => null); const video = await guild.channels.fetch(group.videoChannelId).catch(() => null); await orderChannels([info.channel, main, results, video]);
  }
  if (state.assignment.type === 'league' && state.assignment.leagueUserIds.length) {
    const phase = event.leaguePhase; const main = await guild.channels.fetch(phase.overviewChannelId).catch(() => null); if (main) { const overwrites = buildGroupChannelPermissionOverwrites({ guild, settings, roleId: phase.roleId, userIds: unique([...leagueTeamUsers(phase), ...state.assignment.leagueUserIds]) }); const info = await ensureInfoChannel({ guild, settings, name: 'nightcup-info-liga', parentId: main.parentId, overwrites, existing: refs.league, label: 'Liga', leadIds: state.assignment.leagueUserIds }); refs.league = { channelId: info.channel.id, messageId: info.message.id }; await orderChannels([info.channel, main, await guild.channels.fetch(phase.resultsChannelId).catch(() => null), await guild.channels.fetch(phase.videoChannelId).catch(() => null)]); }
  }
  if (event.knockout?.status !== 'not_created' && state.assignment.knockoutUserIds.length) for (const [roundKey, [label, name]] of Object.entries(ROUND_INFO)) {
    const round = event.knockout?.rounds?.[roundKey]; if (!round?.matches?.length || round.status === 'not_needed') continue; const main = await guild.channels.fetch(round.channelId).catch(() => null); if (!main) continue;
    const roleId = settings.roles?.knockoutRoleIds?.[roundKey] || null; const overwrites = buildGroupChannelPermissionOverwrites({ guild, settings, roleId, userIds: unique([...roundTeamUsers(round), ...state.assignment.knockoutUserIds]) });
    const info = await ensureInfoChannel({ guild, settings, name, parentId: main.parentId, overwrites, existing: refs.knockout?.[roundKey], label, leadIds: state.assignment.knockoutUserIds }); refs.knockout[roundKey] = { channelId: info.channel.id, messageId: info.message.id }; await orderChannels([info.channel, main, await guild.channels.fetch(round.resultsChannelId).catch(() => null), await guild.channels.fetch(round.videoChannelId).catch(() => null)]);
  }
  updateCycle(state.cycleKey, current => ({ ...current, infoChannels: refs, updatedAt: nowIso() })); console.log(`[tournament-leadership] Info-Kan\u00e4le synchronisiert: ${state.cycleKey}`); return refs;
}
async function handleInteraction(interaction, client) {
  const id = String(interaction.customId || ''); if (!id.startsWith('tl_')) return false; const settings = readSettings();
  if (!isAuthorized(interaction.member, settings)) throw new Error('Nur Admins und Turnierleitungen d\u00fcrfen diese Auswahl verwenden.');
  if (id.startsWith('tl_availability:')) { const [, cycleKey, choice] = id.split(':'); await interaction.deferUpdate(); try { await withLock(cycleKey, async () => { let state = getCycle(cycleKey); if (!state || state.availability.status !== 'open') throw new Error('Diese Abstimmung ist bereits beendet.'); const userId = String(interaction.user.id); state = updateCycle(cycleKey, current => { const yes = new Set(current.availability.yesUserIds || []); const no = new Set(current.availability.noUserIds || []); const target = choice === 'yes' ? yes : no; const other = choice === 'yes' ? no : yes; other.delete(userId); target.has(userId) ? target.delete(userId) : target.add(userId); return { ...current, availability: { ...current.availability, yesUserIds: [...yes], noUserIds: [...no] }, updatedAt: nowIso() }; }); await refreshAvailabilityMessage(client, state); console.log(`[tournament-leadership] Stimme ${choice}: ${cycleKey}/${userId}`); }); } catch (error) { await interaction.followUp({ content: error.message, flags: 64 }).catch(() => null); } return true; }
  if (id.startsWith('tl_assignment:')) { const [, cycleKey, scope] = id.split(':'); await interaction.deferUpdate(); try { await withLock(cycleKey, async () => { let state = getCycle(cycleKey); if (!state || state.assignment.status !== 'active') throw new Error('Diese Zust\u00e4ndigkeitsauswahl ist nicht mehr ge\u00f6ffnet.'); const userId = String(interaction.user.id); if (!availableUserIds(state).includes(userId) && !isAdmin(interaction.member, settings)) throw new Error('Du musst bei der Verf\u00fcgbarkeitsabfrage mit Ja abgestimmt haben.'); const event = readEventData(state.eventKey); state = updateCycle(cycleKey, current => { const assignment = { ...current.assignment, groups: { ...(current.assignment.groups || {}) }, leagueUserIds: [...(current.assignment.leagueUserIds || [])], knockoutUserIds: [...(current.assignment.knockoutUserIds || [])] }; if (scope.startsWith('group_')) { const key = scope.slice(6); const owner = assignment.groups[key]; if (owner && owner !== userId) throw new Error(`Diese Gruppe wird bereits von <@${owner}> geleitet. Bitte w\u00e4hle eine andere Gruppe aus.`); if (owner === userId) delete assignment.groups[key]; else assignment.groups[key] = userId; } else { const field = scope === 'league' ? 'leagueUserIds' : 'knockoutUserIds'; const set = new Set(assignment[field]); set.has(userId) ? set.delete(userId) : set.add(userId); assignment[field] = [...set]; } return { ...current, assignment, updatedAt: nowIso() }; }); await refreshAssignmentMessage(client, state, event); await syncPhaseInfoChannels(client, state.eventKey); console.log(`[tournament-leadership] Manuelle Auswahl ${scope}: ${cycleKey}/${userId}`); }); } catch (error) { await interaction.followUp({ content: error.message, flags: 64 }).catch(() => null); } return true; }
  return false;
}
async function reconcile(client = activeClient, now = new Date(), { startup = false } = {}) {
  if (!client) return null; await ensureDailyAvailability(client, now, { immediate: startup });
  for (const state of Object.values(readStore().cycles || {})) { if (state.status !== 'active') continue; await closeAvailability(client, state.cycleKey, now); const event = readEventData(state.eventKey); if (state.assignment.status === 'active') { const startAt = new Date(event.schedule?.tournamentStartAt || 0); const remaining = startAt.getTime() - now.getTime(); if (remaining <= 10 * 60 * 1000 && remaining > 0 && !state.assignment.remindedAt && openScopes(state, event).length) { const updated = updateCycle(state.cycleKey, current => ({ ...current, assignment: { ...current.assignment, remindedAt: nowIso(now) } })); await refreshAssignmentMessage(client, updated, event); } if (remaining <= 0) await autoAssignAtStart(client, getCycle(state.cycleKey), event); } if (getCycle(state.cycleKey)?.assignment?.status === 'locked') await syncPhaseInfoChannels(client, state.eventKey); }
  return true;
}
async function cleanupEvent(client, eventKey) {
  const event = readEventData(eventKey); const cycleKey = event.cycle?.cycleKey; const state = cycleKey ? getCycle(cycleKey) : null; if (!state || state.status === 'cleaned') return { cleaned: false };
  const settings = readSettings(); const channel = await getInternalChannel(client, settings).catch(() => null); const deletedMessages = [];
  for (const id of unique(state.systemMessageIds)) { const message = channel ? await channel.messages.fetch(id).catch(() => null) : null; if (message && await message.delete().then(() => true).catch(() => false)) deletedMessages.push(id); }
  const channelIds = unique([...Object.values(state.infoChannels?.groups || {}).map(item => item.channelId), state.infoChannels?.league?.channelId, ...Object.values(state.infoChannels?.knockout || {}).map(item => item.channelId)]); const deletedChannels = [];
  for (const id of channelIds) { const info = await client.channels.fetch(id).catch(() => null); if (info && await info.delete('Loco Night Cup Turnierleitungs-Reset').then(() => true).catch(() => false)) deletedChannels.push(id); }
  updateCycle(cycleKey, current => ({ cycleKey, eventKey, eventDate: current.eventDate, status: 'cleaned', cleanedAt: nowIso(), availability: { status: 'cleared', yesUserIds: [], noUserIds: [] }, assignment: { status: 'cleared', groups: {}, leagueUserIds: [], knockoutUserIds: [] }, infoChannels: { groups: {}, league: null, knockout: {} }, systemMessageIds: [] }));
  console.log(`[tournament-leadership] Reset abgeschlossen: ${cycleKey}, Nachrichten=${deletedMessages.length}, Kan\u00e4le=${deletedChannels.length}`); return { cleaned: true, deletedMessages, deletedChannels };
}
async function init(client) { activeClient = client; await reconcile(client, new Date(), { startup: true }); if (!reconcileTimer) { reconcileTimer = setInterval(() => reconcile(client).catch(error => console.error('[tournament-leadership] Reconcile fehlgeschlagen:', error)), 60 * 1000); if (reconcileTimer.unref) reconcileTimer.unref(); } return true; }

module.exports = { INTERNAL_CHANNEL_ID, assignmentComponents, autoAssignAtStart, availabilityComponents, balancedGroupAssignments, cleanupEvent, closeAvailability, createCycleState, dateTitle, ensureAssignmentForEvent, ensureDailyAvailability, handleInteraction, init, reconcile, syncPhaseInfoChannels };
