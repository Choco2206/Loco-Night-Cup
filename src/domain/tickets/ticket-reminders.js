'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { formatTicketNumber } = require('./ticket-components');
const { ACTIVE_STATUSES, readTicketStore, updateTicket } = require('./ticket-store');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
let reminderTimer = null;

function dueForReminder(ticket, settings, now = Date.now()) {
  if (!ACTIVE_STATUSES.has(ticket.status) || !ticket.threadId) return false;
  const inactivityMs = Math.max(1, Number(settings.tickets?.inactivityHours) || 48) * 60 * 60 * 1000;
  const cooldownMs = Math.max(1, Number(settings.tickets?.reminderCooldownHours) || 24) * 60 * 60 * 1000;
  const lastActivity = new Date(ticket.lastActivityAt || ticket.createdAt || 0).getTime();
  const lastReminder = ticket.lastReminderAt ? new Date(ticket.lastReminderAt).getTime() : 0;
  return Number.isFinite(lastActivity)
    && now - lastActivity >= inactivityMs
    && (!lastReminder || now - lastReminder >= cooldownMs);
}

async function sendReminders(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const roleId = settings.roles?.ticketModRoleId;
  const guildId = settings.guild?.guildId;
  if (!roleId || !guildId) return 0;
  const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId)).catch(() => null);
  if (!guild) return 0;
  const role = guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
  if (!role) return 0;
  await guild.members.fetch().catch(() => null);
  const due = Object.values(readTicketStore().tickets || {}).filter(ticket => dueForReminder(ticket, settings));
  let reminded = 0;
  for (const ticket of due) {
    const link = `https://discord.com/channels/${guild.id}/${ticket.threadId}`;
    const payload = {
      content: [
        `⏰ **Ticket #${formatTicketNumber(ticket.number)} wartet seit mindestens ${Number(settings.tickets?.inactivityHours) || 48} Stunden.**`,
        `**Betreff:** ${ticket.subject}`,
        `[Zum Ticket](${link})`,
      ].join('\n'),
      allowedMentions: { parse: [] },
    };
    const mods = [...role.members.values()].filter(member => !member.user.bot);
    await Promise.allSettled(mods.map(member => member.send(payload)));
    updateTicket(ticket.number, current => ({ ...current, lastReminderAt: new Date().toISOString() }));
    reminded += 1;
  }
  return reminded;
}

function startTicketReminders(client) {
  if (reminderTimer) clearInterval(reminderTimer);
  sendReminders(client).catch(error => console.warn(`[tickets] Erinnerung fehlgeschlagen: ${error.message}`));
  reminderTimer = setInterval(() => {
    sendReminders(client).catch(error => console.warn(`[tickets] Erinnerung fehlgeschlagen: ${error.message}`));
  }, CHECK_INTERVAL_MS);
  if (typeof reminderTimer.unref === 'function') reminderTimer.unref();
  return reminderTimer;
}

module.exports = {
  CHECK_INTERVAL_MS,
  dueForReminder,
  sendReminders,
  startTicketReminders,
};
