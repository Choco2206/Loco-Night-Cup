'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('../teams/team-service');

const EPHEMERAL = 64;
const TARGET_CHANNEL_ID = '1542532323386327080';
const MESSAGE_LIMIT = 1900;

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
  if (!raw) return { text: 'unbekannt', days: null };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { text: 'unbekannt', days: null };
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return {
    text: date.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
    days,
  };
}

function teamsWithoutCupParticipation() {
  return listVisibleTeams()
    .filter(team => team?.status === 'active')
    .filter(team => !team?.isTestTeam)
    .filter(team => Number(team?.stats?.matches || 0) === 0)
    .sort((a, b) => String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de', { sensitivity: 'base' }));
}

function teamLine(team, index) {
  const managerId = team?.manager?.userId ? String(team.manager.userId) : null;
  const registered = registrationDate(team);
  const age = registered.days === null ? '' : ` | seit ${registered.days} Tag${registered.days === 1 ? '' : 'en'}`;
  return `${index + 1}. **${team.clubName || team.id}**${managerId ? ` — <@${managerId}>` : ''}\n   Registriert: ${registered.text}${age} | bestätigte Cup-Spiele: **0**`;
}

function buildChunks(teams) {
  if (!teams.length) {
    return ['✅ **Keine Teams ohne Cup-Teilnahme gefunden.**\nAlle aktuell aktiven Teams haben bereits mindestens ein bestätigtes Cup-Spiel.'];
  }

  const intro = [
    '🔍 **Teams ohne Cup-Teilnahme**',
    '',
    'Folgende Teams sind aktuell registriert, haben aber bisher **kein bestätigtes Spiel im Loco Night Cup** in ihren dauerhaften Team-Statistiken.',
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

async function postTeamsWithoutCupParticipation({ client, guild }) {
  const channel = await client?.channels?.fetch?.(TARGET_CHANNEL_ID).catch(() => null)
    || await guild?.channels?.fetch?.(TARGET_CHANNEL_ID).catch(() => null);
  if (!channel?.send) throw new Error(`Kanal ${TARGET_CHANNEL_ID} wurde nicht gefunden oder ist nicht beschreibbar.`);

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
      `✅ Liste wurde in <#${result.channelId}> gepostet.`,
      `Teams ohne bestätigte Cup-Teilnahme: **${result.affectedCount}**`,
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
