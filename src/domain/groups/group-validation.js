'use strict';

function assertCanLockEvent(event) {
  if (!['checkin', 'idle'].includes(event.status)) {
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
  for (const group of Object.values(groups || {})) {
    if (!Array.isArray(group.slots) || group.slots.length !== 4) {
      throw new Error(`Gruppe ${group.groupKey} muss genau 4 Slots haben.`);
    }

    const byeCount = group.slots.filter(slot => slot.type === 'bye').length;
    if (byeCount > 1) {
      throw new Error(`Gruppe ${group.groupKey} hat mehr als ein Freilos.`);
    }
  }
}

module.exports = {
  assertCanLockEvent,
  assertGroupsHaveFourSlots,
};
