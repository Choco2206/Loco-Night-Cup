'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { listVisibleTeams, findTeamById } = require('../teams/team-service');
const { getFriendlyMatches } = require('../team-of-the-tournament/ea-clubs-client');

const EPHEMERAL = 64;
const PAGE_SIZE = 25;
const TEST_CHANNEL_ID = '1525035287971889173';

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
  return settings;
}

function linkedTeams() {
  return listVisibleTeams()
    .filter(team => team?.eaClub?.clubId)
    .sort((a, b) => String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de', { sensitivity: 'base' }));
}

function teamSelectPayload(page = 0) {
  const teams = linkedTeams();
  if (!teams.length) throw new Error('Es gibt aktuell kein registriertes Team mit hinterlegter EA Club-ID.');
  const pageCount = Math.max(1, Math.ceil(teams.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
  const slice = teams.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_ea_stats_team_select:${safePage}`)
        .setPlaceholder('Team für EA-Test auswählen')
        .addOptions(slice.map(team => ({
          label: String(team.clubName || team.id).slice(0, 100),
          value: String(team.id),
          description: `EA Club-ID: ${team.eaClub.clubId}`.slice(0, 100),
        })))
    ),
  ];
  if (pageCount > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_ea_stats_page:${safePage - 1}`)
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`admin_ea_stats_page:${safePage + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pageCount - 1)
    ));
  }
  return {
    content: `🧪 **EA-Statistik testen**\nWähle ein Team mit hinterlegter EA Club-ID aus. Seite ${safePage + 1}/${pageCount}.`,
    embeds: [],
    components: rows,
  };
}

function clubMap(match) {
  return match?.clubs || match?.teams || {};
}

function selectedClubEntry(match, clubId) {
  return Object.entries(clubMap(match)).find(([key, club]) => (
    String(key) === String(clubId)
    || String(club?.clubId ?? club?.club_id ?? '') === String(clubId)
  )) || null;
}

function clubName(club, fallback = 'Unbekannter Club') {
  return String(club?.name ?? club?.clubName ?? club?.club_name ?? fallback);
}

function goals(club) {
  const value = Number(club?.goals ?? club?.score ?? club?.goalsFor);
  return Number.isFinite(value) ? value : '?';
}

function matchId(match) {
  return String(match?.matchId ?? match?.match_id ?? match?.id ?? 'unbekannt');
}

function matchTime(match) {
  const raw = match?.timestamp ?? match?.matchTimestamp ?? match?.match_timestamp ?? match?.date;
  if (raw === null || raw === undefined || raw === '') return 'unbekannt';
  let date;
  if (/^\d+$/.test(String(raw))) {
    const number = Number(raw);
    date = new Date(number < 100000000000 ? number * 1000 : number);
  } else {
    date = new Date(raw);
  }
  return Number.isNaN(date.getTime()) ? String(raw) : date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
}

function playersForClub(match, clubKey, clubId) {
  const players = match?.players || {};
  const direct = players?.[clubKey] || players?.[String(clubId)] || null;
  if (direct && typeof direct === 'object') return Object.entries(direct);
  for (const [key, values] of Object.entries(players)) {
    const club = clubMap(match)?.[key];
    const linkedId = String(club?.clubId ?? club?.club_id ?? key);
    if (linkedId === String(clubId) && values && typeof values === 'object') return Object.entries(values);
  }
  return [];
}

function playerRating([, player]) {
  const value = Number(player?.rating);
  return Number.isFinite(value) ? value : -1;
}

function rankPlayers(players) {
  return players.slice().sort((a, b) => (
    playerRating(b) - playerRating(a)
    || (Number(b[1]?.goals) || 0) - (Number(a[1]?.goals) || 0)
    || (Number(b[1]?.assists) || 0) - (Number(a[1]?.assists) || 0)
    || String(a[1]?.playername ?? a[1]?.playerName ?? a[1]?.name ?? a[0]).localeCompare(
      String(b[1]?.playername ?? b[1]?.playerName ?? b[1]?.name ?? b[0]),
      'de',
      { sensitivity: 'base' }
    )
  ));
}

function playerLine([playerId, player], index) {
  const name = player?.playername ?? player?.playerName ?? player?.name ?? playerId;
  const rating = player?.rating ?? '-';
  const position = player?.pos ?? player?.position ?? '-';
  const goalsValue = Number(player?.goals) || 0;
  const assists = Number(player?.assists) || 0;
  const saves = Number(player?.saves ?? player?.gkSaves) || 0;
  const rank = index + 1;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
  return `${medal} **${String(name).slice(0, 35)}** | ${position} | ⭐ ${rating} | ⚽ ${goalsValue} | 🎯 ${assists}${saves ? ` | 🧤 ${saves}` : ''}`;
}

function matchEmbed(match, team, index) {
  const clubs = Object.entries(clubMap(match));
  const selected = selectedClubEntry(match, team.eaClub.clubId);
  const selectedKey = selected?.[0] || String(team.eaClub.clubId);
  const selectedData = selected?.[1] || {};
  const opponent = clubs.find(([key]) => String(key) !== String(selectedKey));
  const opponentData = opponent?.[1] || {};
  const selectedPlayers = playersForClub(match, selectedKey, team.eaClub.clubId);
  const rankedPlayers = rankPlayers(selectedPlayers);
  const lines = rankedPlayers.map(playerLine);
  const playerText = lines.length ? lines.join('\n').slice(0, 3900) : '⚠️ Keine Spielerstatistiken für diesen Club im Match-Datensatz gefunden.';
  return new EmbedBuilder()
    .setTitle(`Spiel ${index + 1}: ${clubName(selectedData, team.clubName)} ${goals(selectedData)}:${goals(opponentData)} ${clubName(opponentData)}`)
    .setDescription(playerText)
    .addFields(
      { name: 'EA Match-ID', value: matchId(match), inline: true },
      { name: 'Zeitpunkt', value: matchTime(match), inline: true },
      { name: 'Spieler gefunden', value: String(selectedPlayers.length), inline: true }
    )
    .setColor(selectedPlayers.length ? 0x2ecc71 : 0xf39c12);
}

async function runEaStatsTest({ interaction, client, teamId }) {
  const settings = readSettings();
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') throw new Error('Team wurde nicht gefunden.');
  if (!team.eaClub?.clubId) throw new Error(`Für **${team.clubName}** ist keine EA Club-ID hinterlegt.`);

  const started = Date.now();
  const matches = await getFriendlyMatches(team.eaClub.clubId, team.eaClub.platform, 5);
  const durationMs = Date.now() - started;
  const channelId = settings.channels?.teamOfTheTournamentTestChannelId || TEST_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error(`EA-Testkanal ${channelId} wurde nicht gefunden oder ist nicht beschreibbar.`);

  const header = new EmbedBuilder()
    .setTitle('🧪 EA-STATISTIK TEST')
    .setDescription([
      `**Team:** ${team.clubName}`,
      `**EA Club-ID:** ${team.eaClub.clubId}`,
      `**Plattform:** ${team.eaClub.platform || 'common-gen5'}`,
      `**EA-Verbindung:** ${matches.length ? '✅ Antwort erhalten' : '⚠️ Antwort erhalten, aber keine Friendly Matches gefunden'}`,
      `**Antwortzeit:** ${(durationMs / 1000).toFixed(2).replace('.', ',')} Sekunden`,
      `**Friendly Matches erhalten:** ${matches.length}`,
      '',
      'Unten siehst du die letzten bis zu fünf von EA gelieferten Spiele. Die Spieler sind je Match nach EA-Rating gerankt.',
    ].join('\n'))
    .setColor(matches.length ? 0x2ecc71 : 0xf39c12)
    .setTimestamp();

  await channel.send({ embeds: [header], allowedMentions: { parse: [] } });
  for (const [index, match] of matches.slice(0, 5).entries()) {
    await channel.send({ embeds: [matchEmbed(match, team, index)], allowedMentions: { parse: [] } });
  }

  return { channelId, matchCount: matches.length, durationMs };
}

async function handleEaStatsTestInteraction(interaction, client) {
  const selectedAction = interaction.isStringSelectMenu?.()
    && interaction.customId === 'admin_panel_action_select'
    ? interaction.values?.[0]
    : null;
  const action = selectedAction || interaction.customId || '';
  const relevant = action === 'admin_ea_stats_test'
    || action.startsWith('admin_ea_stats_page:')
    || action.startsWith('admin_ea_stats_team_select:');
  if (!relevant) return false;

  try {
    await requireAdmin(interaction);

    if (action === 'admin_ea_stats_test') {
      await interaction.reply({ ...teamSelectPayload(0), flags: EPHEMERAL });
      return true;
    }

    if (action.startsWith('admin_ea_stats_page:')) {
      const page = Number(action.split(':')[1]) || 0;
      await interaction.update(teamSelectPayload(page));
      return true;
    }

    if (action.startsWith('admin_ea_stats_team_select:')) {
      const teamId = interaction.values?.[0];
      await interaction.deferUpdate();
      const result = await runEaStatsTest({ interaction, client, teamId });
      await interaction.editReply({
        content: `✅ EA-Test abgeschlossen. ${result.matchCount} Friendly Match${result.matchCount === 1 ? '' : 'es'} wurden in <#${result.channelId}> gepostet.`,
        embeds: [],
        components: [],
      });
      return true;
    }
  } catch (error) {
    const content = `❌ EA-Statistik-Test fehlgeschlagen: ${error.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => null);
    else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => null);
    return true;
  }

  return false;
}

module.exports = { handleEaStatsTestInteraction, runEaStatsTest, teamSelectPayload };
