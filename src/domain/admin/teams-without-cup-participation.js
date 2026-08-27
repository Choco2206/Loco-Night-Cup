'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('../teams/team-service');
const { getTeamHistoryStats } = require('../teams/team-achievements');

const EPHEMERAL = 64;
const TARGET_CHANNEL_ID = '1542532323386327080';
const MESSAGE_LIMIT = 1900;
const MAX_CUP_PARTICIPATIONS = 5;

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function hasAnyRole(member, roleIds) {
  return roleIds.filter(Boolean).some(roleId => member.roles.cache.has(String(roleId)));
}

async function requireAdmin(interaction) {
  const settings = readSettings();
  const roleIds = [
    ...(settings.roles?.adminRoleIds || []),
    ...(settings.roles?.cupLeadRoleIds || []),
    ...(settings.permissions?.adminRoleIds || []),
    ...(settings.permissions?.cupLeadRoleIds || []),
  ];
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => interaction.member);
  if (!member || !hasAnyRole(member, [...new Set(roleIds.map(String))])) {
    throw new Error('Du darfst dieses Admin-Panel nicht verwenden.');
  }
}

function registrationDate(team) {
  const raw = team?.meta?.createdAt;
  if (!raw) return { text: 'unbekannt', days: null, timestamp: Number.POSITIVE_INFINITY };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { text: 'unbekannt', days: null, timestamp: Number.POSITIVE_INFINITY };
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return {
    text: date.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
    days,
    timestamp: date.getTime(),
  };
}

function participationStats(team) {
  const historyStats = getTeamHistoryStats(team);
  return {
    cupsPlayed: Number(historyStats.cupsPlayed || 0),
    matchesPlayed: Number(historyStats.matches?.played || 0),
  };
}

function teamsWithoutCupParticipation() {
  return listVisibleTeams()
    .filter(team => team?.status === 'active')
    .filter(team => !team?.isTestTeam)
    .filter(team => participationStats(team).cupsPlayed <= MAX_CUP_PARTICIPATIONS)
    .sort((a, b) => {
      const aRegistration = registrationDate(a);
      const bRegistration = registrationDate(b);
      if (aRegistration.timestamp !== bRegistration.timestamp) {
        return aRegistration.timestamp - bRegistration.timestamp;
      }
      const aStats = participationStats(a);
      const bStats = participationStats(b);
      if (aStats.cupsPlayed !== bStats.cupsPlayed) return aStats.cupsPlayed - bStats.cupsPlayed;
      return String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de', { sensitivity: 'base' });
    });
}

function teamLine(team, index) {
  const managerId = team?.manager?.userId ? String(team.manager.userId) : null;
  const registered = registrationDate(team);
  const stats = participationStats(team);
  const age = registered.days === null ? '' : ` | seit **${registered.days} Tag${registered.days === 1 ? '' : 'en'}**`;
  return `${index + 1}. **${team.clubName || team.id}**${managerId ? ` — <@${managerId}>` : ''}\n   Registriert: ${registered.text}${age} | Cups: **${stats.cupsPlayed}** | Spiele: **${stats.matchesPlayed}**`;
}

function buildChunks(teams) {
  if (!teams.length) {
    return [`✅ **Keine Teams mit höchstens ${MAX_CUP_PARTICIPATIONS} Cup-Teilnahmen gefunden.**`];
  }

  const intro = [
    '🔍 **Teams ohne Cup-Teilnahme**',
    '',
    `Aufgeführt werden aktive Teams mit **maximal ${MAX_CUP_PARTICIPATIONS} bisherigen Cup-Teilnahmen**. Die am längsten registrierten Teams stehen ganz oben.`,
    '',
    'Die Liste dient nur zur Kontrolle. Es wird **nichts automatisch gelöscht**.',
    '',
    '👀 **Betroffene Teams:**',
    '',
  ].join('\n');
  const continuation = '👀 **Betroffene Teams (Fortsetzung):**\n\n';
  const chunks = [];
  let current = intro;

  teams.forEach((team, index) => {
    const line = teamLine(team, index);
    const next = `${current}${current.endsWith('\n') ? '' : '\n\n'}${line}`;
    if (next.length > MESSAGE_LIMIT) {
      chunks.push(current);
      current = `${continuation}${line}`;
    } else {
      current = next;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

async function clearPreviousReportMessages(channel) {
  let before;
  let deleted = 0;
  do {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    const ownMessages = batch.filter(message => message.author?.id === channel.client.user?.id);
    for (const message of ownMessages.values()) {
      await message.delete().catch(() => null);
      deleted += 1;
    }
    before = batch.last()?.id;
    if (batch.size < 100) break;
  } while (before);
  return deleted;
}

async function postTeamsWithoutCupParticipation({ client, guild }) {
  const channel = await client?.channels?.fetch?.(TARGET_CHANNEL_ID).catch(() => null)
    || await guild?.channels?.fetch?.(TARGET_CHANNEL_ID).catch(() => null);
  if (!channel?.send) throw new Error(`Kanal ${TARGET_CHANNEL_ID} wurde nicht gefunden oder ist nicht beschreibbar.`);

  await clearPreviousReportMessages(channel);

  const teams = teamsWithoutCupParticipation();
  const chunks = buildChunks(teams);
  const messageIds = [];
  for (const content of chunks) {
    const mentions = [...content.matchAll(/<@(\d+)>/g)].map(match => match[1]);
    const message = await channel.send({ content, allowedMentions: { users: mentions } });
    messageIds.push(String(message.id));
  }
  return { affectedCount: teams.length, messageIds, channelId: TARGET_CHANNEL_ID };
}

async function handleTeamsWithoutCupParticipationInteraction(interaction, client) {
  const selectedAction = interaction.isStringSelectMenu?.()
    && interaction.customId === 'admin_panel_action_select'
    ? interaction.values?.[0]
    : null;
  if (selectedAction !== 'admin_teams_without_cup') return false;

  try {
    await requireAdmin(interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await postTeamsWithoutCupParticipation({ client, guild: interaction.guild });
    await interaction.editReply([
      `✅ Liste in <#${result.channelId}> wurde aktualisiert.`,
      `Teams mit höchstens ${MAX_CUP_PARTICIPATIONS} Cup-Teilnahmen: **${result.affectedCount}**`,
      `Nachrichten: **${result.messageIds.length}**`,
    ].join('\n'));
  } catch (error) {
    const content = `❌ Abfrage fehlgeschlagen: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => null);
    else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => null);
  }
  return true;
}

module.exports = {
  handleTeamsWithoutCupParticipationInteraction,
  postTeamsWithoutCupParticipation,
  teamsWithoutCupParticipation,
};
