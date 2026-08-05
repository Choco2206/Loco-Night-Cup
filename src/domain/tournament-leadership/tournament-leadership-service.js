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
  const counts = new Map(eligible.map(id => ×Şí¢G§²ÚîÆ­yÖRæ†2†–B’’’æÖ†ÖVÖ&W"ÓâÖVÖ&W"æ–B’ç6÷'B‚“°§Ğ¦7–æ2gVæ7F–öâWFô76–väE7F'B†6Æ–VçBÂ7FFRÂWfVçB’°¢–b‡7FFRæ76–væÖVçBç7FGW2ÓÒv7F—fRr’&WGW&â7FFS²6öç7B6WGF–æw2Ò&VE6WGF–æw2‚“²6öç7BwV–ÆBÒv—BvWD6öæf–wW&VDwV–ÆB†6Æ–VçBÂ6WGF–æw2“²–b‚wV–ÆB’&WGW&â7FFS°¢ÆWBVÆ–v–&ÆRÒf–Æ&ÆUW6W$–G2‡7FFR“²ÆWBfÆÆ&6²ÒfÇ6S°¢–b‚VÆ–v–&ÆRæÆVæwF‚’²VÆ–v–&ÆRÒv—BfÆÆ&6µW6W'2†wV–ÆBÂ6WGF–æw2“²fÆÆ&6²ÒG'VS²Ğ¢–b‚VÆ–v–&ÆRæÆVæwF‚’²v—B÷7Ev&æ–ær†6Æ–VçBÂ7FFRÂt¶V–æRfW&eÇSf6v&&RGW&æ–W&ÆV—GVær¶öæçFR6–6†W"W&Ö—GFVÇBvW&FVââ–æfòÔ¶åÇSSFÆRwW&FVâæ–6‡BW'7FVÆÇBâr“²&WGW&â7FFS²Ğ¢7FFRÒWFFT7–6ÆR‡7FFRæ7–6ÆT¶W’Â7W'&VçBÓâ°¢6öç7B76–væÖVçBÒ²ââæ7W'&VçBæ76–væÖVçBÂ7FGW3¢vÆö6¶VBrÂÆö6¶VDC¢æ÷t—6ò‚’Ó°¢–b†76–væÖVçBçG—RÓÓÒvw&÷W2r’76–væÖVçBæw&÷W2Ò&Ææ6VDw&÷W76–væÖVçG2„ö&¦V7Bæ¶W—2†WfVçBæw&÷W3òæw&÷W2ÇÂ·Ò’Â76–væÖVçBæw&÷W2ÂVÆ–v–&ÆR“°¢VÇ6R–b‚†76–væÖVçBæÆVwVUW6W$–G2ÇÂµÒ’æÆVæwF‚’76–væÖVçBæÆVwVUW6W$–G2Ò¶VÆ–v–&ÆU³ÕÓ°¢–b‚†76–væÖVçBæ¶æö6¶÷WEW6W$–G2ÇÂµÒ’æÆVæwF‚’76–væÖVçBæ¶æö6¶÷WEW6W$–G2Ò¶VÆ–v–&ÆU³ÕÓ°¢&WGW&â²ââæ7W'&VçBÂ76–væÖVçBÂWFFVDC¢æ÷t—6ò‚’Ó°¢Ò“°¢–b†fÆÆ&6²’v—B÷7Ev&æ–ær†6Æ–VçBÂ7FFRÂtæ–VÖæB†BÖ—B¦&vW7F–Ö×BâF–R§W7EÇSSFæF–v¶V—FVâwW&FVâÖ—BFVÒf÷&†æFVæVâFÖ–âÒõGW&æ–W&ÆV—GVæw2ÔfÆÆ&6²&W6WG§Bâr“°¢v—B&Vg&W6„76–væÖVçDÖW76vR†6Æ–VçBÂ7FFRÂWfVçB“²v—B7–æ5†6T–æfô6†ææVÇ2†6Æ–VçBÂ7FFRæWfVçD¶W’“°¢6öç6öÆRæÆör†·F÷W&æÖVçBÖÆVFW'6†—ÒWFöÖF—66†RfW'FV–ÇVær&vW66†Æ÷76Vã¢G·7FFRæ7–6ÆT¶W—Ö“²&WGW&â7FFS°§Ğ¦7–æ2gVæ7F–öâ÷7Ev&æ–ær†6Æ–VçBÂ7FFRÂFW‡B’°¢6öç7B6WGF–æw2Ò&VE6WGF–æw2‚“²6öç7B6†ææVÂÒv—BvWD–çFW&æÄ6†ææVÂ†6Æ–VçBÂ6WGF–æw2“²6öç7BÖW76vRÒv—B6†ææVÂç6VæB‡²6öçFVçC¢G·&öÆTÖVçF–öä6öçFVçB‡6WGF–æw2—ÕÆåÇS#fÇVfSb¢¥GW&æ–W&ÆV—GVærÇS#2G¶FFUF—FÆR‡7FFRæWfVçDFFR—Ò¢¥ÆâG·FW‡GÖÂÆÆ÷vVDÖVçF–öç3¢²'6S¢µÒÂ&öÆW3¢&öÆT–G2‡6WGF–æw2’ÒÒ“°¢WFFT7–6ÆR‡7FFRæ7–6ÆT¶W’Â7W'&VçBÓâ‡²ââæ7W'&VçBÂ7—7FVÔÖW76vT–G3¢Væ—VR…²âââ†7W'&VçBç7—7FVÔÖW76vT–G2ÇÂµÒ’ÂÖW76vRæ–EÒ’Ò’“²&WGW&âÖW76vS°§Ğ¦gVæ7F–öâ–æfôVÖ&VB†Æ&VÂÂÆVD–G2Â6WGF–æw2’°¢6öç7B'VÆW4–BÒ6WGF–æw2æ6†ææVÇ3òç'VÆV&öö´6†ææVÄ–BÇÂ6WGF–æw2æ6†ææVÇ3òç'VÆW46†ææVÄ–C°¢&WGW&âæWrVÖ&VD'V–ÆFW"‚’ç6WD6öÆ÷"ƒ†3Sc32’ç6WEF—FÆR†æ–v‡B7W–æf÷&ÖF–öæVâÇS#2G¶Æ&VÇÖ’æFDf–VÆG2€¢²æÖS¢u§W7EÇSSFæF–vRGW&æ–W&ÆV—GVærrÂfÇVS¢ÖVçF–öåW6W'2†ÆVD–G2’ÒÀ¢²æÖS¢u&VvVÇvW&²rÂfÇVS¢'VÆW4–BòÂ2G·'VÆW4–GÓæ¢t&—GFR&V6‡FWBF2·GVVÆÆRÆö6òÔæ–v‡BÔ7WÕ&VvVÇvW&²ârÒÀ¢²æÖS¢uv–6‡F–vW"†–çvV—2rÂfÇVS¢t&V’g&vVâÂ&ö&ÆVÖVâöFW"&÷FW7FVâ&—GFRW766†Æ–UÇSFfÆ–6‚F–R†–W"vVææçFRGW&æ–W&ÆV—GVær–ævVââ&—GFRæ–6‡BvÆV–6‡¦V—F–rvV—FW&RÖöFW&F÷&VâöFW"FÖ–ç2ç66‡&V–&VâÂFÖ—BW2¶V–æRVçFW'66†–VFÆ–6†VâW76vVâv–'BârÒÀ¢“°§Ğ¦7–æ2gVæ7F–öâVç7W&T–æfô6†ææVÂ‡²wV–ÆBÂ6WGF–æw2ÂæÖRÂ&VçD–BÂ÷fW'w&—FW2ÂW†—7F–ærÂÆ&VÂÂÆVD–G2Ò’°¢ÆWB6†ææVÂÒW†—7F–æsòæ6†ææVÄ–Bòv—BwV–ÆBæ6†ææVÇ2æfWF6‚†W†—7F–æræ6†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ’¢çVÆÃ°¢–b‚6†ææVÂ’6†ææVÂÒwV–ÆBæ6†ææVÇ2æ66†Ræf–æB†—FVÒÓâ—FVÒææÖRÓÓÒæÖRbb—FVÒç&VçD–BÓÓÒ&VçD–B’ÇÂçVÆÃ°¢–b‚6†ææVÂ’6†ææVÂÒv—BwV–ÆBæ6†ææVÇ2æ7&VFR‡²æÖRÂG—S¢6†ææVÅG—RäwV–ÆEFW‡BÂ&VçC¢&VçD–BÇÂVæFVf–æVBÂW&Ö—76–öä÷fW'w&—FW3¢÷fW'w&—FW2Â&V6öã¢tÆö6òæ–v‡B7WGW&æ–W&ÆV—GVæw2Ô–æfòrÒ“°¢VÇ6Rv—BÇ”w&÷W6†ææVÅW&Ö—76–öä÷fW'w&—FW2†6†ææVÂÂ÷fW'w&—FW2“°¢ÆWBÖW76vRÒW†—7F–æsòæÖW76vT–Bòv—B6†ææVÂæÖW76vW2æfWF6‚†W†—7F–æræÖW76vT–B’æ6F6‚‚‚’ÓâçVÆÂ’¢çVÆÃ°¢6öç7B–ÆöBÒ²VÖ&VG3¢¶–æfôVÖ&VB†Æ&VÂÂÆVD–G2Â6WGF–æw2•ÒÂÆÆ÷vVDÖVçF–öç3¢²'6S¢µÒÂW6W'3¢Væ—VR†ÆVD–G2’ÒÓ°¢ÖW76vRÒÖW76vRòv—BÖW76vRæVF—B‡–ÆöB’¢v—B6†ææVÂç6VæB‡–ÆöB“°¢&WGW&â²6†ææVÂÂÖW76vRÓ°§Ğ¦gVæ7F–öâw&÷WFVÕW6W'2†w&÷W’²&WGW&âVæ—VR‚†w&÷Wç6Æ÷G2ÇÂµÒ’æf–ÇFW"‡6Æ÷BÓâ6Æ÷BçG—RÓÓÒwFVÒr’æfÆDÖ‡6Æ÷BÓâvWEFVÕW6W$–G2†f–æEFVÔ'”–B‡6Æ÷BçFVÔ–B’’’“²Ğ¦gVæ7F–öâÆVwVUFVÕW6W'2‡†6R’²&WGW&âVæ—VR‚‡†6Rç6Æ÷G2ÇÂµÒ’æf–ÇFW"‡6Æ÷BÓâ6Æ÷BçG—RÓÓÒwFVÒr’æfÆDÖ‡6Æ÷BÓâvWEFVÕW6W$–G2†f–æEFVÔ'”–B‡6Æ÷BçFVÔ–B’’’“²Ğ¦gVæ7F–öâ&÷VæEFVÕW6W'2‡&÷VæB’²&WGW&âVæ—VR‚‡&÷VæCòæÖF6†W2ÇÂµÒ’æfÆDÖ†ÖF6‚Óâ¶ÖF6‚æ†öÖRÂÖF6‚æv•Ò’æf–ÇFW"†—FVÒÓâ—FVÓòçG—RÓÓÒwFVÒr’æfÆDÖ†—FVÒÓâvWEFVÕW6W$–G2†f–æEFVÔ'”–B†—FVÒçFVÔ–B’’’“²Ğ¦7–æ2gVæ7F–öâ÷&FW$6†ææVÇ2†6†ææVÇ2’²6öç7BW†—7F–ærÒ6†ææVÇ2æf–ÇFW"„&ööÆVâ“²–b‚W†—7F–æræÆVæwF‚’&WGW&ã²6öç7B&6RÒÖF‚æÖ–â‚ââæW†—7F–æræÖ†6†ææVÂÓâçVÖ&W"†6†ææVÂç÷6—F–öâÇÂ’’“²f÷"†ÆWB–æFW‚Ò²–æFW‚ÂW†—7F–æræÆVæwFƒ²–æFW‚³Ò’–b‡G—VöbW†—7F–æu¶–æFW…Òç6WE÷6—F–öâÓÓÒvgVæ7F–öâr’v—BW†—7F–æu¶–æFW…Òç6WE÷6—F–öâ†&6R²–æFW‚’æ6F6‚‚‚’ÓâçVÆÂ“²Ğ¦7–æ2gVæ7F–öâ7–æ5†6T–æfô6†ææVÇ2†6Æ–VçBÂWfVçD¶W’’°¢6öç7BWfVçBÒ&VDWfVçDFF†WfVçD¶W’“²6öç7B7FFRÒvWD7–6ÆR†WfVçBæ7–6ÆSòæ7–6ÆT¶W’“²–b‚7FFRÇÂ7FFRæ76–væÖVçBç7FGW2ÓÒvÆö6¶VBr’&WGW&âçVÆÃ°¢6öç7B6WGF–æw2Ò&VE6WGF–æw2‚“²6öç7BwV–ÆBÒv—BvWD6öæf–wW&VDwV–ÆB†6Æ–VçBÂ6WGF–æw2“²–b‚wV–ÆB’&WGW&âçVÆÃ²6öç7B&Vg2Ò¥4ôâç'6R„¥4ôâç7G&–æv–g’‡7FFRæ–æfô6†ææVÇ2ÇÂ²w&÷W3¢·ÒÂÆVwVS¢çVÆÂÂ¶æö6¶÷WC¢·ÒÒ’“°¢–b‡7FFRæ76–væÖVçBçG—RÓÓÒvw&÷W2r’f÷"†6öç7B¶¶W’Âw&÷WÒöbö&¦V7BæVçG&–W2†WfVçBæw&÷W3òæw&÷W2ÇÂ·Ò’’°¢6öç7BÆVD–G2Ò7FFRæ76–væÖVçBæw&÷W3òå¶¶W•Òò·7FFRæ76–væÖVçBæw&÷W5¶¶W•ÕÒ¢µÓ²–b‚ÆVD–G2æÆVæwF‚’6öçF–çVS°¢6öç7BÖ–âÒv—BwV–ÆBæ6†ææVÇ2æfWF6‚†w&÷Wæ6†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ“²–b‚Ö–â’6öçF–çVS°¢6öç7B÷fW'w&—FW2Ò'V–ÆDw&÷W6†ææVÅW&Ö—76–öä÷fW'w&—FW2‡²wV–ÆBÂ6WGF–æw2Â&öÆT–C¢w&÷Wç&öÆT–BÂW6W$–G3¢Væ—VR…²ââæw&÷WFVÕW6W'2†w&÷W’ÂââæÆVD–G5Ò’Ò“°¢6öç7B–æfòÒv—BVç7W&T–æfô6†ææVÂ‡²wV–ÆBÂ6WGF–æw2ÂæÖS¢æ–v‡F7WÖ–æfòÖw'WRÒG¶¶W’çFôÆ÷vW$66R‚—ÖÂ&VçD–C¢Ö–âç&VçD–BÂ÷fW'w&—FW2ÂW†—7F–æs¢&Vg2æw&÷W3òå¶¶W•ÒÂÆ&VÃ¢w'WRG¶¶W—ÖÂÆVD–G2Ò“°¢&Vg2æw&÷W5¶¶W•ÒÒ²6†ææVÄ–C¢–æfòæ6†ææVÂæ–BÂÖW76vT–C¢–æfòæÖW76vRæ–BÓ²6öç7B&W7VÇG2Òv—BwV–ÆBæ6†ææVÇ2æfWF6‚†w&÷Wç&W7VÇG46†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ“²6öç7Bf–FVòÒv—BwV–ÆBæ6†ææVÇ2æfWF6‚†w&÷Wçf–FVô6†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ“²v—B÷&FW$6†ææVÇ2…¶–æfòæ6†ææVÂÂÖ–âÂ&W7VÇG2Âf–FVõÒ“°¢Ğ¢–b‡7FFRæ76–væÖVçBçG—RÓÓÒvÆVwVRrbb7FFRæ76–væÖVçBæÆVwVUW6W$–G2æÆVæwF‚’°¢6öç7B†6RÒWfVçBæÆVwVU†6S²6öç7BÖ–âÒv—BwV–ÆBæ6†ææVÇ2æfWF6‚‡†6Ræ÷fW'f–Wt6†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ“²–b†Ö–â’²6öç7B÷fW'w&—FW2Ò'V–ÆDw&÷W6†ææVÅW&Ö—76–öä÷fW'w&—FW2‡²wV–ÆBÂ6WGF–æw2Â&öÆT–C¢†6Rç&öÆT–BÂW6W$–G3¢Væ—VR…²ââæÆVwVUFVÕW6W'2‡†6R’Âââç7FFRæ76–væÖVçBæÆVwVUW6W$–G5Ò’Ò“²6öç7B–æfòÒv—BVç7W&T–æfô6†ææVÂ‡²wV–ÆBÂ6WGF–æw2ÂæÖS¢væ–v‡F7WÖ–æfòÖÆ–vrÂ&VçD–C¢Ö–âç&VçD–BÂ÷fW'w&—FW2ÂW†—7F–æs¢&Vg2æÆVwVRÂÆ&VÃ¢tÆ–vrÂÆVD–G3¢7FFRæ76–væÖVçBæÆVwVUW6W$–G2Ò“²&Vg2æÆVwVRÒ²6†ææVÄ–C¢–æfòæ6†ææVÂæ–BÂÖW76vT–C¢–æfòæÖW76vRæ–BÓ²v—B÷&FW$6†ææVÇ2…¶–æfòæ6†ææVÂÂÖ–âÂv—BwV–ÆBæ6†ææVÇ2æfWF6‚‡†6Rç&W7VÇG46†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ’Âv—BwV–ÆBæ6†ææVÇ2æfWF6‚‡†6Rçf–FVô6†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ•Ò“²Ğ¢Ğ¢–b†WfVçBæ¶æö6¶÷WCòç7FGW2ÓÒvæ÷Eö7&VFVBrbb7FFRæ76–væÖVçBæ¶æö6¶÷WEW6W$–G2æÆVæwF‚’f÷"†6öç7B·&÷VæD¶W’Â¶Æ&VÂÂæÖUÕÒöbö&¦V7BæVçG&–W2…$õTäEô”ädò’’°¢6öç7B&÷VæBÒWfVçBæ¶æö6¶÷WCòç&÷VæG3òå·&÷VæD¶W•Ó²–b‚&÷VæCòæÖF6†W3òæÆVæwF‚ÇÂ&÷VæBç7FGW2ÓÓÒvæ÷EöæVVFVBr’6öçF–çVS²6öç7BÖ–âÒv—BwV–ÆBæ6†ææVÇ2æfWF6‚‡&÷VæBæ6†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ“²–b‚Ö–â’6öçF–çVS°¢6öç7B&öÆT–BÒ6WGF–æw2ç&öÆW3òæ¶æö6¶÷WE&öÆT–G3òå·&÷VæD¶W•ÒÇÂçVÆÃ²6öç7B÷fW'w&—FW2Ò'V–ÆDw&÷W6†ææVÅW&Ö—76–öä÷fW'w&—FW2‡²wV–ÆBÂ6WGF–æw2Â&öÆT–BÂW6W$–G3¢Væ—VR…²ââç&÷VæEFVÕW6W'2‡&÷VæB’Âââç7FFRæ76–væÖVçBæ¶æö6¶÷WEW6W$–G5Ò’Ò“°¢6öç7B–æfòÒv—BVç7W&T–æfô6†ææVÂ‡²wV–ÆBÂ6WGF–æw2ÂæÖRÂ&VçD–C¢Ö–âç&VçD–BÂ÷fW'w&—FW2ÂW†—7F–æs¢&Vg2æ¶æö6¶÷WCòå·&÷VæD¶W•ÒÂÆ&VÂÂÆVD–G3¢7FFRæ76–væÖVçBæ¶æö6¶÷WEW6W$–G2Ò“²&Vg2æ¶æö6¶÷WE·&÷VæD¶W•ÒÒ²6†ææVÄ–C¢–æfòæ6†ææVÂæ–BÂÖW76vT–C¢–æfòæÖW76vRæ–BÓ²v—B÷&FW$6†ææVÇ2…¶–æfòæ6†ææVÂÂÖ–âÂv—BwV–ÆBæ6†ææVÇ2æfWF6‚‡&÷VæBç&W7VÇG46†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ’Âv—BwV–ÆBæ6†ææVÇ2æfWF6‚‡&÷VæBçf–FVô6†ææVÄ–B’æ6F6‚‚‚’ÓâçVÆÂ•Ò“°¢Ğ¢WFFT7–6ÆR‡7FFRæ7–6ÆT¶W’Â7W'&VçBÓâ‡²ââæ7W'&VçBÂ–æfô6†ææVÇ3¢&Vg2ÂWFFVDC¢æ÷t—6ò‚’Ò’“²6öç6öÆRæÆör†·F÷W&æÖVçBÖÆVFW'6†—Ò–æfòÔ¶åÇSSFÆR7–æ6‡&öæ—6–W'C¢G·7FFRæ7–6ÆT¶W—Ö“²&WGW&â&Vg3°§Ğ¦7–æ2gVæ7F–öâ†æFÆT–çFW&7F–öâ†–çFW&7F–öâÂ6Æ–VçB’°¢6öç7B–BÒ7G&–ær†–çFW&7F–öâæ7W7FöÔ–BÇÂrr“²–b‚–Bç7F'G5v—F‚‚wFÅòr’’&WGW&âfÇ6S²6öç7B6WGF–æw2Ò&VE6WGF–æw2‚“°¢–b‚—4WF†÷&—¦VB†–çFW&7F–öâæÖVÖ&W"Â6WGF–æw2’’F‡&÷ræWrW'&÷"‚tçW"FÖ–ç2VæBGW&æ–W&ÆV—GVævVâEÇSf7&fVâF–W6RW7v†ÂfW'vVæFVââr“°¢–b†–Bç7F'G5v—F‚‚wFÅöf–Æ&–Æ—G“¢r’’²6öç7B²Â7–6ÆT¶W’Â6†ö–6UÒÒ–Bç7Æ—B‚s¢r“²v—B–çFW&7F–öâæFVfW%WFFR‚“²G'’²v—Bv—F„Æö6²†7–6ÆT¶W’Â7–æ2‚’Óâ²ÆWB7FFRÒvWD7–6ÆR†7–6ÆT¶W’“²–b‚7FFRÇÂ7FFRæf–Æ&–Æ—G’ç7FGW2ÓÒv÷Vâr’F‡&÷ræWrW'&÷"‚tF–W6R'7F–Ö×Vær—7B&W&V—G2&VVæFWBâr“²6öç7BW6W$–BÒ7G&–ær†–çFW&7F–öâçW6W"æ–B“²7FFRÒWFFT7–6ÆR†7–6ÆT¶W’Â7W'&VçBÓâ²6öç7B–W2ÒæWr6WB†7W'&VçBæf–Æ&–Æ—G’ç–W5W6W$–G2ÇÂµÒ“²6öç7BæòÒæWr6WB†7W'&VçBæf–Æ&–Æ—G’ææõW6W$–G2ÇÂµÒ“²6öç7BF&vWBÒ6†ö–6RÓÓÒw–W2rò–W2¢æó²6öç7B÷F†W"Ò6†ö–6RÓÓÒw–W2ròæò¢–W3²÷F†W"æFVÆWFR‡W6W$–B“²F&vWBæ†2‡W6W$–B’òF&vWBæFVÆWFR‡W6W$–B’¢F&vWBæFB‡W6W$–B“²&WGW&â²ââæ7W'&VçBÂf–Æ&–Æ—G“¢²ââæ7W'&VçBæf–Æ&–Æ—G’Â–W5W6W$–G3¢²ââç–W5ÒÂæõW6W$–G3¢²ââææõÒÒÂWFFVDC¢æ÷t—6ò‚’Ó²Ò“²v—B&Vg&W6„f–Æ&–Æ—G”ÖW76vR†6Æ–VçBÂ7FFR“²6öç6öÆRæÆör†·F÷W&æÖVçBÖÆVFW'6†—Ò7F–ÖÖRG¶6†ö–6WÓ¢G¶7–6ÆT¶W—ÒòG·W6W$–GÖ“²Ò“²Ò6F6‚†W'&÷"’²v—B–çFW&7F–öâæföÆÆ÷uW‡²6öçFVçC¢W'&÷"æÖW76vRÂfÆw3¢cBÒ’æ6F6‚‚‚’ÓâçVÆÂ“²Ò&WGW&âG'VS²Ğ¢–b†–Bç7F'G5v—F‚‚wFÅö76–væÖVçC¢r’’²6öç7B²Â7–6ÆT¶W’Â66÷UÒÒ–Bç7Æ—B‚s¢r“²v—B–çFW&7F–öâæFVfW%WFFR‚“²G'’²v—Bv—F„Æö6²†7–6ÆT¶W’Â7–æ2‚’Óâ²ÆWB7FFRÒvWD7–6ÆR†7–6ÆT¶W’“²–b‚7FFRÇÂ7FFRæ76–væÖVçBç7FGW2ÓÒv7F—fRr’F‡&÷ræWrW'&÷"‚tF–W6R§W7EÇSSFæF–v¶V—G6W7v†Â—7Bæ–6‡BÖV‡"vUÇScfffæWBâr“²6öç7BW6W$–BÒ7G&–ær†–çFW&7F–öâçW6W"æ–B“²–b‚f–Æ&ÆUW6W$–G2‡7FFR’æ–æ6ÇVFW2‡W6W$–B’bb—4FÖ–â†–çFW&7F–öâæÖVÖ&W"Â6WGF–æw2’’F‡&÷ræWrW'&÷"‚tGR×W77B&V’FW"fW&eÇSf6v&&¶V—G6&g&vRÖ—B¦&vW7F–Ö×B†&Vââr“²6öç7BWfVçBÒ&VDWfVçDFF‡7FFRæWfVçD¶W’“²7FFRÒWFFT7–6ÆR†7–6ÆT¶W’Â7W'&VçBÓâ²6öç7B76–væÖVçBÒ²ââæ7W'&VçBæ76–væÖVçBÂw&÷W3¢²âââ†7W'&VçBæ76–væÖVçBæw&÷W2ÇÂ·Ò’ÒÂÆVwVUW6W$–G3¢²âââ†7W'&VçBæ76–væÖVçBæÆVwVUW6W$–G2ÇÂµÒ•ÒÂ¶æö6¶÷WEW6W$–G3¢²âââ†7W'&VçBæ76–væÖVçBæ¶æö6¶÷WEW6W$–G2ÇÂµÒ•ÒÓ²–b‡66÷Rç7F'G5v—F‚‚vw&÷Wòr’’²6öç7B¶W’Ò66÷Rç6Æ–6Rƒb“²6öç7B÷væW"Ò76–væÖVçBæw&÷W5¶¶W•Ó²–b†÷væW"bb÷væW"ÓÒW6W$–B’F‡&÷ræWrW'&÷"†F–W6Rw'WRv—&B&W&V—G2föâÄG¶÷væW'ÓâvVÆV—FWBâ&—GFRuÇSSF†ÆRV–æRæFW&Rw'WRW2æ“²–b†÷væW"ÓÓÒW6W$–B’FVÆWFR76–væÖVçBæw&÷W5¶¶W•Ó²VÇ6R76–væÖVçBæw&÷W5¶¶W•ÒÒW6W$–C²ÒVÇ6R²6öç7Bf–VÆBÒ66÷RÓÓÒvÆVwVRròvÆVwVUW6W$–G2r¢v¶æö6¶÷WEW6W$–G2s²6öç7B6WBÒæWr6WB†76–væÖVçE¶f–VÆEÒ“²6WBæ†2‡W6W$–B’ò6WBæFVÆWFR‡W6W$–B’¢6WBæFB‡W6W$–B“²76–væÖVçE¶f–VÆEÒÒ²ââç6WEÓ²Ò&WGW&â²ââæ7W'&VçBÂ76–væÖVçBÂWFFVDC¢æ÷t—6ò‚’Ó²Ò“²v—B&Vg&W6„76–væÖVçDÖW76vR†6Æ–VçBÂ7FFRÂWfVçB“²v—B7–æ5†6T–æfô6†ææVÇ2†6Æ–VçBÂ7FFRæWfVçD¶W’“²6öç6öÆRæÆör†·F÷W&æÖVçBÖÆVFW'6†—ÒÖçVVÆÆRW7v†ÂG·66÷WÓ¢G¶7–6ÆT¶W—ÒòG·W6W$–GÖ“²Ò“²Ò6F6‚†W'&÷"’²v—B–çFW&7F–öâæföÆÆ÷uW‡²6öçFVçC¢W'&÷"æÖW76vRÂfÆw3¢cBÒ’æ6F6‚‚‚’ÓâçVÆÂ“²Ò&WGW&âG'VS²Ğ¢&WGW&âfÇ6S°§Ğ¦7–æ2gVæ7F–öâ&V6öæ6–ÆR†6Æ–VçBÒ7F—fT6Æ–VçBÂæ÷rÒæWrFFR‚’Â²7F'GWÒfÇ6RÒÒ·Ò’°¢–b‚6Æ–VçB’&WGW&âçVÆÃ²v—BVç7W&TF–Ç”f–Æ&–Æ—G’†6Æ–VçBÂæ÷rÂ²–ÖÖVF–FS¢7F'GWÒ“°¢f÷"†6öç7B7FFRöbö&¦V7BçfÇVW2‡&VE7F÷&R‚’æ7–6ÆW2ÇÂ·Ò’’²–b‡7FFRç7FGW2ÓÒv7F—fRr’6öçF–çVS²v—B6Æ÷6Tf–Æ&–Æ—G’†6Æ–VçBÂ7FFRæ7–6ÆT¶W’Âæ÷r“²6öç7BWfVçBÒ&VDWfVçDFF‡7FFRæWfVçD¶W’“²–b‡7FFRæ76–væÖVçBç7FGW2ÓÓÒv7F—fRr’²6öç7B7F'DBÒæWrFFR†WfVçBç66†VGVÆSòçF÷W&æÖVçE7F'DBÇÂ“²6öç7B&VÖ–æ–ærÒ7F'DBævWEF–ÖR‚’Òæ÷rævWEF–ÖR‚“²–b‡&VÖ–æ–ærÃÒ¢c¢bb&VÖ–æ–ærâbb7FFRæ76–væÖVçBç&VÖ–æFVDBbb÷Vå66÷W2‡7FFRÂWfVçB’æÆVæwF‚’²6öç7BWFFVBÒWFFT7–6ÆR‡7FFRæ7–6ÆT¶W’Â7W'&VçBÓâ‡²ââæ7W'&VçBÂ76–væÖVçC¢²ââæ7W'&VçBæ76–væÖVçBÂ&VÖ–æFVDC¢æ÷t—6ò†æ÷r’ÒÒ’“²v—B&Vg&W6„76–væÖVçDÖW76vR†6Æ–VçBÂWFFVBÂWfVçB“²Ò–b‡&VÖ–æ–ærÃÒ’v—BWFô76–väE7F'B†6Æ–VçBÂvWD7–6ÆR‡7FFRæ7–6ÆT¶W’’ÂWfVçB“²Ò–b†vWD7–6ÆR‡7FFRæ7–6ÆT¶W’“òæ76–væÖVçCòç7FGW2ÓÓÒvÆö6¶VBr’v—B7–æ5†6T–æfô6†ææVÇ2†6Æ–VçBÂ7FFRæWfVçD¶W’“²Ğ¢&WGW&âG'VS°§Ğ¦7–æ2gVæ7F–öâ6ÆVçWWfVçB†6Æ–VçBÂWfVçD¶W’’°¢6öç7BWfVçBÒ&VDWfVçDFF†WfVçD¶W’“²6öç7B7–6ÆT¶W’ÒWfVçBæ7–6ÆSòæ7–6ÆT¶W“²6öç7B7FFRÒ7–6ÆT¶W’òvWD7–6ÆR†7–6ÆT¶W’’¢çVÆÃ²–b‚7FFRÇÂ7FFRç7FGW2ÓÓÒv6ÆVæVBr’&WGW&â²6ÆVæVC¢fÇ6RÓ°¢6öç7B6WGF–æw2Ò&VE6WGF–æw2‚“²6öç7B6†ææVÂÒv—BvWD–çFW&æÄ6†ææVÂ†6Æ–VçBÂ6WGF–æw2’æ6F6‚‚‚’ÓâçVÆÂ“²6öç7BFVÆWFVDÖW76vW2ÒµÓ°¢f÷"†6öç7B–BöbVæ—VR‡7FFRç7—7FVÔÖW76vT–G2’’²6öç7BÖW76vRÒ6†ææVÂòv—B6†ææVÂæÖW76vW2æfWF6‚†–B’æ6F6‚‚‚’ÓâçVÆÂ’¢çVÆÃ²–b†ÖW76vRbbv—BÖW76vRæFVÆWFR‚’çF†Vâ‚‚’ÓâG'VR’æ6F6‚‚‚’ÓâfÇ6R’’FVÆWFVDÖW76vW2çW6‚†–B“²Ğ¢6öç7B6†ææVÄ–G2ÒVæ—VR…²ââäö&¦V7BçfÇVW2‡7FFRæ–æfô6†ææVÇ3òæw&÷W2ÇÂ·Ò’æÖ†—FVÒÓâ—FVÒæ6†ææVÄ–B’Â7FFRæ–æfô6†ææVÇ3òæÆVwVSòæ6†ææVÄ–BÂââäö&¦V7BçfÇVW2‡7FFRæ–æfô6†ææVÇ3òæ¶æö6¶÷WBÇÂ·Ò’æÖ†—FVÒÓâ—FVÒæ6†ææVÄ–B•Ò“²6öç7BFVÆWFVD6†ææVÇ2ÒµÓ°¢f÷"†6öç7B–Böb6†ææVÄ–G2’²6öç7B–æfòÒv—B6Æ–VçBæ6†ææVÇ2æfWF6‚†–B’æ6F6‚‚‚’ÓâçVÆÂ“²–b†–æfòbbv—B–æfòæFVÆWFR‚tÆö6òæ–v‡B7WGW&æ–W&ÆV—GVæw2Õ&W6WBr’çF†Vâ‚‚’ÓâG'VR’æ6F6‚‚‚’ÓâfÇ6R’’FVÆWFVD6†ææVÇ2çW6‚†–B“²Ğ¢WFFT7–6ÆR†7–6ÆT¶W’Â7W'&VçBÓâ‡²7–6ÆT¶W’ÂWfVçD¶W’ÂWfVçDFFS¢7W'&VçBæWfVçDFFRÂ7FGW3¢v6ÆVæVBrÂ6ÆVæVDC¢æ÷t—6ò‚’Âf–Æ&–Æ—G“¢²7FGW3¢v6ÆV&VBrÂ–W5W6W$–G3¢µÒÂæõW6W$–G3¢µÒÒÂ76–væÖVçC¢²7FGW3¢v6ÆV&VBrÂw&÷W3¢·ÒÂÆVwVUW6W$–G3¢µÒÂ¶æö6¶÷WEW6W$–G3¢µÒÒÂ–æfô6†ææVÇ3¢²w&÷W3¢·ÒÂÆVwVS¢çVÆÂÂ¶æö6¶÷WC¢·ÒÒÂ7—7FVÔÖW76vT–G3¢µÒÒ’“°¢6öç6öÆRæÆör†·F÷W&æÖVçBÖÆVFW'6†—Ò&W6WB&vW66†Æ÷76Vã¢G¶7–6ÆT¶W—ÒÂæ6‡&–6‡FVãÒG¶FVÆWFVDÖW76vW2æÆVæwF‡ÒÂ¶åÇSSFÆSÒG¶FVÆWFVD6†ææVÇ2æÆVæwF‡Ö“²&WGW&â²6ÆVæVC¢G'VRÂFVÆWFVDÖW76vW2ÂFVÆWFVD6†ææVÇ2Ó°§Ğ¦7–æ2gVæ7F–öâ–æ—B†6Æ–VçB’²7F—fT6Æ–VçBÒ6Æ–VçC²v—B&V6öæ6–ÆR†6Æ–VçBÂæWrFFR‚’Â²7F'GW¢G'VRÒ“²–b‚&V6öæ6–ÆUF–ÖW"’²&V6öæ6–ÆUF–ÖW"Ò6WD–çFW'fÂ‚‚’Óâ&V6öæ6–ÆR†6Æ–VçB’æ6F6‚†W'&÷"Óâ6öç6öÆRæW'&÷"‚u·F÷W&æÖVçBÖÆVFW'6†—Ò&V6öæ6–ÆRfV†ÆvW66†ÆvVã¢rÂW'&÷"’’Âc¢“²–b‡&V6öæ6–ÆUF–ÖW"çVç&Vb’&V6öæ6–ÆUF–ÖW"çVç&Vb‚“²Ò&WGW&âG'VS²Ğ ¦ÖöGVÆRæW‡÷'G2Ò²”åDU$äÅô4„ääTÅô”BÂ76–væÖVçD6ö×öæVçG2ÂWFô76–väE7F'BÂf–Æ&–Æ—G”6ö×öæVçG2Â&Ææ6VDw&÷W76–væÖVçG2Â6ÆVçWWfVçBÂ6Æ÷6Tf–Æ&–Æ—G’Â7&VFT7–6ÆU7FFRÂFFUF—FÆRÂVç7W&T76–væÖVçDf÷$WfVçBÂVç7W&TF–Ç”f–Æ&–Æ—G’Â†æFÆT–çFW&7F–öâÂ–æ—BÂ&V6öæ6–ÆRÂ7–æ5†6T–æfô6†ææVÇ2Ó° 