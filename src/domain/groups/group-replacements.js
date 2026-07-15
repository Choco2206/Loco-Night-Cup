'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { refreshCheckinMessage } = require('../checkins/checkin-panel');
const { findActiveBanForTeamOrManagers } = require('../checkins/checkin-ban-integration');
const { findTeamById, listVisibleTeams } = require('../teams/team-service');
const { getConfiguredGuild, getTeamUserIds } = require('./group-roles');
const { refreshGroupPosts } = require('./group-posts');
const { refreshLeaguePhasePosts } = require('../league-phase/league-phase-service');
const { recalculateGroupStandings, updateGroupCompletion } = require('./group-results');

function nowIso() {
  return new Date().toISOString();
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function participantKey(participant) {
  if (!participant) return null;
  if (participant.participantKey) return String(participant.participantKey);
  if (participant.type === 'team') return `team:${participant.teamId}`;
  if (participant.type === 'bye') return `bye:${participant.byeId}`;
  return null;
}

function participantLabel(participant) {
  if (!participant) return 'Unbekannter Slot';
  if (participant.type === 'bye') return participant.displayName || 'Freilos';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || 'Team';
}

function getEventGroup(eventKey, groupKey) {
  const event = readEventData(eventKey);
  const group = String(groupKey).toLowerCase() === 'league' ? event.leaguePhase : event.groups?.groups?.[groupKey];
  if (!group) throw new Error('Gruppe wurde nicht gefunden.');
  return { event, group };
}

function getGroupTeamIds(group) {
  return (group.slots || [])
    .filter(slot => slot?.type === 'team' && slot.teamId)
    .map(slot => String(slot.teamId));
}

function getAllGroupedTeamIds(event) {
  const ids = [];
  if (event.leaguePhase?.phaseType === 'league') ids.push(...getGroupTeamIds(event.leaguePhase));
  for (const group of Object.values(event.groups?.groups || {})) {
    ids.push(...getGroupTeamIds(group));
  }
  return new Set(ids.map(String));
}

function getLockedParticipantTeamIds(event) {
  return new Set([
    ...(event.checkin?.activeTeamIds || []).map(String),
    ...(event.format?.participants || [])
      .filter(participant => participant?.type === 'team' && participant.teamId)
      .map(participant => String(participant.teamId)),
  ]);
}

function getReplaceableParticipants({ eventKey, groupKey }) {
  const { group } = getEventGroup(eventKey, groupKey);
  return (group.slots || [])
    .filter(slot => slot?.slot && (slot.type === 'team' || slot.type === 'bye'))
    .map(slot => ({
      slot: slot.slot,
      participantKey: participantKey(slot),
      type: slot.type,
      teamId: slot.teamId || null,
      label: `${slot.slot}. ${participantLabel(slot)}`,
      description: slot.type === 'bye' ? 'Freilos-Platz ersetzen' : 'Team ersetzen',
    }));
}

function teamHasLeadership(team) {
  return Boolean(team?.manager?.userId) || (Array.isArray(team?.coManagers) && team.coManagers.length > 0);
}

function isTeamEligibleForReplacement(team, blockedTeamIds, replacementTargetTeamId, now = new Date()) {
  if (!team?.id) return false;
  const teamId = String(team.id);
  if (replacementTargetTeamId && teamId === String(replacementTargetTeamId)) return false;
  if (blockedTeamIds.has(teamId)) return false;
  if (team.status !== 'active') return false;
  if (team.registrationStatus !== 'complete') return false;
  if (!teamHasLeadership(team) && team.isTestTeam !== true) return false;
  if (findActiveBanForTeamOrManagers(team, null, now)) return false;
  return true;
}

function getAvailableReplacementTeams({ eventKey, groupKey, participantKeyValue, now = new Date() }) {
  const { event, group } = getEventGroup(eventKey, groupKey);
  const target = (group.slots || []).find(slot => participantKey(slot) === participantKeyValue);
  if (!target) throw new Error('Zu ersetzender Slot wurde nicht gefunden.');

  const blockedTeamIds = new Set([
    ...getLockedParticipantTeamIds(event),
    ...getAllGroupedTeamIds(event),
  ]);

  return listVisibleTeams()
    .filter(team => isTeamEligibleForReplacement(team, blockedTeamIds, target.teamId || null, now))
    .sort((a, b) => String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de', { sensitivity: 'base' }))
    .map(team => ({
      id: String(team.id),
      label: String(team.clubName || team.id).slice(0, 100),
      description: (event.checkin?.waitlistTeamIds || []).map(String).includes(String(team.id))
        ? 'Warteliste'
        : 'Registriert verfuegbar',
    }));
}

function createTeamParticipantFromSlot(slot, team) {
  return {
    ...slot,
    type: 'team',
    teamId: String(team.id),
    displayName: team.clubName || slot.displayName || String(team.id),
    isTestTeam: team.isTestTeam === true,
  };
}

function replaceParticipantInFormat(event, oldSlot, newTeam) {
  if (!Array.isArray(event.format?.participants)) return;
  const oldKey = participantKey(oldSlot);
  const index = event.format.participants.findIndex(participant => {
    if (participantKey(participant) === oldKey) return true;
    if (oldSlot.type === 'team' && participant.type === 'team') return String(participant.teamId || participant.id) === String(oldSlot.teamId);
    if (oldSlot.type === 'bye' && participant.type === 'bye') return String(participant.byeId || participant.id) === String(oldSlot.byeId);
    return false;
  });

  const replacement = {
    type: 'team',
    teamId: String(newTeam.id),
    id: String(newTeam.id),
    displayName: newTeam.clubName || String(newTeam.id),
    clubName: newTeam.clubName || String(newTeam.id),
    isTestTeam: newTeam.isTestTeam === true,
  };

  if (index >= 0) event.format.participants[index] = replacement;
}

function refreshFormatCounts(event) {
  const participants = Array.isArray(event.format?.participants) ? event.format.participants : [];
  const activeTeams = participants.filter(participant => participant?.type === 'team');
  const activeByes = participants.filter(participant => participant?.type === 'bye');
  event.format.activeRealTeamCount = activeTeams.length;
  event.format.realTeamCount = activeTeams.length;
  event.format.activeByeCount = activeByes.length;
  event.format.byeCount = activeByes.length;
  event.format.waitlistCount = Array.isArray(event.checkin?.waitlistTeamIds) ? event.checkin.waitlistTeamIds.length : 0;
}

function cleanupMatchReports(match, replacedParticipantKey) {
  match.reports = Array.isArray(match.reports)
    ? match.reports.filter(report => String(report.participantKey) !== String(replacedParticipantKey))
    : [];
  match.confirmedBy = Array.isArray(match.confirmedBy)
    ? match.confirmedBy.filter(entry => String(entry.participantKey || entry) !== String(replacedParticipantKey))
    : [];
}

function normalizeMatchAfterReplacement(match, replacedParticipantKey) {
  const homeIsTeam = match.home?.type === 'team';
  const awayIsTeam = match.away?.type === 'team';
  const isRealMatch = homeIsTeam && awayIsTeam;

  cleanupMatchReports(match, replacedParticipantKey);

  if (!isRealMatch) {
    match.status = 'bye';
    match.result = null;
    match.adminDecision = null;
    return;
  }

  if (match.result && match.status === 'confirmed') return;
  if (match.reports.length >= 2) {
    match.status = 'pending_confirmation';
    return;
  }
  if (match.reports.length === 1) {
    match.status = 'pending_confirmation';
    return;
  }

  match.status = 'open';
  match.result = null;
  match.adminDecision = null;
}

function replaceSlotInGroup(group, oldSlot, replacementParticipant) {
  const key = participantKey(oldSlot);
  for (const slot of group.slots || []) {
    if (participantKey(slot) === key) {
      Object.keys(slot).forEach(property => delete slot[property]);
      Object.assign(slot, replacementParticipant);
    }
  }

  for (const matchday of group.matchdays || []) {
    for (const match of matchday.matches || []) {
      if (group.phaseType === 'league' && match.status === 'confirmed') continue;
      let touched = false;
      if (participantKey(match.home) === key || Number(match.homeSlot) === Number(oldSlot.slot)) {
        match.home = { ...replacementParticipant };
        touched = true;
      }
      if (participantKey(match.away) === key || Number(match.awaySlot) === Number(oldSlot.slot)) {
        match.away = { ...replacementParticipant };
        touched = true;
      }
      if (touched) {
        normalizeMatchAfterReplacement(match, key);
        match.meta = { ...(match.meta || {}), updatedAt: nowIso() };
      }
    }
  }
}

function updateEventCheckin(event, oldTeamId, newTeamId) {
  event.checkin = event.checkin || {};
  const active = new Set((event.checkin.activeTeamIds || []).map(String));
  const waitlist = new Set((event.checkin.waitlistTeamIds || []).map(String));

  if (oldTeamId) active.delete(String(oldTeamId));
  active.add(String(newTeamId));
  waitlist.delete(String(newTeamId));

  event.checkin.activeTeamIds = [...active];
  event.checkin.waitlistTeamIds = [...waitlist];
}

function replaceGroupParticipant({ eventKey, groupKey, participantKeyValue, replacementTeamId }) {
  const newTeam = findTeamById(replacementTeamId);
  if (!newTeam) throw new Error('Ersatzteam wurde nicht gefunden.');

  let outcome;
  updateEventData(eventKey, event => {
    const group = String(groupKey).toLowerCase() === 'league' ? event.leaguePhase : event.groups?.groups?.[groupKey];
    if (!group) throw new Error('Gruppe wurde nicht gefunden.');

    const oldSlot = (group.slots || []).find(slot => participantKey(slot) === participantKeyValue);
    if (!oldSlot) throw new Error('Zu ersetzender Slot wurde nicht gefunden.');

    const available = getAvailableReplacementTeams({ eventKey, groupKey, participantKeyValue });
    if (!available.some(team => String(team.id) === String(replacementTeamId))) {
      throw new Error('Dieses Team ist nicht als Ersatzteam verfuegbar.');
    }

    const originalSlot = { ...oldSlot };
    const oldTeam = originalSlot.type === 'team' ? findTeamById(originalSlot.teamId) : null;
    const replacementParticipant = createTeamParticipantFromSlot(originalSlot, newTeam);
    replaceParticipantInFormat(event, originalSlot, newTeam);
    replaceSlotInGroup(group, oldSlot, replacementParticipant);
    updateEventCheckin(event, oldTeam?.id || null, newTeam.id);
    refreshFormatCounts(event);
    recalculateGroupStandings(group);
    updateGroupCompletion(event, group);

    const timestamp = nowIso();
    group.meta = { ...(group.meta || {}), updatedAt: timestamp };
    event.meta = { ...(event.meta || {}), updatedAt: timestamp };

    outcome = {
      event,
      group,
      oldTeam,
      newTeam,
      oldSlot: originalSlot,
      replacementParticipant,
    };
    return event;
  });

  return outcome;
}

function groupUserIdsAfterReplacement(group) {
  const ids = [];
  for (const teamId of getGroupTeamIds(group)) {
    ids.push(...getTeamUserIds(findTeamById(teamId)));
  }
  return new Set(ids.map(String));
}

async function removeRoleFromUser(guild, userId, roleId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.roles?.cache?.has(roleId)) return false;
  await member.roles.remove(roleId).catch(() => null);
  return true;
}

async function addRoleToUser(guild, userId, roleId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.roles.cache.has(roleId)) return false;
  await member.roles.add(roleId).catch(() => null);
  return true;
}

async function removeUserOverwrite(channel, userId) {
  if (!channel?.permissionOverwrites) return;
  await channel.permissionOverwrites.delete(userId).catch(() => null);
}

async function allowUserInGroupChannel(channel, userId) {
  if (!channel?.permissionOverwrites) return;
  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
  }).catch(() => null);
}

async function syncReplacementDiscordResources({ client, eventKey, outcome }) {
  if (!client || !outcome?.group) return { oldUserIds: [], newUserIds: [] };

  const settings = readSettings();
  const guild = await getConfiguredGuild(client, settings);
  if (!guild) return { oldUserIds: [], newUserIds: [] };

  const roleId = outcome.group.roleId;
  const channelId = outcome.group.phaseType === 'league' ? outcome.group.resultsChannelId : outcome.group.channelId;
  const channel = channelId
    ? await client.channels.fetch(channelId).catch(() => null)
    : null;
  const oldUserIds = getTeamUserIds(outcome.oldTeam);
  const newUserIds = getTeamUserIds(outcome.newTeam);
  const currentGroupUserIds = groupUserIdsAfterReplacement(outcome.group);

  if (roleId) {
    for (const userId of oldUserIds) {
      if (!currentGroupUserIds.has(String(userId))) await removeRoleFromUser(guild, userId, roleId);
    }
    for (const userId of newUserIds) {
      await addRoleToUser(guild, userId, roleId);
    }
  }

  if (channel) {
    for (const userId of oldUserIds) {
      if (!currentGroupUserIds.has(String(userId))) await removeUserOverwrite(channel, userId);
    }
    for (const userId of newUserIds) {
      await allowUserInGroupChannel(channel, userId);
    }
  }

  if (outcome.group.phaseType === 'league') await refreshLeaguePhasePosts(client, eventKey);
  else await refreshGroupPosts({ client, eventKey, event: outcome.event, group: outcome.group });
  await refreshCheckinMessage(eventKey, client);

  return { oldUserIds, newUserIds };
}

async function announceReplacement({ interaction, outcome, newUserIds }) {
  const channel = interaction.channel;
  if (!channel?.send) return;
  const oldLabel = outcome.oldTeam?.clubName || participantLabel(outcome.oldSlot);
  const newLabel = outcome.newTeam?.clubName || outcome.replacementParticipant.displayName;
  const mentions = (newUserIds || []).map(userId => `<@${userId}>`);
  await channel.send({
    content: [
      `🔁 **Nachruecker eingesetzt:** ${oldLabel} -> ${newLabel}`,
      mentions.length ? `Zustaendig: ${mentions.join(', ')}` : null,
    ].filter(Boolean).join('\n'),
    allowedMentions: { users: newUserIds || [] },
  }).catch(() => null);
}

module.exports = {
  announceReplacement,
  getAvailableReplacementTeams,
  getReplaceableParticipants,
  replaceGroupParticipant,
  syncReplacementDiscordResources,
};
