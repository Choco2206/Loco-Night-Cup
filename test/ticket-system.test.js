'use strict';

const assert = require('assert');
const { PermissionFlagsBits } = require('discord.js');
const { createSettingsDefault, createTicketsDefault } = require('../src/storage/defaults');
const {
  buildPanelComponents,
  buildPanelEmbed,
  buildTicketEmbed,
  formatTicketNumber,
  stars,
} = require('../src/domain/tickets/ticket-components');
const { activeTicketsForUser, buildTranscript } = require('../src/domain/tickets/ticket-store');
const { dueForReminder } = require('../src/domain/tickets/ticket-reminders');
const { parseNumber, roleLabelForMember } = require('../src/domain/tickets/ticket-interactions');
const { panelPayload, supportOverwrites } = require('../src/domain/tickets/ticket-setup');

assert.strictEqual(formatTicketNumber(1), '001');
assert.strictEqual(formatTicketNumber(99), '099');
assert.strictEqual(formatTicketNumber(1000), '1000');
assert.strictEqual(stars(5), '⭐⭐⭐⭐⭐');

const defaults = createTicketsDefault();
assert.strictEqual(defaults.nextNumber, 1);
assert.deepStrictEqual(defaults.tickets, {});

const settings = createSettingsDefault();
settings.roles.managerRoleId = '100';
settings.roles.playerRoleId = '200';
const manager = { roles: { cache: new Map([['100', {}], ['200', {}]]) } };
const player = { roles: { cache: new Map([['200', {}]]) } };
assert.strictEqual(roleLabelForMember(manager, settings), 'Manager');
assert.strictEqual(roleLabelForMember(player, settings), 'Spieler');
assert.strictEqual(roleLabelForMember({ roles: { cache: new Map() } }, settings), null);

assert.strictEqual(parseNumber('ticket_claim:12', 'ticket_claim'), 12);
assert.strictEqual(parseNumber('ticket_close_confirm:12', 'ticket_close'), null);

const sample = {
  number: 1,
  status: 'open',
  category: 'cup_support',
  creatorId: '123',
  creatorName: 'Choco',
  roleLabel: 'Manager',
  teamName: 'Loco Squad',
  subject: 'Ergebnis fehlt',
  description: 'Unser Ergebnis kann nicht eingetragen werden.',
  createdAt: '2026-09-03T00:00:00.000Z',
};
const ticketEmbed = buildTicketEmbed(sample).toJSON();
assert.strictEqual(ticketEmbed.title, 'Ticket #001');
assert.ok(ticketEmbed.fields.some(field => field.name === 'Serverrolle' && field.value === 'Manager'));
assert.ok(ticketEmbed.fields.some(field => field.name === 'Status' && field.value.includes('Offen')));

const panel = buildPanelEmbed().toJSON();
const panelRows = buildPanelComponents().map(row => row.toJSON());
assert.strictEqual(panel.title, '🐺 LOCO NIGHT CUP • TICKET CENTER');
assert.ok(panel.fields.some(field => field.name.includes('SUPPORT-BEREICHE')));
assert.ok(panel.fields.some(field => field.name.includes('PRIVAT')));
assert.strictEqual(panelRows[0].components[0].options.length, 6);
const completePanel = panelPayload(createSettingsDefault());
assert.strictEqual(completePanel.embeds.length, 2);
assert.strictEqual(completePanel.embeds[0].toJSON().image.url, 'attachment://loco-night-cup-ticket-system.jpeg');
assert.strictEqual(completePanel.embeds[1].toJSON().title, '🐺 LOCO NIGHT CUP • TICKET CENTER');

const activeStore = {
  tickets: {
    1: { creatorId: '123', status: 'open' },
    2: { creatorId: '123', status: 'closed' },
    3: { creatorId: '456', status: 'in_progress' },
  },
};
assert.strictEqual(activeTicketsForUser(activeStore, '123').length, 1);

const transcript = buildTranscript(sample, [{
  createdAt: new Date('2026-09-03T00:01:00.000Z'),
  author: { tag: 'User#0001', id: '123' },
  content: 'Hallo',
  attachments: new Map([['a', { url: 'https://example.invalid/image.png' }]]),
}]);
assert.ok(transcript.includes('User#0001 (123): Hallo'));
assert.ok(transcript.includes('Anhang: https://example.invalid/image.png'));

const reminderSettings = createSettingsDefault();
reminderSettings.tickets = { inactivityHours: 48, reminderCooldownHours: 24 };
const now = Date.parse('2026-09-03T12:00:00.000Z');
assert.strictEqual(dueForReminder({ status: 'open', threadId: '1', lastActivityAt: '2026-09-01T11:59:00.000Z' }, reminderSettings, now), true);
assert.strictEqual(dueForReminder({ status: 'open', threadId: '1', lastActivityAt: '2026-09-02T12:00:00.000Z' }, reminderSettings, now), false);
assert.strictEqual(dueForReminder({ status: 'closed', threadId: '1', lastActivityAt: '2026-08-01T12:00:00.000Z' }, reminderSettings, now), false);

const overwrites = supportOverwrites({
  roles: { everyone: { id: 'everyone' } },
  members: { me: { id: 'bot' } },
  client: { user: { id: 'bot' } },
}, settings, { id: 'ticket-mod' });
const everyoneOverwrite = overwrites.find(item => item.id === 'everyone');
const managerOverwrite = overwrites.find(item => item.id === '100');
assert.ok(everyoneOverwrite.deny.includes(PermissionFlagsBits.ViewChannel));
assert.ok(everyoneOverwrite.deny.includes(PermissionFlagsBits.MentionEveryone));
assert.ok(managerOverwrite.allow.includes(PermissionFlagsBits.ViewChannel));
assert.ok(managerOverwrite.deny.includes(PermissionFlagsBits.CreatePrivateThreads));

console.log('ticket-system tests passed');
