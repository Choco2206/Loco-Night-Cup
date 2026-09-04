'use strict';

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { GROUP_KEYS } = require('../../app/constants');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('./checkin-repository');
const { lockEventFormat } = require('../events/event-lock-service');
const { findTeamById } = require('../teams/team-service');
const { ensureGroupRolesAndMembers } = require('../groups/group-roles');
const {
  ensureGroupChannel,
  ensureGroupResultsChannel,
  ensureGroupVideoChannel,
  getGroupUserIds,
} = require('../groups/group-channels');
const { upsertGroupPosts, updateGroupMessageRefs } = require('../groups/group-posts');
const { createGroupMatchdays } = require('../groups/group-matches');
const { ensureAttendancePost } = require('../groups/attendance-service');
const {
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_GROUP_SIZE,
  isBomberXLocoEvent,
} = require('../events/bomber-x-loco-config');

const EVENT_KEY = 'saturday';
const PREPARE_AT = new Date(`${BOMBER_X_LOCO_EVENT_DATE}T18:45:00+02:00`);
const EVENT_END = new Date('2026-09-20T07:00:00+02:00');
const EPHEMERAL = 64;
let prepareTimer = null;

function nowIso(now = new Date()) { return now.toISOString(); }
function readSettings() { return readJson(FILES.settings, createSettingsDefault()); }
function isTargetEvent(event) {
  return isBomberXLocoEvent(event) && String(event.cycle?.eventDate || '') === BOMBER_X_LOCO_EVENT_DATE;
}

function isAdminMember(member, settings) {
  const roleIds = [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ].filter(Boolean).map(String);
  return roleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

function createPendingSlots(groupKey) {
  return Array.from({ length: BOMBER_X_LOCO_GROUP_SIZE }, (_, index) => ({
    slot: index + 1,
    type: 'team',
    teamId: null,
    participantKey: `pending:${groupKey}:${index + 1}`,
    displayName: 'Noch nicht zugeteilt',
    pendingAssignment: true,
  }));
}

function createEmptyManualGroups(size) {
  const count = Number(size) / BOMBER_X_LOCO_GROUP_SIZE;
  return Object.fromEntries(GROUP_KEYS.slice(0, count).map(groupKey => [groupKey, {
    groupKey,
    name: `Gruppe ${groupKey}`,
    roleId: null,
    channelId: null,
    resultsChannelId: null,
    videoChannelId: null,
    slots: createPendingSlots(groupKey),
    standings: [],
    matchdays: [],
    manualDraw: true,
    assignmentComplete: false,
  }]));
}

function assignedTeamIds(event) {
  return Object.values(event.groups?.groups || {})
    .flatMap(group => group.slots || [])
    .filter(slot => slot?.type === 'team' && slot.teamId)
    .map(slot => String(slot.teamId));
}

function lockedTeamIds(event) {
  return (event.format?.participants || [])
    .filter(participant => participant?.type === 'team' && participant.teamId)
    .map(participant => String(participant.teamId));
}

function availableTeams(event) {
  const assigned = new Set(assignedTeamIds(event));
  return lockedTeamIds(event)
    .filter(teamId => !assigned.has(teamId))
    .map(findTeamById)
    .filter(Boolean)
    .sort((a, b) => String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de'));
}

function rebuildGroupCompetitionData(group, now = new Date()) {
  const teams = (group.slots || []).filter(slot => slot?.type === 'team' && slot.teamId);
  group.standings = teams.map(slot => ({
    slot: slot.slot,
    participantKey: `team:${slot.teamId}`,
    teamId: String(slot.teamId),
    displayName: slot.displayName || findTeamById(slot.teamId)?.clubName || String(slot.teamId),
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  }));
  group.assignmentComplete = teams.length === BOMBER_X_LOCO_GROUP_SIZE;
  group.matchdays = group.assignmentComplete
    ? createGroupMatchdays({ eventKey: EVENT_KEY, group, createdAt: nowIso(now) })
    : [];
  return group;
}

async function syncGroupResources(client, event, groupKeys = null) {
  const settings = readSettings();
  const roleSync = await ensureGroupRolesAndMembers({ client, event, settings });
  const guild = roleSync.guild;
  if (!guild) throw new Error('Server konnte für die Gruppen-Vorbereitung nicht gefunden werden.');

  const wanted = groupKeys ? new Set(groupKeys.map(String)) : null;
  const updates = [];

  for (const group of Object.values(event.groups?.groups || {})) {
    if (wanted && !wanted.has(String(group.groupKey))) continue;
    const roleUpdate = roleSync.updates.find(update => String(update.groupKey) === String(group.groupKey));
    if (roleUpdate?.roleId) group.roleId = roleUpdate.roleId;
    const userIds = getGroupUserIds(group);
    const channel = await ensureGroupChannel(guild, settings, group, userIds);
    const resultsChannel = await ensureGroupResultsChannel(guild, settings, group, userIds);
    const videoChannel = await ensureGroupVideoChannel(guild, settings, group);
    group.channelId = channel.id;
    group.resultsChannelId = resultsChannel.id;
    group.videoChannelId = videoChannel.id;

    const refs = await upsertGroupPosts(channel, {
      ...group,
      eventKey: EVENT_KEY,
      formatSize: event.format?.size,
    }, { eventKey: EVENT_KEY }, resultsChannel);
    Object.assign(group, refs);

    await ensureAttendancePost(client, EVENT_KEY, group.groupKey).catch(error => {
      console.warn(`[bxl-manual-draw] Anwesenheitscheck Gruppe ${group.groupKey} konnte noch nicht aktualisiert werden: ${error.message}`);
    });

    updates.push({
      groupKey: group.groupKey,
      roleId: group.roleId,
      channelId: group.channelId,
      resultsChannelId: group.resultsChannelId,
      videoChannelId: group.videoChannelId,
      ...refs,
    });
  }

  updateEventData(EVENT_KEY, current => {
    for (const update of updates) {
      const group = current.groups?.groups?.[update.groupKey];
      if (group) Object.assign(group, update);
    }
    current.meta = { ...(current.meta || {}), updatedAt: nowIso() };
    return current;
  });
  updateGroupMessageRefs(EVENT_KEY, readEventData(EVENT_KEY), updates);
  return updates;
}

async function prepareManualDraw(client, now = new Date()) {
  let event = readEventData(EVENT_KEY);
  if (!isTargetEvent(event)) return { prepared: false, reason: 'not_target_event' };
  if (event.meta?.bomberManualDrawPreparedAt) return { prepared: false, reason: 'already_prepared', event };

  if (!event.format?.lockedAt) {
    lockEventFormat(EVENT_KEY, null, now);
    event = readEventData(EVENT_KEY);
  }
  if (!event.format?.size || Number(event.format.size) % BOMBER_X_LOCO_GROUP_SIZE !== 0) {
    throw new Error('Für die Live-Auslosung ist noch kein gültiges Bomber-X-Loco-Format gelockt.');
  }

  updateEventData(EVENT_KEY, current => {
    const timestamp = nowIso(now);
    current.status = 'groups';
    current.groups = {
      ...(current.groups || {}),
      status: 'created',
      drawnAt: null,
      drawnBy: null,
      manualDraw: true,
      manualDrawHost: 'Paddy HSV',
      groups: createEmptyManualGroups(current.format.size),
    };
    current.meta = {
      ...(current.meta || {}),
      updatedAt: timestamp,
      bomberManualDrawPreparedAt: timestamp,
      bomberManualDrawCompletedAt: null,
    };
    return current;
  });

  event = readEventData(EVENT_KEY);
  await syncGroupResources(client, event);
  return { prepared: true, event: readEventData(EVENT_KEY) };
}

function scheduleManualDrawPreparation(client) {
  if (prepareTimer) clearTimeout(prepareTimer);
  prepareTimer = null;
  const now = new Date();
  if (now >= EVENT_END) return;
  if (now >= PREPARE_AT) {
    prepareManualDraw(client, now).catch(error => console.error('[bxl-manual-draw] Vorbereitung fehlgeschlagen:', error));
    return;
  }
  const delay = PREPARE_AT.getTime() - now.getTime();
  prepareTimer = setTimeout(() => {
    prepareTimer = null;
    prepareManualDraw(client, new Date()).catch(error => console.error('[bxl-manual-draw] Vorbereitung fehlgeschlagen:', error));
  }, delay);
  if (typeof prepareTimer.unref === 'function') prepareTimer.unref();
}

function buildGroupSelect(event) {
  const groups = Object.values(event.groups?.groups || {});
  if (!groups.length) throw new Error('Die Gruppenkanäle sind noch nicht vorbereitet.');
  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('bxl_manual_group_select')
      .setPlaceholder('Gruppe auswählen')
      .addOptions(groups.map(group => {
        const assigned = (group.slots || []).filter(slot => slot?.teamId).length;
        return {
          label: `Gruppe ${group.groupKey}`,
          value: String(group.groupKey),
          description: `${assigned}/${BOMBER_X_LOCO_GROUP_SIZE} Teams zugeteilt`,
        };
      }))
  )];
}

function buildTeamSelectRows(event, groupKey) {
  const teams = availableTeams(event);
  if (!teams.length) throw new Error('Es gibt keine weiteren nicht zugeteilten Teams.');
  const chunks = [];
  for (let index = 0; index < teams.length; index += 25) chunks.push(teams.slice(index, index + 25));
  return chunks.slice(0, 2).map((chunk, index) => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bxl_manual_team_select:${groupKey}:${index}`)
      .setPlaceholder(chunks.length > 1 ? `Team auswählen (${index + 1}/${chunks.length})` : 'Team auswählen')
      .addOptions(chunk.map(team => ({
        label: String(team.clubName || team.id).slice(0, 100),
        value: String(team.id),
      })))
  ));
}

async function assignTeamToGroup({ client, groupKey, teamId, actorUserId, now = new Date() }) {
  let changedGroup = null;
  updateEventData(EVENT_KEY, event => {
    if (!isTargetEvent(event) || event.groups?.manualDraw !== true) throw new Error('Die manuelle Bomber-X-Loco-Auslosung ist nicht aktiv.');
    const group = event.groups?.groups?.[groupKey];
    if (!group) throw new Error(`Gruppe ${groupKey} wurde nicht gefunden.`);
    if (!lockedTeamIds(event).includes(String(teamId))) throw new Error('Dieses Team gehört nicht zum gelockten Teilnehmerfeld.');
    if (assignedTeamIds(event).includes(String(teamId))) throw new Error('Dieses Team wurde bereits einer Gruppe zugeteilt.');
    const slot = (group.slots || []).find(entry => !entry.teamId);
    if (!slot) throw new Error(`Gruppe ${groupKey} ist bereits voll.`);
    const team = findTeamById(teamId);
    if (!team) throw new Error('Team wurde nicht gefunden.');
    slot.type = 'team';
    slot.teamId = String(team.id);
    slot.participantKey = `team:${team.id}`;
    slot.displayName = team.clubName;
    slot.pendingAssignment = false;
    rebuildGroupCompetitionData(group, now);
    event.groups.drawnAt = event.groups.drawnAt || nowIso(now);
    event.groups.drawnBy = actorUserId ? String(actorUserId) : event.groups.drawnBy;
    const allAssigned = assignedTeamIds(event).length === lockedTeamIds(event).length;
    if (allAssigned) {
      event.meta = { ...(event.meta || {}), bomberManualDrawCompletedAt: nowIso(now) };
    }
    event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
    changedGroup = group;
    return event;
  });

  const event = readEventData(EVENT_KEY);
  await syncGroupResources(client, event, [groupKey]);
  return { event: readEventData(EVENT_KEY), group: changedGroup };
}

async function handleInteraction(interaction, client) {
  const customId = String(interaction.customId || '');
  if (!['bxl_manual_group_assignment', 'bxl_manual_group_select'].includes(customId)
      && !customId.startsWith('bxl_manual_team_select:')) return false;

  const settings = readSettings();
  const member = interaction.guild
    ? await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member)
    : null;
  if (!isAdminMember(member, settings)) {
    await interaction.reply({ content: 'Diese Gruppenzuteilung ist nur für Admins und Cup-Leads.', flags: EPHEMERAL }).catch(() => null);
    return true;
  }

  try {
    let event = readEventData(EVENT_KEY);
    if (!event.meta?.bomberManualDrawPreparedAt) {
      await interaction.deferReply({ flags: EPHEMERAL });
      await prepareManualDraw(client, new Date());
      event = readEventData(EVENT_KEY);
      await interaction.editReply({ content: 'Wähle die Gruppe für die nächste Live-Auslosung.', components: buildGroupSelect(event) });
      return true;
    }

    if (customId === 'bxl_manual_group_assignment') {
      await interaction.reply({ content: 'Wähle die Gruppe für die nächste Live-Auslosung.', components: buildGroupSelect(event), flags: EPHEMERAL });
      return true;
    }

    if (customId === 'bxl_manual_group_select') {
      const groupKey = interaction.values?.[0];
      await interaction.update({
        content: `Gruppe **${groupKey}** ausgewählt. Welches gezogene Team soll dort hinein?`,
        components: buildTeamSelectRows(event, groupKey),
      });
      return true;
    }

    if (customId.startsWith('bxl_manual_team_select:')) {
      const [, groupKey] = customId.split(':');
      const teamId = interaction.values?.[0];
      await interaction.deferUpdate();
      const result = await assignTeamToGroup({ client, groupKey, teamId, actorUserId: interaction.user.id });
      const team = findTeamById(teamId);
      const remaining = availableTeams(result.event).length;
      await interaction.editReply({
        content: `✅ **${team?.clubName || teamId}** wurde **Gruppe ${groupKey}** zugeteilt.${remaining ? ` Noch ${remaining} Team${remaining === 1 ? '' : 's'} offen.` : ' Die Live-Auslosung ist vollständig zugeteilt.'}`,
        components: remaining ? buildGroupSelect(result.event) : [],
      });
      return true;
    }
  } catch (error) {
    const content = `❌ Gruppenzuteilung fehlgeschlagen: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] }).catch(() => null);
    else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => null);
    return true;
  }

  return false;
}

module.exports = {
  assignTeamToGroup,
  handleInteraction,
  prepareManualDraw,
  scheduleManualDrawPreparation,
};
