'use strict';

const { GROUP_KEYS } = require('../../app/constants');
const { createGroupMatchdays } = require('./group-matches');

function createTeamSlot(team) {
  return {
    type: 'team',
    teamId: String(team.id),
  };
}

function createByeSlot(bye) {
  return {
    type: 'bye',
    byeId: String(bye.id),
    label: bye.label || 'Freilos',
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

function placeByes(groups, byes) {
  if (byes.length > groups.length) {
    throw new Error('Maximal ein Freilos pro Gruppe erlaubt.');
  }

  byes.forEach((bye, index) => {
    groups[index].slots[3] = createByeSlot(bye);
  });
}

function placeTeams(groups, teams) {
  let teamIndex = 0;

  for (const group of groups) {
    for (let slotIndex = 0; slotIndex < group.slots.length; slotIndex += 1) {
      if (group.slots[slotIndex]) continue;
      const team = teams[teamIndex];
      if (!team) return;
      group.slots[slotIndex] = createTeamSlot(team);
      teamIndex += 1;
    }
  }
}

function finalizeSlots(group) {
  group.slots = group.slots.map((entry, index) => ({
    slot: index + 1,
    ...entry,
  }));
  return group;
}

function createGroups({ eventKey, field, settings, createdAt }) {
  const groups = createEmptyGroups(field.groupCount, settings);
  placeByes(groups, field.activeByes);
  placeTeams(groups, field.activeTeams);

  const finalizedGroups = groups.map(group => {
    finalizeSlots(group);
    if (group.slots.some(slot => !slot.type)) {
      throw new Error(`Gruppe ${group.groupKey} konnte nicht vollstaendig mit 4 Slots erstellt werden.`);
    }
    group.matchdays = createGroupMatchdays({ eventKey, group, createdAt });
    return group;
  });

  return Object.fromEntries(finalizedGroups.map(group => [group.groupKey, group]));
}

module.exports = {
  createGroups,
};
