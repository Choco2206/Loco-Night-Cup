'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const { DATA_DIR, readJson, updateJson } = require('../../storage');
const FILE = path.join(DATA_DIR, 'premium.json');
const empty = () => ({ version: 1, subscriptions: {}, orders: [], panels: {}, audit: [] });
const readStore = () => readJson(FILE, empty());
const updateStore = fn => updateJson(FILE, empty(), fn);

function hasPremium(teamId, now = new Date(), store = readStore()) {
  const sub = store.subscriptions[String(teamId)];
  return !!sub && new Date(sub.startsAt) <= now && new Date(sub.expiresAt) > now;
}

// Calendar months in Berlin, including month-end clamping and DST changes.
function parts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function addMonths(date, months) {
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new Error('Bitte 1 bis 12 Monate wählen.');
  const p = parts(date);
  const target = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
  const year = target.getUTCFullYear(), month = target.getUTCMonth();
  const day = Math.min(p.day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  const wallTime = Date.UTC(year, month, day, p.hour, p.minute, p.second, date.getUTCMilliseconds());
  let result = new Date(wallTime);
  for (let i = 0; i < 3; i++) {
    const q = parts(result);
    const offset = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - (result.getTime() - result.getUTCMilliseconds());
    result = new Date(wallTime - offset);
  }
  return result;
}
function grantInStore(store, teamId, months, actorUserId, now) {
  const id = String(teamId), previous = store.subscriptions[id];
  const active = hasPremium(id, now, store);
  const base = active ? new Date(previous.expiresAt) : now;
  const subscription = { startsAt: active ? previous.startsAt : now.toISOString(), expiresAt: addMonths(base, months).toISOString(), updatedBy: String(actorUserId) };
  store.subscriptions[id] = subscription;
  store.audit.push({ action: 'grant', teamId: id, months, actorUserId: String(actorUserId), at: now.toISOString(), expiresAt: subscription.expiresAt });
  return subscription;
}
function grant(teamId, months, actorUserId, now = new Date()) {
  let result;
  updateStore(store => { result = grantInStore(store, teamId, months, actorUserId, now); return store; });
  return result;
}
function remove(teamId, actorUserId, now = new Date()) {
  updateStore(store => {
    delete store.subscriptions[String(teamId)];
    store.audit.push({ action: 'remove', teamId: String(teamId), actorUserId: String(actorUserId), at: now.toISOString() });
    return store;
  });
}
function createOrder(teamId, userId, months, now = new Date()) {
  addMonths(now, months);
  let order;
  updateStore(store => {
    const existing = store.orders.find(o => o.teamId === String(teamId) && ['awaiting_payment', 'paid'].includes(o.status));
    if (existing) { order = existing; return store; }
    order = { id: randomUUID(), teamId: String(teamId), userId: String(userId), months, amount: months * 5, status: 'awaiting_payment', createdAt: now.toISOString() };
    store.orders.push(order); return store;
  });
  return order;
}
function markPaid(id, userId, now = new Date()) {
  let order;
  updateStore(store => {
    order = store.orders.find(o => o.id === id);
    if (!order || order.userId !== String(userId)) throw new Error('Diese Anfrage gehört nicht zu dir.');
    if (!['awaiting_payment', 'paid'].includes(order.status)) throw new Error('Diese Anfrage wurde bereits abgeschlossen.');
    order.status = 'paid'; order.paidAt = order.paidAt || now.toISOString(); return store;
  });
  return order;
}
function decide(id, accepted, actorUserId, now = new Date()) {
  let result;
  updateStore(store => {
    const order = store.orders.find(o => o.id === id);
    if (!order || order.status !== 'paid') throw new Error('Dieser Fall ist nicht mehr offen.');
    const subscription = accepted ? grantInStore(store, order.teamId, order.months, actorUserId, now) : null;
    order.status = accepted ? 'approved' : 'rejected'; order.decidedAt = now.toISOString(); order.decidedBy = String(actorUserId);
    result = { order, subscription }; return store;
  });
  return result;
}
function sortPremiumEntries(entries, findTeam, now = new Date()) {
  const store = readStore();
  return [...entries].sort((a, b) => {
    const priority = Number(hasPremium(b.teamId, now, store)) - Number(hasPremium(a.teamId, now, store));
    if (priority) return priority;
    const first = Date.parse(a.checkedInAt), second = Date.parse(b.checkedInAt);
    return Number.isFinite(first) && Number.isFinite(second) ? first - second : 0;
  });
}
function premiumLabel(teamId, now = new Date()) { return hasPremium(teamId, now) ? ' 💎' : ''; }
function statusText(teamId, now = new Date()) {
  const store = readStore(), sub = store.subscriptions[String(teamId)];
  const date = value => new Date(value).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
  if (!hasPremium(teamId, now, store)) return sub ? `Nein (abgelaufen am ${date(sub.expiresAt)})` : 'Nein';
  return `Ja 💎\nLaufzeit: ${date(sub.startsAt)} bis ${date(sub.expiresAt)}`;
}
module.exports = { addMonths, createOrder, decide, grant, hasPremium, markPaid, premiumLabel, readStore, remove, sortPremiumEntries, statusText, updateStore };
