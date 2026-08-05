'use strict';

const assert = require('assert');
const {
  buildTeamBlocks,
  formatUser,
  messagesAreOutOfOrder,
} = require('../src/domain/teams/team-overview');

assert.strictEqual(
  formatUser('123456789'),
  '<@123456789>',
  'Eine gespeicherte Discord-ID muss unabhängig vom Member-Cache als Mention erscheinen.',
);

const blocks = buildTeamBlocks([
  {
    clubName: 'Zebra FC',
    manager: { userId: '3' },
    coManagers: [],
  },
  {
    clubName: 'Ähren FC',
    manager: { userId: '1' },
    coManagers: [{ userId: '2' }],
  },
]);

assert.ok(blocks[0].includes('Ähren FC'), 'Die Teamübersicht muss deutsch-alphabetisch sortiert sein.');
assert.ok(blocks[0].includes('<@1>'), 'Der VM muss als Mention erscheinen.');
assert.ok(blocks[0].includes('<@2>'), 'Der Co-VM muss als Mention erscheinen.');
assert.ok(blocks[1].includes('**Co-VM:** Keine'), 'Ohne gespeicherte Co-VMs muss „Keine“ erscheinen.');

assert.strictEqual(
  messagesAreOutOfOrder([{ createdTimestamp: 100 }, { createdTimestamp: 200 }]),
  false,
  'Korrekte Nachrichtenreihenfolge darf keinen Neuaufbau auslösen.',
);
assert.strictEqual(
  messagesAreOutOfOrder([{ createdTimestamp: 200 }, { createdTimestamp: 100 }]),
  true,
  'Vertauschte Nachrichten müssen erkannt werden.',
);

console.log('team-overview tests passed');
