'use strict';

const PAIRINGS = [
  { matchday: 1, pairs: [[1, 2], [3, 4]] },
  { matchday: 2, pairs: [[1, 3], [2, 4]] },
  { matchday: 3, pairs: [[1, 4], [2, 3]] },
];

function slotEntry(group, slotNumber) {
  return group.slots.find(slot => slot.slot === slotNumber) || null;
}

function hasBye(home, away) {
  return home?.type === 'bye' || away?.type === 'bye';
}

function createMatchId(eventKey, groupKey, matchday, matchIndex) {
  return `${eventKey}_${groupKey}_md${matchday}_m${matchIndex}`;
}

function createMatch({ eventKey, group, matchday, matchIndex, homeSlot, awaySlot, createdAt }) {
  const home = slotEntry(group, homeSlot);
  const away = slotEntry(group, awaySlot);

  return {
    id: createMatchId(eventKey, group.groupKey, matchday, matchIndex),
    groupKey: group.groupKey,
    matchday,
    homeSlot,
    awaySlot,
    home,
    away,
    status: hasBye(home, away) ? 'admin_decision_required' : 'scheduled',
    result: null,
    confirmedBy: [],
    adminDecision: null,
    meta: {
      createdAt,
      updatedAt: null,
    },
  };
}

function createGroupMatchdays({ eventKey, group, createdAt }) {
  return PAIRINGS.map(matchdayDefinition => ({
    matchday: matchdayDefinition.matchday,
    matches: matchdayDefinition.pairs.map(([homeSlot, awaySlot], index) => createMatch({
      eventKey,
      group,
      matchday: matchdayDefinition.matchday,
      matchIndex: index + 1,
      homeSlot,
      awaySlot,
      createdAt,
    })),
  }));
}

module.exports = {
  createGroupMatchdays,
};
