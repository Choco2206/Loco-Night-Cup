'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('../teams/team-service');

const MANAGERS_WITHOUT_TEAM_CHANNEL_ID = '1521071200808206356';
const DISCORD_MESSAGE_LIMIT = 2000;

function nowIso() {
  return new Date().toISOString();
}

function getManagerRoleId(settings) {
  return settings.roles?.managerRoleId ? String(settings.roles.managerRoleId) : null;
}

function getAssignedTeamUserIds() {
  const userIds = new Set();

  for (const team of listVisibleTeams()) {
    if (team.status !== 'active') continue;

    if (team.manager?.userId) userIds.add(String(team.manager.userId));

    for (const coManager of team.coManagers || []) {
      if (coManager?.userId) userIds.add(String(coManager.userId));
    }
  }

  return userIds;
}

async function fetchManagerMembers(guild, managerRoleId) {
  if (!guild || !managerRoleId) throw new Error('Manager-Rolle ist nicht konfiguriert.');

  await guild.members.fetch();
  return [...guild.members.cache.values()]
    .filter(member => !member.user?.bot)
    .filter(member => member.roles?.cache?.has(managerRoleId))
    .sort((a, b) => {
      const left = a.displayName || a.user?.username || a.id;
      const right = b.displayName || b.user?.username || b.id;
      return left.localeCompare(right, 'de', { sensitivity: 'base' });
    });
}

async function collectManagersWithoutTeam(guild, settings = readJson(FILES.settings, createSettingsDefault())) {
  const managerRoleId = getManagerRoleId(settings);
  const members = await fetchManagerMembers(guild, managerRoleId);
  const assignedTeamUserIds = getAssignedTeamUserIds();
  return members.filter(member => !assignedTeamUserIds.has(String(member.id)));
}

function createMessageChunks(members) {
  if (!members.length) {
    return [
      [
        '✅ **Alles sauber!**',
        '',
        'Aktuell haben alle Manager entweder ein eigenes Team oder sind als Co-VM bei einem Team eingetragen.',
      ].join('\n'),
    ];
  }

  const intro = [
    '🚨 **Manager ohne Team gefunden** 🚨',
    '',
    'Folgende User haben die **Manager-Rolle**, sind aber aktuell in **keinem Team** als VM oder Co-VM eingetragen.',
    '',
    'Die Manager-Rolle ist dafür da, ein Team zu registrieren oder als Co-VM bei einem Team mitzuwirken.',
    'Wenn du aktuell kein Team hast, registriere bitte ein Team oder kläre deine Rolle mit der Turnierleitung.',
    '',
    '👀 **Betroffene Manager:**',
    '',
  ].join('\n');
  const footer = [
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '✅ Sobald ein betroffener Manager ein Team registriert oder als Co-VM eingetragen wird, wird diese Liste automatisch aktualisiert.',
  ].join('\n');

  const chunks = [];
  let current = intro;

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const line = `${index + 1}. <@${member.id}>`;
    const next = `${current}\n${line}`;

    if (`${next}${footer}`.length > DISCORD_MESSAGE_LIMIT && current !== intro) {
      chunks.push(`${current}${footer}`);
      current = ['👀 **Betroffene Manager (Fortsetzung):**', '', line].join('\n');
    } else {
      current = next;
    }
  }

  if (current) chunks.push(`${current}${footer}`);
  return chunks;
}

async function fetchChannel(client, guild) {
  const fromClient = client?.channels?.fetch
    ? await client.channels.fetch(MANAGERS_WITHOUT_TEAM_CHANNEL_ID).catch(() => null)
    : null;
  const fromGuild = !fromClient && guild?.channels?.fetch
    ? await guild.channels.fetch(MANAGERS_WITHOUT_TEAM_CHANNEL_ID).catch(() => null)
    : null;
  const channel = fromClient || fromGuild || guild?.channels?.cache?.get?.(MANAGERS_WITHOUT_TEAM_CHANNEL_ID) || null;

  if (!channel?.send || !channel?.messages?.fetch) {
    throw new Error(`Manager-ohne-Team-Kanal ${MANAGERS_WITHOUT_TEAM_CHANNEL_ID} wurde nicht gefunden oder ist nicht beschreibbar.`);
  }

  return channel;
}

async function upsertMessage(channel, messageId, content) {
  const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  const payload = {
    content,
    allowedMentions: { users: [...content.matchAll(/<@(\d+)>/g)].map(match => match[1]) },
  };
  if (existing) return existing.edit(payload);
  return channel.send(payload);
}

async function deleteMessage(channel, messageId) {
  if (!messageId) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  await message.delete().catch(() => {});
  return true;
}

function readState() {
  const messages = readJson(FILES.messages, createMessagesDefault());
  return messages.admin?.managersWithoutTeam || { channelId: null, messageIds: [] };
}

function writeState(messageIds) {
  const timestamp = nowIso();
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    messages.admin = messages.admin || {};
    const current = messages.admin.managersWithoutTeam || {};
    messages.admin.managersWithoutTeam = {
      channelId: MANAGERS_WITHOUT_TEAM_CHANNEL_ID,
      messageIds,
      createdAt: current.createdAt || timestamp,
      updatedAt: timestamp,
    };
    return messages;
  });
}

async function refreshManagersWithoutTeamMessage({ client, guild, force = false }) {
  const state = readState();
  const knownMessageIds = Array.isArray(state.messageIds) ? state.messageIds.filter(Boolean).map(String) : [];
  if (!force && !knownMessageIds.length) return { skipped: true, affectedCount: null, messageIds: [] };

  const settings = readJson(FILES.settings, createSettingsDefault());
  const targetGuild = guild || client?.guilds?.cache?.first?.() || null;
  if (!targetGuild) throw new Error('Server konnte nicht gefunden werden.');

  const channel = await fetchChannel(client, targetGuild);
  const members = await collectManagersWithoutTeam(targetGuild, settings);
  const chunks = createMessageChunks(members);
  const nextMessageIds = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const message = await upsertMessage(channel, knownMessageIds[index], chunks[index]);
    nextMessageIds.push(String(message.id));
  }

  for (const staleMessageId of knownMessageIds.slice(chunks.length)) {
    await deleteMessage(channel, staleMessageId);
  }

  writeState(nextMessageIds);
  return {
    skipped: false,
    affectedCount: members.length,
    messageIds: nextMessageIds,
  };
}

async function refreshManagersWithoutTeamMessageIfTracked({ client, guild }) {
  return refreshManagersWithoutTeamMessage({ client, guild, force: false }).catch(error => {
    console.warn(`[admin] Manager-ohne-Team-Liste konnte nicht aktualisiert werden: ${error.message}`);
    return { skipped: true, error };
  });
}

module.exports = {
  MANAGERS_WITHOUT_TEAM_CHANNEL_ID,
  collectManagersWithoutTeam,
  createMessageChunks,
  refreshManagersWithoutTeamMessage,
  refreshManagersWithoutTeamMessageIfTracked,
};
