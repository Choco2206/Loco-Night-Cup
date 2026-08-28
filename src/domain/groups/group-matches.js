'use strict';

const NORMAL_PAIRINGS = [
  { matchday: 1, pairs: [[1, 2], [3, 4]] },
  { matchday: 2, pairs: [[1, 3], [2, 4]] },
  { matchday: 3, pairs: [[1, 4], [2, 3]] },
];

const SIX_TEAM_PAIRINGS = [
  { matchday: 1, pairs: [[1, 6], [2, 5], [3, 4]] },
  { matchday: 2, pairs: [[1, 5], [6, 4], [2, 3]] },
  { matchday: 3, pairs: [[1, 4], [5, 3], [6, 2]] },
  { matchday: 4, pairs: [[1, 3], [4, 2], [5, 6]] },
  { matchday: 5, pairs: [[1, 2], [3, 6], [4, 5]] },
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
    status: hasBye(home, away) ? 'bye' : 'open',
    result: null,
    reports: [],
    confirmedBy: [],
    adminDecision: null,
    release: {
      slot: matchday,
      releasedAt: null,
    },
    meta: {
      createdAt,
      updatedAt: null,
    },
  };
}

function createGroupMatchdays({ eventKey, group, createdAt }) {
  const pairings = group.slots?.length === 6 ? SIX_TEAM_PAIRINGS : NORMAL_PAIRINGS;
  return pairings.map(matchdayDefinition => ({
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
