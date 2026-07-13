'use strict';

function assertCanLockEvent(event) {
  if (!['checkin', 'checkin_open', 'idle', 'deadline_reached', 'checkin_closed', 'draw_ready'].includes(event.status)) {
    throw new Error('Format-Lock ist nur vor der Gruppenphase moeglich.');
  }

  if (event.format?.lockedAt) {
    throw new Error('Das Format ist bereits gelockt.');
  }

  if (event.groups?.status && event.groups.status !== 'not_created') {
    throw new Error('Gruppen wurden fuer dieses Event bereits erstellt.');
  }
}

function assertGroupsHaveFourSlots(groups) {
  const groupList = Object.values(groups || {});
  const byeCounts = [];

  for (const group of groupList) {
    if (!Array.isArray(group.slots) || group.slots.length !== 4) {
      throw new Error(`Gruppe ${group.groupKey} muss genau 4 Slots haben.`);
    }

    byeCounts.push(group.slots.filter(slot => slot.type === 'bye').length);
  }

  if (!byeCounts.length) return;

  const totalByeCount = byeCounts.reduce((sum, count) => sum + count, 0);
  const minimumByeCount = Math.min(...byeCounts);
  const maximumByeCount = Math.max(...byeCounts);

  if (totalByeCount <= groupList.length && maximumByeCount > 1) {
    throw new Error('Freilose muessen auf unterschiedliche Gruppen verteilt werden.');
  }

  if (maximumByeCount - minimumByeCount > 1) {
    throw new Error('Freilose muessen moeglichst gleichmaessig auf die Gruppen verteilt werden.');
  }
}

module.exports = {
  assertCanLockEvent,
  assertGroupsHaveFourSlots,
};
