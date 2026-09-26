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
const { refreshLiveSchedule } = require('../live-schedule');
const { createGroupMatchdays } = require('../groups/group-matches');
const { ensureAttendancePost } = require('../groups/attendance-service');
const {
  BOMBER_X_LOCO_EVENT_DATE,
  BOMBER_X_LOCO_EVENT_KEY,
  BOMBER_X_LOCO_GROUP_SIZE,
  HALLOWEEN_EVENT_DATE,
  HALLOWEEN_EVENT_KEY,
  HALLOWEEN_CHECKIN_CHANNEL_ID,
  isBomberXLocoEvent,
} = require('../events/bomber-x-loco-config');

const EVENT_KEY = BOMBER_X_LOCO_EVENT_KEY;
const PREPARE_AT = new Date(`${BOMBER_X_LOCO_EVENT_DATE}T18:45:00+02:00`);
const EVENT_END = new Date('2026-09-26T07:00:00+02:00');
const HALLOWEEN_PREPARE_AT = new Date(`${HALLOWEEN_EVENT_DATE}T18:45:00+01:00`);
const HALLOWEEN_END = new Date('2026-10-31T07:00:00+01:00');
const EPHEMERAL = 64;
let prepareTimer = null;

function nowIso(now = new Date()) { return now.toISOString(); }
function readSettings() { return readJson(FILES.settings, createSettingsDefault()); }
function isTargetEvent(event) {
  return isBomberXLocoEvent(event) && (
    ((!event.eventKey || event.eventKey === EVENT_KEY) && event.cycle?.eventDate === BOMBER_X_LOCO_EVENT_DATE)
    || (event.eventKey === HALLOWEEN_EVENT_KEY && event.cycle?.eventDate === HALLOWEEN_EVENT_DATE)
  );
}
function prepareAt(eventKey) { return eventKey === HALLOWEEN_EVENT_KEY ? HALLOWEEN_PREPARE_AT : PREPARE_AT; }

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
    type: 'pending',
    teamId: null,
    participantKey: `pending:${groupKey}:${index + 1}`,
    displayName: 'Noch nicht zugeteilt',
    pendingAssignment: true,
  }));
}

function createEmptyManualGroups(size, eventKey = EVENT_KEY) {
  const count = Number(size) / BOMBER_X_LOCO_GROUP_SIZE;
  return Object.fromEntries(GROUP_KEYS.slice(0, count).map(groupKey => {
    const group = {
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
    };
    group.matchdays = createGroupMatchdays({ eventKey, group, createdAt: nowIso() });
    return [groupKey, group];
  }));
}

function participantKey(participant) {
  if (participant?.type === 'bye') return `bye:${participant.byeId || participant.id}`;
  if (participant?.type === 'team') return `team:${participant.teamId || participant.id}`;
  return null;
}

function assignedParticipantKeys(event) {
  return Object.values(event.groups?.groups || {})
    .flatMap(group => group.slots || [])
    .map(participantKey)
    .filter(Boolean);
}

function lockedParticipants(event) {
  return (event.format?.participants || [])
    .filter(participant => participant?.type === 'team' || participant?.type === 'bye');
}

function availableParticipants(event) {
  const assigned = new Set(assignedParticipantKeys(event));
  let byeNumber = 0;
  return lockedParticipants(event)
    .map(participant => {
      if (participant.type === 'bye') {
        byeNumber += 1;
        return {
          type: 'bye',
          byeId: String(participant.byeId),
          displayName: `Freilos ${byeNumber}`,
          value: `bye:${participant.byeId}`,
        };
      }
      const team = findTeamById(participant.teamId);
      if (!team) return null;
      return {
        type: 'team',
        teamId: String(team.id),
        displayName: team.clubName,
        value: `team:${team.id}`,
      };
    })
    .filter(Boolean)
    .filter(participant => !assigned.has(participant.value))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'bye' ? -1 : 1;
      return String(a.displayName || '').localeCompare(String(b.displayName || ''), 'de');
    });
}

function rebuildGroupCompetitionData(group, now = new Date(), eventKey = EVENT_KEY) {
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
  group.assignmentComplete = (group.slots || []).every(slot => slot?.type === 'team' || slot?.type === 'bye');
  group.matchdays = createGroupMatchdays({ eventKey, group, createdAt: nowIso(now) });
  return group;
}

function persistResourceUpdates(updates, eventKey = EVENT_KEY) {
  if (!updates.length) return readEventData(eventKey);
  updateEventData(eventKey, current => {
    for (const update of updates) {
      const group = current.groups?.groups?.[update.groupKey];
      if (group) Object.assign(group, update);
    }
    current.meta = { ...(current.meta || {}), updatedAt: nowIso() };
    return current;
  });
  const persisted = readEventData(eventKey);
  updateGroupMessageRefs(eventKey, persisted, updates);
  return persisted;
}

async function syncGroupResources(client, event, groupKeys = null) {
  const eventKey = event.eventKey || EVENT_KEY;
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
      eventKey,
      formatSize: event.format?.size,
    }, {
      eventKey,
      messageId: group.messageId || null,
      headerMessageId: group.headerMessageId || null,
      teamsMessageId: group.teamsMessageId || null,
      tableMessageId: group.tableMessageId || null,
      scheduleMessageId: group.scheduleMessageId || null,
      resultsTableMessageId: group.resultsTableMessageId || null,
      resultsScheduleMessageId: group.resultsScheduleMessageId || null,
    }, resultsChannel);
    Object.assign(group, refs);

    updates.push({
      groupKey: group.groupKey,
      roleId: group.roleId,
      channelId: group.channelId,
      resultsChannelId: group.resultsChannelId,
      videoChannelId: group.videoChannelId,
      ...refs,
    });
  }

  const persisted = persistResourceUpdates(updates, eventKey);

  for (const update of updates) {
    await ensureAttendancePost(client, eventKey, update.groupKey).catch(error => {
      console.warn(`[bxl-manual-draw] Anwesenheitscheck Gruppe ${update.groupKey} konnte noch nicht aktualisiert werden: ${error.message}`);
    });
  }
  return { updates, event: persisted };
}

async function prepareManualDraw(client, now = new Date(), eventKey = EVENT_KEY) {
  let event = readEventData(eventKey);
  if (!isTargetEvent(event)) return { prepared: false, reason: 'not_target_event' };
  if (event.meta?.bomberManualDrawPreparedAt) return { prepared: false, reason: 'already_prepared', event };
  if (now.getTime() < prepareAt(eventKey).getTime()) {
    return { prepared: false, reason: 'too_early', event };
  }

  if (!event.format?.lockedAt) {
    lockEventFormat(eventKey, null, now);
    event = readEventData(eventKey);
  }
  if (!event.format?.size || Number(event.format.size) % BOMBER_X_LOCO_GROUP_SIZE !== 0) {
    throw new Error('Für die Live-Auslosung ist noch kein gültiges Bomber-X-Loco-Format gelockt.');
  }

  updateEventData(eventKey, current => {
    const timestamp = nowIso(now);
    current.status = 'groups';
    current.groups = {
      ...(current.groups || {}),
      status: 'created',
      drawnAt: null,
      drawnBy: null,
      manualDraw: true,
      manualDrawHost: 'Paddy HSV',
      groups: createEmptyManualGroups(current.format.size, eventKey),
    };
    current.meta = {
      ...(current.meta || {}),
      updatedAt: timestamp,
      bomberManualDrawPreparedAt: timestamp,
      bomberManualDrawCompletedAt: null,
    };
    return current;
  });

  event = readEventData(eventKey);
  await syncGroupResources(client, event);
  await refreshLiveSchedule(client, eventKey).catch(error => {
    console.warn(`[bxl-manual-draw] Öffentlicher Spielplan nach Vorbereitung fehlgeschlagen: ${error.message}`);
  });
  return { prepared: true, event: readEventData(eventKey) };
}

function scheduleManualDrawPreparation(client) {
  if (prepareTimer) clearTimeout(prepareTimer);
  prepareTimer = null;
  const now = new Date();
  if (now >= HALLOWEEN_END) return;
  if (now >= HALLOWEEN_PREPARE_AT) {
    prepareManualDraw(client, now, HALLOWEEN_EVENT_KEY).catch(error => console.error('[bxl-manual-draw] Halloween preparation failed:', error));
  } else {
    const halloweenTimer = setTimeout(() => scheduleManualDrawPreparation(client),
      Math.min(2 ** 31 - 1, HALLOWEEN_PREPARE_AT.getTime() - now.getTime()));
    if (typeof halloweenTimer.unref === 'function') halloweenTimer.unref();
  }
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
  const remainingParticipants = availableParticipants(event);
  const groups = Object.values(event.groups?.groups || {})
    .filter(group => (group.slots || []).some(slot => slot?.type === 'pending' || slot?.pendingAssignment === true))
    .filter(group => remainingParticipants.some(participant => participant.type === 'team'
      || !(group.slots || []).some(slot => slot?.type === 'bye')));
  if (!groups.length) throw new Error('Alle Gruppen sind bereits vollständig zugeteilt.');
  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('bxl_manual_group_select')
      .setPlaceholder('Gruppe auswählen')
      .addOptions(groups.map(group => {
        const assigned = (group.slots || []).filter(slot => slot?.type === 'team' || slot?.type === 'bye').length;
        return {
          label: `Gruppe ${group.groupKey}`,
          value: String(group.groupKey),
          description: `${assigned}/${BOMBER_X_LOCO_GROUP_SIZE} Plätze zugeteilt`,
        };
      }))
  )];
}

function buildParticipantSelectRows(event, groupKey) {
  const group = event.groups?.groups?.[groupKey];
  if (!group) throw new Error(`Gruppe ${groupKey} wurde nicht gefunden.`);
  const groupHasBye = (group.slots || []).some(slot => slot?.type === 'bye');
  const participants = availableParticipants(event)
    .filter(participant => participant.type === 'team' || !groupHasBye);
  if (!participants.length) throw new Error('Es gibt keine weiteren passenden Teilnehmerplätze für diese Gruppe.');
  const chunks = [];
  for (let index = 0; index < participants.length; index += 25) chunks.push(participants.slice(index, index + 25));
  return chunks.map((chunk, index) => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bxl_manual_team_select:${groupKey}:${index}`)
      .setPlaceholder(chunks.length > 1 ? `Team oder Freilos auswählen (${index + 1}/${chunks.length})` : 'Team oder Freilos auswählen')
      .addOptions(chunk.map(participant => ({
        label: String(participant.displayName).slice(0, 100),
        value: participant.value,
        description: participant.type === 'bye' ? 'Gelocktes Freilos' : undefined,
      })))
  ));
}

function assignParticipantInEvent(event, { groupKey, selectedValue, actorUserId, now = new Date() }) {
  if (!isTargetEvent(event) || event.groups?.manualDraw !== true) throw new Error('Die manuelle Bomber-X-Loco-Auslosung ist nicht aktiv.');
  const group = event.groups?.groups?.[groupKey];
  if (!group) throw new Error(`Gruppe ${groupKey} wurde nicht gefunden.`);

  const participant = lockedParticipants(event)
    .find(entry => participantKey(entry) === String(selectedValue));
  if (!participant) throw new Error('Dieser Teilnehmerplatz gehört nicht zum gelockten Teilnehmerfeld.');
  if (assignedParticipantKeys(event).includes(String(selectedValue))) throw new Error('Dieser Teilnehmerplatz wurde bereits einer Gruppe zugeteilt.');
  if (participant.type === 'bye' && (group.slots || []).some(slot => slot?.type === 'bye')) {
    throw new Error(`Gruppe ${groupKey} hat bereits ein Freilos.`);
  }

  const slot = (group.slots || []).find(entry => entry?.type === 'pending' || entry?.pendingAssignment === true);
  if (!slot) throw new Error(`Gruppe ${groupKey} ist bereits voll.`);

  if (participant.type === 'bye') {
    slot.type = 'bye';
    slot.teamId = null;
    slot.byeId = String(participant.byeId);
    slot.participantKey = `bye:${participant.byeId}`;
    slot.displayName = participant.displayName || 'Freilos';
  } else {
    const team = findTeamById(participant.teamId);
    if (!team) throw new Error('Team wurde nicht gefunden.');
    slot.type = 'team';
    slot.teamId = String(team.id);
    delete slot.byeId;
    slot.participantKey = `team:${team.id}`;
    slot.displayName = team.clubName;
  }
  slot.pendingAssignment = false;

  rebuildGroupCompetitionData(group, now, event.eventKey);
  event.groups.drawnAt = event.groups.drawnAt || nowIso(now);
  event.groups.drawnBy = actorUserId ? String(actorUserId) : event.groups.drawnBy;
  const allAssigned = assignedParticipantKeys(event).length === lockedParticipants(event).length
    && Object.values(event.groups?.groups || {}).every(entry => entry.assignmentComplete === true);
  if (allAssigned) event.meta = { ...(event.meta || {}), bomberManualDrawCompletedAt: nowIso(now) };
  event.meta = { ...(event.meta || {}), updatedAt: nowIso(now) };
  return { event, group, participant, allAssigned };
}

async function assignParticipantToGroup({ client, groupKey, selectedValue, actorUserId, eventKey = EVENT_KEY, now = new Date() }) {
  let changedGroup = null;
  let assignedParticipant = null;
  updateEventData(eventKey, event => {
    const result = assignParticipantInEvent(event, { groupKey, selectedValue, actorUserId, now });
    changedGroup = result.group;
    assignedParticipant = result.participant;
    return event;
  });

  const event = readEventData(eventKey);
  await syncGroupResources(client, event, [groupKey]);
  refreshLiveSchedule(client, eventKey).catch(error => {
    console.warn(`[bxl-manual-draw] Öffentlicher Spielplan nach Gruppenzuteilung fehlgeschlagen: ${error.message}`);
  });
  return { event: readEventData(eventKey), group: changedGroup, participant: assignedParticipant };
}

async function handleInteraction(interaction, client) {
  const customId = String(interaction.customId || '');
  if (!['bxl_manual_group_assignment', 'bxl_manual_group_select'].includes(customId)
      && !customId.startsWith('bxl_manual_team_select:')) return false;

  const settings = readSettings();
  const halloweenChannelId = HALLOWEEN_CHECKIN_CHANNEL_ID || settings.channels?.checkinChannelIds?.[HALLOWEEN_EVENT_KEY];
  const eventKey = halloweenChannelId && String(interaction.channelId) === String(halloweenChannelId) ? HALLOWEEN_EVENT_KEY : EVENT_KEY;
  const member = interaction.guild
    ? await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member)
    : null;
  if (!isAdminMember(member, settings)) {
    await interaction.reply({ content: 'Diese Gruppenzuteilung ist nur für Admins und Cup-Leads.', flags: EPHEMERAL }).catch(() => null);
    return true;
  }

  try {
    let event = readEventData(eventKey);
    if (!isTargetEvent(event)) throw new Error('Dieser Button ist nur für die aktive Bomber X Loco Auslosung vorgesehen.');

    if (!event.meta?.bomberManualDrawPreparedAt) {
      const now = new Date();
      if (now.getTime() < prepareAt(eventKey).getTime()) {
        await interaction.reply({
        content: 'Die manuelle Gruppenzuteilung wird am Eventtag ab **18:45 Uhr** freigeschaltet.',
          flags: EPHEMERAL,
        });
        return true;
      }
      await interaction.deferReply({ flags: EPHEMERAL });
      await prepareManualDraw(client, now, eventKey);
      event = readEventData(eventKey);
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
        content: `Gruppe **${groupKey}** ausgewählt. Welches gezogene Team oder Freilos soll dort hinein?`,
        components: buildParticipantSelectRows(event, groupKey),
      });
      return true;
    }

    if (customId.startsWith('bxl_manual_team_select:')) {
      const [, groupKey] = customId.split(':');
      const selectedValue = interaction.values?.[0];
      await interaction.deferUpdate();
      const result = await assignParticipantToGroup({ client, groupKey, selectedValue, actorUserId: interaction.user.id, eventKey });
      const assignedName = result.participant?.type === 'bye'
        ? result.participant.displayName || 'Freilos'
        : findTeamById(result.participant?.teamId)?.clubName || result.participant?.displayName || selectedValue;
      const remaining = availableParticipants(result.event).length;
      await interaction.editReply({
        content: `✅ **${assignedName}** wurde **Gruppe ${groupKey}** zugeteilt.${remaining ? ` Noch ${remaining} Teilnehmer${remaining === 1 ? 'platz' : 'plätze'} offen.` : ' Die Live-Auslosung ist vollständig zugeteilt.'}`,
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
  assignParticipantInEvent,
  assignParticipantToGroup,
  availableParticipants,
  createEmptyManualGroups,
  handleInteraction,
  prepareManualDraw,
  scheduleManualDrawPreparation,
};
