'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

test('Premium calendar months retain the Berlin day across DST and clamp month ends', () => {
  const { addMonths } = require('../src/domain/premium/premium-store');
  assert.equal(addMonths(new Date('2026-10-15T10:00:00Z'), 1).toISOString(), '2026-11-15T11:00:00.000Z');
  assert.equal(addMonths(new Date('2026-01-31T11:00:00Z'), 1).toISOString(), '2026-02-28T11:00:00.000Z');
  assert.equal(addMonths(new Date('2026-03-15T11:00:00Z'), 1).toISOString(), '2026-04-15T10:00:00.000Z');
  assert.throws(() => addMonths(new Date(), 13));
});

test('Premium payment transitions are persistent, team-bound, and cannot be approved twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lnc-premium-'));
  const original = Module._load;
  const modulePath = require.resolve('../src/domain/premium/premium-store');
  delete require.cache[modulePath];
  Module._load = function(request, parent, main) {
    if (request === '../../storage' && parent?.filename === modulePath) return { ...original.call(this, request, parent, main), DATA_DIR: dir };
    return original.call(this, request, parent, main);
  };
  let p;
  try { p = require(modulePath); } finally { Module._load = original; delete require.cache[modulePath]; }
  try {
    const now = new Date('2026-10-15T10:00:00Z');
    const order = p.createOrder('team-b', 'vm', 2, now);
    assert.equal(order.amount, 10);
    assert.equal(p.createOrder('team-b', 'co-vm', 12, now).id, order.id);
    assert.equal(p.hasPremium('team-b', now), false);
    assert.throws(() => p.markPaid(order.id, 'other', now));
    assert.throws(() => p.decide(order.id, true, 'admin', now));
    p.markPaid(order.id, 'vm', now);
    p.markPaid(order.id, 'vm', now);
    p.decide(order.id, true, 'admin', now);
    assert.equal(p.hasPremium('team-b', now), true);
    assert.throws(() => p.decide(order.id, true, 'admin', now));
    assert.equal(p.readStore().subscriptions['team-b'].expiresAt, '2026-12-15T11:00:00.000Z');
    p.grant('team-b', 1, 'admin', now);
    assert.equal(p.readStore().subscriptions['team-b'].expiresAt, '2027-01-15T11:00:00.000Z');
    const rejected = p.createOrder('team-c', 'vm-c', 1, now);
    p.markPaid(rejected.id, 'vm-c', now);
    p.decide(rejected.id, false, 'admin', now);
    assert.equal(p.hasPremium('team-c', now), false);
    assert.notEqual(p.createOrder('team-c', 'vm-c', 1, now).id, rejected.id);
    assert.deepEqual(p.sortPremiumEntries([{ teamId: 'team-a' }, { teamId: 'team-b' }, { teamId: 'team-c' }], () => null, now).map(e => e.teamId), ['team-b', 'team-a', 'team-c']);
    assert.equal(p.hasPremium('team-b', new Date('2027-01-15T11:00:00Z')), false);
    p.remove('team-b', 'admin', now);
    assert.equal(p.hasPremium('team-b', now), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Premium changes participant selection before lock while a locked field stays intact', () => {
  const original = Module._load;
  const formatPath = require.resolve('../src/domain/checkins/checkin-format');
  const lockPath = require.resolve('../src/domain/events/event-format');
  const team = id => ({ id, clubName: id, status: 'active', registrationStatus: 'complete' });
  Module._load = function(request, parent, main) {
    if ([formatPath, lockPath].includes(parent?.filename)) {
      if (request === '../teams/team-service') return { findTeamById: team };
      if (request.endsWith('checkin-ban-integration')) return { findActiveBanForTeamOrManagers: () => null };
      if (request === '../premium/premium-store') return { sortPremiumEntries: entries => [...entries].sort((a,b) => Number(b.teamId === '9') - Number(a.teamId === '9')) };
      if (request === '../../storage') return { FILES: { settings: '' }, readJson: () => ({ tournament: { minimumRealTeams: 8, allowedSizes: [8,12,16,20,24,28,32] } }) };
    }
    return original.call(this, request, parent, main);
  };
  delete require.cache[formatPath]; delete require.cache[lockPath];
  let format, lock;
  try { format = require(formatPath); lock = require(lockPath); } finally { Module._load = original; delete require.cache[formatPath]; delete require.cache[lockPath]; }
  const event = { checkin: { entries: Array.from({ length: 9 }, (_,i) => ({ teamId: String(i+1) })) }, format: {}, byes: [] };
  const s = { tournament: { minimumRealTeams: 8, allowedSizes: [8,12,16,20,24,28,32] } };
  format.recalculateCheckinFormat(event, s);
  assert.deepEqual(event.checkin.activeTeamIds, ['9','1','2','3','4','5','6','7']);
  assert.deepEqual(event.checkin.waitlistTeamIds, ['8']);
  assert.deepEqual(lock.buildLockedParticipantField(event).activeTeams.map(t => t.id), event.checkin.activeTeamIds);
  event.format.lockedAt = new Date().toISOString();
  event.checkin.activeTeamIds = ['1','2','3','4','5','6','7','8'];
  event.checkin.waitlistTeamIds = ['9'];
  format.recalculateCheckinFormat(event, s);
  assert.deepEqual(event.checkin.activeTeamIds, ['1','2','3','4','5','6','7','8']);
  assert.deepEqual(event.checkin.waitlistTeamIds, ['9']);
});

test('Premium panels expose the requested actions and pagination never exceeds 25 options', () => {
  const p = require('../src/domain/premium');
  assert.equal(p.PAYPAL, 'loconightcup');
  const labels = p.panels()[0].payload.components[0].toJSON().components.map(c => c.label);
  assert.deepEqual(labels, ['Premium erhalten', 'Mein Premium']);
  const list = Array.from({ length: 51 }, (_, i) => ({ id: String(i), label: `Team ${i}`, description: 'Kein Premium' }));
  assert.equal(p.picker('grant', list, 0).components[0].toJSON().components[0].options.length, 25);
  assert.equal(p.picker('grant', list, 2).components[0].toJSON().components[0].options.length, 1);
});

test('Premium Discord flow checks membership and staff roles, and restores panels after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lnc-premium-ui-'));
  const original = Module._load;
  const uiPath = require.resolve('../src/domain/premium');
  const storePath = require.resolve('../src/domain/premium/premium-store');
  const team = { id: 'team', clubName: 'Loco', status: 'active', registrationStatus: 'complete', manager: { userId: 'vm' }, coManagers: [{ userId: 'co' }] };
  const s = { guild: { guildId: 'guild' }, roles: { adminRoleIds: ['admin-role'], cupLeadRoleIds: ['lead-role'] } };
  let messagesSent = 0, notices = [];
  const messages = new Map();
  const channel = { send: async payload => { const message = { id: String(++messagesSent), edit: async () => message, author: { id: 'bot' }, components: payload.components }; messages.set(message.id, message); return message; }, messages: { fetch: async id => typeof id === 'string' ? messages.get(id) : { find: fn => [...messages.values()].find(fn) } } };
  const client = { user: { id: 'bot' }, channels: { fetch: async () => channel }, users: { fetch: async id => ({ send: async payload => notices.push({ id, ...payload }) }) } };
  Module._load = function(request, parent, main) {
    if (parent?.filename === storePath && request === '../../storage') return { ...original.call(this, request, parent, main), DATA_DIR: dir };
    if (parent?.filename === uiPath) {
      if (request === '../../storage') return { FILES: { settings: '' }, readJson: () => s, createSettingsDefault: () => s };
      if (request === '../teams/team-repository') return { readTeamsData: () => ({ teams: [team] }) };
      if (request === '../teams/team-service') return { findTeamById: id => id === 'team' ? team : null, isTeamMember: (t,id) => ['vm','co'].includes(id) };
      if (request === '../checkins/checkin-service') return { refreshEventFormat: () => {} };
      if (request === '../checkins/checkin-repository') return { readEventData: () => ({ status: 'completed', format: {} }) };
      if (request === '../checkins/checkin-panel') return { ensureAllCheckinMessages: async () => {} };
      if (request === '../teams/team-overview') return { refreshRegisteredTeamsOverview: async () => {} };
    }
    return original.call(this, request, parent, main);
  };
  delete require.cache[uiPath]; delete require.cache[storePath];
  try {
    const ui = require(uiPath), p = require(storePath);
    const interaction = (id, user = 'vm', values = [], staff = false) => ({ customId: 'premium:' + id, guildId: 'guild', channelId: staff ? ui.ADMIN_CHANNEL : ui.PUBLIC_CHANNEL, user: { id: user }, values, member: { roles: { cache: new Map(staff ? [['lead-role',true]] : []) } }, deferReply: async () => {}, editReply: async function(payload) { this.payload = payload; } });
    await ui.init(client);
    assert.equal(messagesSent, 2);
    let i = interaction('months:get:team', 'outsider', ['1']);
    await ui.handleInteraction(i, client);
    assert.match(i.payload.content, /VM oder Co-VM/);
    assert.equal(p.readStore().orders.length, 0);
    i = interaction('months:get:team', 'vm', ['3']);
    await ui.handleInteraction(i, client);
    assert.match(i.payload.content, /15 €/);
    const order = p.readStore().orders[0];
    await ui.handleInteraction(interaction('paid:' + order.id), client);
    assert.equal(p.readStore().orders[0].status, 'paid');
    i = interaction('approve:' + order.id);
    await ui.handleInteraction(i, client);
    assert.match(i.payload.content, /nur für Admins/);
    assert.equal(p.hasPremium('team'), false);
    await ui.handleInteraction(interaction('approve:' + order.id, 'lead', [], true), client);
    assert.equal(p.hasPremium('team'), true);
    const expiry = p.readStore().subscriptions.team.expiresAt;
    i = interaction('approve:' + order.id, 'lead', [], true);
    await ui.handleInteraction(i, client);
    assert.match(i.payload.content, /nicht mehr offen/);
    assert.equal(p.readStore().subscriptions.team.expiresAt, expiry);
    assert.deepEqual(notices.map(n => n.id).sort(), ['co', 'vm']);
    i = interaction('select:mine', 'co', ['team']);
    await ui.handleInteraction(i, client);
    assert.match(i.payload.content, /Laufzeit:/);
    // Panel IDs in the persisted store are reused by a new module instance.
    delete require.cache[uiPath];
    await require(uiPath).init(client);
    assert.equal(messagesSent, 2);
  } finally { Module._load = original; delete require.cache[uiPath]; delete require.cache[storePath]; fs.rmSync(dir, { recursive: true, force: true }); }
});
