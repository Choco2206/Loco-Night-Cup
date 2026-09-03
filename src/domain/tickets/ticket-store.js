'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createTicketsDefault } = require('../../storage/defaults');

const ACTIVE_STATUSES = new Set(['creating', 'open', 'in_progress']);

function readTicketStore() {
  return readJson(FILES.tickets, createTicketsDefault());
}

function updateTicketStore(updater) {
  return updateJson(FILES.tickets, createTicketsDefault(), current => {
    current.tickets = current.tickets || {};
    current.panel = current.panel || {};
    const next = updater(current) || current;
    next.meta = next.meta || {};
    next.meta.updatedAt = new Date().toISOString();
    if (!next.meta.createdAt) next.meta.createdAt = next.meta.updatedAt;
    return next;
  });
}

function activeTicketsForUser(store, userId) {
  return Object.values(store.tickets || {}).filter(ticket =>
    String(ticket.creatorId) === String(userId) && ACTIVE_STATUSES.has(ticket.status)
  );
}

function reserveTicket(input, maxOpen = 2) {
  let created = null;
  updateTicketStore(store => {
    if (activeTicketsForUser(store, input.creatorId).length >= maxOpen) {
      throw new Error(`Du kannst maximal ${maxOpen} offene Tickets gleichzeitig haben.`);
    }
    const number = Math.max(1, Number(store.nextNumber) || 1);
    const timestamp = new Date().toISOString();
    created = {
      number,
      status: 'creating',
      category: input.category,
      creatorId: String(input.creatorId),
      creatorName: input.creatorName || null,
      roleLabel: input.roleLabel || null,
      teamName: input.teamName || null,
      subject: input.subject,
      description: input.description,
      guildId: String(input.guildId),
      threadId: null,
      controlMessageId: null,
      participantIds: [String(input.creatorId)],
      claimedById: null,
      claimedAt: null,
      closedById: null,
      closeReason: null,
      closedAt: null,
      logMessageId: null,
      rating: null,
      ratingFeedback: null,
      ratingAt: null,
      ratingDmSent: false,
      supportRequestedAt: null,
      lastActivityAt: timestamp,
      lastReminderAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.tickets[String(number)] = created;
    store.nextNumber = number + 1;
    return store;
  });
  return created;
}

function getTicket(number) {
  return readTicketStore().tickets?.[String(Number(number))] || null;
}

function updateTicket(number, updater) {
  let updated = null;
  updateTicketStore(store => {
    const key = String(Number(number));
    const ticket = store.tickets?.[key];
    if (!ticket) throw new Error('Dieses Ticket wurde nicht gefunden.');
    updated = updater(ticket) || ticket;
    updated.updatedAt = new Date().toISOString();
    store.tickets[key] = updated;
    return store;
  });
  return updated;
}

function ticketByThreadId(threadId) {
  return Object.values(readTicketStore().tickets || {}).find(ticket =>
    ticket.threadId && String(ticket.threadId) === String(threadId)
  ) || null;
}

function buildTranscript(ticket, messages) {
  const header = [
    `Loco Night Cup - Ticket #${String(ticket.number).padStart(3, '0')}`,
    `Kategorie: ${ticket.category}`,
    `Erstellt von: ${ticket.creatorName || ticket.creatorId} (${ticket.creatorId})`,
    `Team: ${ticket.teamName || 'Nicht angegeben'}`,
    `Betreff: ${ticket.subject}`,
    `Erstellt: ${ticket.createdAt}`,
    `Geschlossen: ${ticket.closedAt || ''}`,
    `Schließgrund: ${ticket.closeReason || ''}`,
    '',
    'VERLAUF',
    '=======',
  ];
  const lines = messages.map(message => {
    const createdAt = message.createdAt instanceof Date ? message.createdAt.toISOString() : String(message.createdTimestamp || '');
    const author = message.author?.tag || message.author?.username || 'Unbekannt';
    const authorId = message.author?.id || 'unbekannt';
    const content = message.content?.trim() || '[Keine Textnachricht]';
    const attachments = message.attachments
      ? [...message.attachments.values()].map(item => item.url).filter(Boolean)
      : [];
    return [`[${createdAt}] ${author} (${authorId}): ${content}`, ...attachments.map(url => `  Anhang: ${url}`)].join('\n');
  });
  return [...header, ...lines].join('\n');
}

module.exports = {
  ACTIVE_STATUSES,
  activeTicketsForUser,
  buildTranscript,
  getTicket,
  readTicketStore,
  reserveTicket,
  ticketByThreadId,
  updateTicket,
  updateTicketStore,
};
