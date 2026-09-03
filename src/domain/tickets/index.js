'use strict';

const { ensureTicketSystem } = require('./ticket-setup');
const { handleInteraction } = require('./ticket-interactions');
const { startTicketReminders } = require('./ticket-reminders');
const { ticketByThreadId, updateTicket } = require('./ticket-store');

async function init(client) {
  const result = await ensureTicketSystem(client);
  if (result) startTicketReminders(client);
  return result;
}

async function handleMessage(message) {
  if (!message.guild || message.author?.bot || !message.channel?.isThread?.()) return false;
  const ticket = ticketByThreadId(message.channel.id);
  if (!ticket || !['open', 'in_progress'].includes(ticket.status)) return false;
  updateTicket(ticket.number, current => ({ ...current, lastActivityAt: new Date().toISOString() }));
  return false;
}

module.exports = {
  handleInteraction,
  handleMessage,
  init,
};
