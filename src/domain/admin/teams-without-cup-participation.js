'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams } = require('../teams/team-service');
const { getTeamHistoryStats } = require('../teams/team-achievements');
const { handleAdminDeleteTeam } = require('./admin-interactions-restored');

const EPHEMERAL = 64;
const TARGET_CHANNEL_ID = '1542532323386327080';
const MESSAGE_LIMIT = 1900;
const MAX_CUP_PARTICIPATIONS = 5;
const DELETE_PAGE_SIZE = 25;
const DELETE_OPEN_ID = 'admin_teams_without_cup_delete_open';
const DELETE_PAGE_PREFIX = 'admin_teams_without_cup_delete_page:';
const DELETE_SELECT_PREFIX = 'admin_teams_without_cup_delete_select:';

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

function buildDeleteControl(teams) {
  return {
    content: '🗑️ **Teamverwaltung**',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(DELETE_OPEN_ID)
        .setLabel('Team löschen')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!teams.length)
    )],
  };
}

function buildDeleteSelectionPayload(page = 0) {
  const teams = teamsWithoutCupParticipation();
  if (!teams.length) {
    return { content: 'Aktuell steht kein Team mehr in dieser Liste.', components: [] };
  }

  const totalPages = Math.max(1, Math.ceil(teams.length / DELETE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const start = currentPage * DELETE_PAGE_SIZE;
  const visibleTeams = teams.slice(start, start + DELETE_PAGE_SIZE);
  const rows = [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${DELETE_SELECT_PREFIX}${currentPage}`)
      .setPlaceholder('Team zum Löschen auswählen')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(visibleTeams.map((team, index) => {
        const stats = participationStats(team);
        return {
          label: String(team.clubName || 'Unbekanntes Team').slice(0, 100),
          value: String(team.id),
          description: `Platz ${start + index + 1} · Cups ${stats.cupsPlayed} · Spiele ${stats.matchesPlayed}`.slice(0, 100),
        };
      }))
  )];

  if (totalPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DELETE_PAGE_PREFIX}${currentPage - 1}`)
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`${DELETE_PAGE_PREFIX}${currentPage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages - 1)
    ));
  }

  return {
    content: [
      '**Team löschen**',
      'Die Teams stehen in derselben Reihenfolge wie im Bericht. Mit der Auswahl wird das Team direkt gelöscht.',
      totalPages > 1 ? `Seite ${currentPage + 1}/${totalPages}` : null,
    ].filter(Boolean).join('\n'),
    components: rows,
  };
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
  const controlMessage = await channel.send(buildDeleteControl(teams));
  messageIds.push(String(controlMessage.id));
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
  const customId = interaction.customId || '';
  const isDeleteOpen = interaction.isButton?.() && customId === DELETE_OPEN_ID;
  const isDeletePage = interaction.isButton?.() && customId.startsWith(DELETE_PAGE_PREFIX);
  const isDeleteSelect = interaction.isStringSelectMenu?.() && customId.startsWith(DELETE_SELECT_PREFIX);
  if (selectedAction !== 'admin_teams_without_cup' && !isDeleteOpen && !isDeletePage && !isDeleteSelect) return false;

  try {
    await requireAdmin(interaction);

    if (isDeleteOpen) {
      await interaction.reply({ ...buildDeleteSelectionPayload(0), flags: EPHEMERAL });
      return true;
    }

    if (isDeletePage) {
      const page = customId.slice(DELETE_PAGE_PREFIX.length);
      await interaction.update(buildDeleteSelectionPayload(page));
      return true;
    }

    if (isDeleteSelect) {
      const teamId = interaction.values?.[0];
      const listedTeam = teamsWithoutCupParticipation().find(team => String(team.id) === String(teamId));
      if (!listedTeam) throw new Error('Dieses Team steht nicht mehr in der aktuellen Liste. Bitte die Auswahl neu öffnen.');

      await interaction.deferUpdate();
      const settings = readSettings();
      const result = await handleAdminDeleteTeam({ interaction, client, settings, teamId });
      const report = await postTeamsWithoutCupParticipation({ client, guild: interaction.guild });
      await interaction.editReply({
        content: [
          `✅ Team **${result.team.clubName}** wurde gelöscht.`,
          'VM und Co-VMs haben wieder die Spielerrolle erhalten.',
          `Die Liste wurde aktualisiert. Verbleibende Teams: **${report.affectedCount}**`,
        ].join('\n'),
        components: [],
      });
      return true;
    }

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
  buildDeleteSelectionPayload,
  handleTeamsWithoutCupParticipationInteraction,
  postTeamsWithoutCupParticipation,
  teamsWithoutCupParticipation,
};
