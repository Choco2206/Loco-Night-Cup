'use strict';

const { EmbedBuilder } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createBansDefault, createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');

const DEFAULT_DURATION_DAYS = 14;
const BERLIN_TIME_ZONE = 'Europe/Berlin';
const VALID_REASONS = new Set(['late_withdrawal', 'no_show', 'left_tournament', 'disrespect', 'admin_other']);

let activeClient = null;
let cleanupTimer = null;

function nowIso(now = new Date()) {
  return now.toISOString();
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function createBanId() {
  return `ban_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readBansData() {
  return readJson(FILES.bans, createBansDefault());
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function getTeamUserIds(team) {
  return uniqueStrings([
    team?.manager?.userId,
    ...(Array.isArray(team?.coManagers) ? team.coManagers.map(coManager => coManager?.userId) : []),
  ]);
}

function getManagerId(team) {
  return team?.manager?.userId ? String(team.manager.userId) : null;
}

function getCoManagerIds(team) {
  return uniqueStrings((team?.coManagers || []).map(coManager => coManager?.userId));
}

function getAffectedUsers(team) {
  const users = [];
  const managerId = getManagerId(team);
  if (managerId) users.push({ userId: managerId, role: 'manager' });
  for (const userId of getCoManagerIds(team)) users.push({ userId, role: 'co_manager' });
  return users;
}

function getBanTeamId(ban) {
  return ban?.teamId || ban?.team?.teamId || ban?.targets?.teamId || ban?.target?.teamId || null;
}

function getBanUserIds(ban) {
  return uniqueStrings([
    ban?.managerId,
    ...(Array.isArray(ban?.coManagerIds) ? ban.coManagerIds : []),
    ...(Array.isArray(ban?.affectedUsers) ? ban.affectedUsers.map(user => user?.userId) : []),
    ...(Array.isArray(ban?.targets?.userIds) ? ban.targets.userIds : []),
    ban?.targets?.managerUserId,
    ...(Array.isArray(ban?.targets?.coManagerUserIds) ? ban.targets.coManagerUserIds : []),
    ...(Array.isArray(ban?.target?.userIds) ? ban.target.userIds : []),
    ban?.target?.userId,
    ban?.userId,
  ]);
}

function isBanActive(ban, now = new Date()) {
  if (!ban || ban.status !== 'active') return false;
  const startsAt = ban.startsAt || ban.bannedAtDate || ban.createdAt;
  const expiresAt = ban.expiresAt || ban.bannedUntilDate;
  const startDate = startsAt ? new Date(startsAt) : null;
  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  if (startDate && !Number.isNaN(startDate.getTime()) && startDate.getTime() > now.getTime()) return false;
  if (expiryDate && !Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() <= now.getTime()) return false;
  return true;
}

function findActiveBanForTeamOrManagers(team, actorUserId = null, now = new Date()) {
  const teamId = team?.id ? String(team.id) : null;
  const userIds = uniqueStrings([actorUserId, ...getTeamUserIds(team)]);

  return readBansData().bans.find(ban => {
    if (!isBanActive(ban, now)) return false;
    if (teamId && String(getBanTeamId(ban)) === teamId) return true;
    const bannedUserIds = getBanUserIds(ban);
    return userIds.some(userId => bannedUserIds.includes(String(userId)));
  }) || null;
}

function isTeamOrUserBanned(input, now = new Date()) {
  if (!input) return null;
  if (typeof input === 'string') {
    return readBansData().bans.find(ban => isBanActive(ban, now) && getBanUserIds(ban).includes(String(input))) || null;
  }
  return findActiveBanForTeamOrManagers(input, null, now);
}

function normalizeBanReason(reason) {
  const raw = String(reason || '').trim();
  if (raw === 'left_tournament_no_notice') {
    return { reason: 'left_tournament', customReason: 'Gruppenphase oder K.O.-Phase ohne Abmeldung verlassen' };
  }
  if (VALID_REASONS.has(raw)) return { reason: raw, customReason: null };
  return {
    reason: 'admin_other',
    customReason: raw || null,
  };
}

function createTeamBanEntry(team, reason, bannedByUserId = null, durationDays = DEFAULT_DURATION_DAYS, now = new Date()) {
  if (!team?.id) throw new Error('Team fuer Sperre wurde nicht gefunden.');
  const timestamp = nowIso(now);
  const expiresAt = addDays(now, durationDays).toISOString();
  const managerId = getManagerId(team);
  const coManagerIds = getCoManagerIds(team);
  const affectedUsers = getAffectedUsers(team);
  const normalizedReason = normalizeBanReason(reason);

  return {
    id: createBanId(),
    status: 'active',
    reason: normalizedReason.reason,
    customReason: normalizedReason.customReason,
    durationDays: Number(durationDays || DEFAULT_DURATION_DAYS),
    teamId: String(team.id),
    clubName: team.clubName || String(team.id),
    managerId,
    coManagerIds,
    bannedAtDate: timestamp,
    bannedUntilDate: expiresAt,
    bannedByUserId: bannedByUserId ? String(bannedByUserId) : null,
    createdAt: timestamp,
    startsAt: timestamp,
    expiresAt,
    resolvedAt: null,
    resolvedByUserId: null,
    resolutionReason: null,
    createdByUserId: bannedByUserId ? String(bannedByUserId) : 'system',
    team: {
      teamId: String(team.id),
      clubNameSnapshot: team.clubName || String(team.id),
    },
    affectedUsers,
    targets: {
      teamId: String(team.id),
      managerUserId: managerId,
      coManagerUserIds: coManagerIds,
      userIds: getTeamUserIds(team),
    },
    effects: {
      blocksCheckin: true,
      blocksParticipation: true,
      removeExistingCheckins: true,
    },
  };
}

function addTeamBan(team, reason, bannedByUserId = null, durationDays = DEFAULT_DURATION_DAYS) {
  const existing = findActiveBanForTeamOrManagers(team, bannedByUserId);
  if (existing && String(getBanTeamId(existing)) === String(team?.id)) return existing;

  const ban = createTeamBanEntry(team, reason, bannedByUserId, durationDays);
  updateJson(FILES.bans, createBansDefault(), data => ({
    ...data,
    bans: [...(data.bans || []), ban],
  }));
  refreshBanlistMessage().catch(error => console.warn(`[ban-service] banlist refresh failed: ${error.message}`));
  postLogMessage(`Team **${ban.clubName}** wurde gesperrt. Grund: ${getBanReasonText(ban)} | Bis: ${formatDate(ban.bannedUntilDate || ban.expiresAt)}`).catch(() => null);
  return ban;
}

function listActiveBans(now = new Date()) {
  return readBansData().bans.filter(ban => isBanActive(ban, now));
}

function removeTeamBan(teamId, removedByUserId = null, reason = null) {
  const id = String(teamId || '');
  let removedBan = null;

  updateJson(FILES.bans, createBansDefault(), data => {
    const next = [];
    for (const ban of data.bans || []) {
      if (!removedBan && ban?.status === 'active' && String(getBanTeamId(ban)) === id) {
        removedBan = {
          ...ban,
          status: 'revoked',
          resolvedAt: nowIso(),
          resolvedByUserId: removedByUserId ? String(removedByUserId) : null,
          resolutionReason: reason || 'admin_removed',
        };
        continue;
      }
      next.push(ban);
    }
    return { ...data, bans: next };
  });

  if (removedBan) {
    refreshBanlistMessage().catch(error => console.warn(`[ban-service] banlist refresh failed: ${error.message}`));
    postLogMessage(`Sperre fuer **${removedBan.clubName || removedBan.team?.clubNameSnapshot || id}** wurde entfernt.`).catch(() => null);
  }

  return removedBan;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: BERLIN_TIME_ZONE,
  });
}

function formatReason(reason) {
  const labels = {
    late_withdrawal: 'Abmeldung nach Deadline',
    no_show: 'Eingecheckt, aber nicht erschienen',
    left_tournament: 'Turnier verlassen',
    disrespect: 'Beleidigung/Respektlosigkeit',
    admin_other: 'Sonstiger Regelverstoß',
  };
  return labels[reason] || String(reason || 'Nicht angegeben');
}

function getBanReasonText(ban) {
  return ban?.customReason || formatReason(ban?.reason);
}

function formatMentions(userIds) {
  const ids = uniqueStrings(userIds);
  return ids.length ? ids.map(userId => `<@${userId}>`).join(', ') : '-';
}

async function postLogMessage(content) {
  const settings = readSettings();
  const channelId = settings.channels?.logChannelId;
  if (!activeClient || !channelId) return false;
  const channel = await activeClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;
  await channel.send({ content, allowedMentions: { parse: ['users'] } }).catch(() => null);
  return true;
}

function buildBanInfoEmbed() {
  return new EmbedBuilder()
    .setTitle('🚫 LOCO NIGHT CUP | SPERRLISTE')
    .setColor(0xff0000)
    .setDescription([
      'Hier landen Teams, die den Turnierabend kaputt machen, nicht auftauchen oder den Ablauf unnötig bremsen.',
      '',
      '**Gründe:**',
      '- Eingecheckt, aber nicht erschienen',
      '- Während laufendem Turnierbetrieb rausgegangen',
      '- Gruppenphase oder K.O.-Phase ohne Abmeldung verlassen',
      '- Beleidigungen, Respektlosigkeit oder unsportliches Verhalten',
      '- Sonstige schwere Regelverstöße',
      '',
      '**Dauer:**',
      '- Standardsperre 14 Tage',
      '- abgelaufene Sperren automatisch entfernen',
      '- tägliche Prüfung um 00:00 Uhr',
    ].join('\n'));
}

function buildBanListContent(now = new Date()) {
  const activeBans = readBansData().bans.filter(ban => isBanActive(ban, now));
  if (!activeBans.length) {
    return '## 🔴 Aktuell gesperrte Teams\n\n✅ Aktuell sind keine Teams gesperrt.';
  }

  const blocks = activeBans.map((ban, index) => [
    `**${index + 1}. ${ban.clubName || ban.team?.clubNameSnapshot || getBanTeamId(ban) || 'Unbekanntes Team'}**`,
    `VM / Co-VM: ${formatMentions([ban.managerId, ...(ban.coManagerIds || []), ...getBanUserIds(ban)])}`,
    `Grund: ${getBanReasonText(ban)}`,
    `Sperre ab: ${formatDate(ban.bannedAtDate || ban.startsAt || ban.createdAt)}`,
    `Sperre bis: ${formatDate(ban.bannedUntilDate || ban.expiresAt)}`,
  ].join('\n'));

  return `## 🔴 Aktuell gesperrte Teams\n\n${blocks.join('\n\n')}`;
}

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function refreshBanlistMessage(client = activeClient) {
  const settings = readSettings();
  const channelId = settings.channels?.banlistChannelId;
  if (!channelId) {
    console.warn('[ban-service] settings.channels.banlistChannelId fehlt. Sperrliste kann nicht gepostet werden.');
    return false;
  }
  if (!client) {
    console.warn('[ban-service] Kein Discord-Client verfügbar. Sperrliste kann nicht gepostet werden.');
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) {
    console.warn(`[ban-service] Sperrlisten-Kanal ${channelId} nicht gefunden oder nicht beschreibbar.`);
    return false;
  }

  const messages = readJson(FILES.messages, createMessagesDefault());
  messages.banlist = messages.banlist || {
    channelId: null,
    infoMessageId: null,
    listMessageId: null,
    createdAt: null,
    updatedAt: null,
  };

  const staleChannel = messages.banlist.channelId && String(messages.banlist.channelId) !== String(channel.id);
  let infoMessage = staleChannel ? null : await fetchMessage(channel, messages.banlist.infoMessageId);
  let listMessage = staleChannel ? null : await fetchMessage(channel, messages.banlist.listMessageId);

  const infoPayload = { embeds: [buildBanInfoEmbed()] };
  const listPayload = { content: buildBanListContent(), allowedMentions: { parse: ['users'] } };

  if (infoMessage) await infoMessage.edit(infoPayload);
  else infoMessage = await channel.send(infoPayload);

  if (listMessage) await listMessage.edit(listPayload);
  else listMessage = await channel.send(listPayload);

  const timestamp = nowIso();
  updateJson(FILES.messages, createMessagesDefault(), current => {
    current.banlist = current.banlist || {};
    current.banlist.channelId = channel.id;
    current.banlist.infoMessageId = infoMessage.id;
    current.banlist.listMessageId = listMessage.id;
    current.banlist.updatedAt = timestamp;
    if (!current.banlist.createdAt) current.banlist.createdAt = timestamp;
    return current;
  });

  return true;
}

async function cleanupExpiredBans({ refresh = true } = {}) {
  const now = new Date();
  let removed = 0;

  updateJson(FILES.bans, createBansDefault(), data => {
    const bans = Array.isArray(data.bans) ? data.bans : [];
    const active = [];
    for (const ban of bans) {
      if (ban?.status === 'active' && !isBanActive(ban, now)) {
        removed += 1;
        continue;
      }
      active.push(ban);
    }
    return { ...data, bans: active };
  });

  if (removed && refresh) await refreshBanlistMessage().catch(error => {
    console.warn(`[ban-service] banlist refresh after cleanup failed: ${error.message}`);
  });

  return { removed };
}

function getBerlinTimeParts(date) {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
}

function getMsUntilNextBerlinMidnight(now = new Date()) {
  for (let minutes = 1; minutes <= 1500; minutes += 1) {
    const candidate = new Date(now.getTime() + minutes * 60 * 1000);
    const parts = getBerlinTimeParts(candidate);
    if (parts.hour === 0 && parts.minute === 0) return Math.max(1000, candidate.getTime() - now.getTime());
  }
  return 24 * 60 * 60 * 1000;
}

function scheduleDailyCleanup() {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(async () => {
    await cleanupExpiredBans().catch(error => console.warn(`[ban-service] daily cleanup failed: ${error.message}`));
    await refreshBanlistMessage().catch(error => console.warn(`[ban-service] daily refresh failed: ${error.message}`));
    scheduleDailyCleanup();
  }, getMsUntilNextBerlinMidnight());
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

async function initBanService(client) {
  activeClient = client;
  await cleanupExpiredBans({ refresh: false });
  await refreshBanlistMessage(client);
  scheduleDailyCleanup();
}

module.exports = {
  addTeamBan,
  cleanupExpiredBans,
  createTeamBanEntry,
  findActiveBanForTeamOrManagers,
  initBanService,
  isBanActive,
  isTeamOrUserBanned,
  listActiveBans,
  removeTeamBan,
  refreshBanlistMessage,
};
