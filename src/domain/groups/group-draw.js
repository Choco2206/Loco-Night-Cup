'use strict';

const { GROUP_KEYS } = require('../../app/constants');
const { createGroupMatchdays } = require('./group-matches');

function createTeamSlot(team) {
  return {
    type: 'team',
    teamId: String(team.teamId || team.id),
    displayName: team.displayName || team.clubName || `Team ${team.teamId || team.id}`,
    isTestTeam: team.isTestTeam === true,
  };
}

function createByeSlot(bye) {
  return {
    type: 'bye',
    byeId: String(bye.byeId || bye.id),
    displayName: bye.displayName || bye.label || 'Freilos',
  };
}

function createEmptyGroups(groupCount, settings) {
  return GROUP_KEYS.slice(0, groupCount).map(groupKey => ({
    groupKey,
    roleId: settings.roles?.groupRoleIds?.[groupKey] || null,
    channelId: settings.channels?.groupChannelIds?.[groupKey] || null,
    slots: [null, null, null, null],
    matchdays: [],
  }));
}

function shuffledSlotRefs(groups) {
  const refs = [];
  for (const group of groups) {
    for (let slotIndex = 0; slotIndex < group.slots.length; slotIndex += 1) {
      refs.push({ group, slotIndex });
    }
  }
  return shuffleParticipants(refs);
}

function groupByeCount(group) {
  return group.slots.filter(slot => slot?.type === 'bye').length;
}

function placeParticipants(groups, participants) {
  const slotRefs = shuffledSlotRefs(groups);

  for (const participant of participants) {
    const availableSlotRefs = slotRefs.filter(ref => !ref.group.slots[ref.slotIndex]);
    let slotRef = availableSlotRefs[0];

    if (participant.type === 'bye' && availableSlotRefs.length) {
      const minimumByeCount = Math.min(...availableSlotRefs.map(ref => groupByeCount(ref.group)));
      slotRef = availableSlotRefs.find(ref => groupByeCount(ref.group) === minimumByeCount);
    }

    if (!slotRef) {
      throw new Error('Gruppen konnten nicht zufaellig mit den gelockten Teilnehmern belegt werden.');
    }

    slotRef.group.slots[slotRef.slotIndex] = participant.type === 'bye'
      ? createByeSlot(participant)
      : createTeamSlot(participant);
  }
}

function finalizeSlots(group) {
  group.slots = group.slots.map((entry, index) => ({
    slot: index + 1,
    participantKey: entry.type === 'team' ? `team:${entry.teamId}` : `bye:${entry.byeId}`,
    ...entry,
  }));
  return group;
}

function createStandings(slots) {
  return slots
    .filter(slot => slot.type === 'team')
    .map(slot => ({
      slot: slot.slot,
      participantKey: slot.participantKey,
      teamId: slot.teamId,
      displayName: slot.displayName,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    }));
}

function shuffleParticipants(participants) {
  const shuffled = [...participants];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function createGroups({ eventKey, field, settings, createdAt }) {
  const groups = createEmptyGroups(field.groupCount, settings);
  const participants = Array.isArray(field.participants) ? field.participants : [];
  const byes = shuffleParticipants(participants.filter(participant => participant?.type === 'bye'));
  const teams = shuffleParticipants(participants.filter(participant => participant?.type !== 'bye'));
  placeParticipants(groups, [...byes, ...teams]);

  const finalizedGroups = groups.map(group => {
    finalizeSlots(group);
    if (group.slots.some(slot => !slot.type)) {
      throw new Error(`Gruppe ${group.groupKey} konnte nicht vollstaendig mit 4 Slots erstellt werden.`);
    }
    group.name = `Gruppe ${group.groupKey}`;
    group.standings = createStandings(group.slots);
    group.matchdays = createGroupMatchdays({ eventKey, group, createdAt });
    return group;
  });

  return Object.fromEntries(finalizedGroups.map(group => [group.groupKey, group]));
}

module.exports = {
  createGroups,
};
