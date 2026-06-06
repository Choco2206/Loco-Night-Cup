const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const teamSystem = require('./team-system');
const checkinSystem = require('./checkin-system');
const { sendTournamentCeremonyIfReady } = require('./announcement');
const { generateCeremonyImage } = require('./ceremony-image');

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');
const ADMIN_FILE = path.join(process.cwd(), 'data', 'admin-system.json');
const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');
const RESULTS_FILE = path.join(process.cwd(), 'data', 'results.json');
const KO_FILE = path.join(process.cwd(), 'data', 'ko.json');

const MANAGERS_WITHOUT_TEAM_CHANNEL_ID = '1487537056245616802';
const TEAM_REGISTER_CHANNEL_ID = '1487537568751816764';

let clientRef = null;

// =========================
// FILE HELPERS
// =========================

function ensureFile(filePath, fallback) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  ensureFile(filePath, fallback);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`❌ Fehler beim Lesen von ${filePath}:`, error);
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben von ${filePath}:`, error);
  }
}

function loadTeams() {
  return readJson(TEAMS_FILE, []);
}

function saveTeams(data) {
  writeJson(TEAMS_FILE, data);
}

function loadAdminState() {
  return readJson(ADMIN_FILE, {
    liveControlPanelMessageId: null,
  });
}

function saveAdminState(data) {
  writeJson(ADMIN_FILE, data);
}

function loadCheckins() {
  return readJson(CHECKINS_FILE, { friday: null, saturday: null });
}

function saveCheckins(data) {
  writeJson(CHECKINS_FILE, data);
}

function loadGroups() {
  return readJson(GROUPS_FILE, { friday: null, saturday: null });
}

function saveGroups(data) {
  writeJson(GROUPS_FILE, data);
}

function loadResults() {
  return readJson(RESULTS_FILE, { friday: null, saturday: null });
}

function saveResults(data) {
  writeJson(RESULTS_FILE, data);
}

function loadKo() {
  return readJson(KO_FILE, { friday: null, saturday: null });
}

function saveKo(data) {
  writeJson(KO_FILE, data);
}

// =========================
// HELPERS
// =========================

function isAdminMember(member) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (!adminRoleId) return false;
  return member?.roles?.cache?.has(adminRoleId) || false;
}

async function fetchChannel(channelId) {
  try {
    return await clientRef.channels.fetch(channelId);
  } catch (error) {
    console.error(`❌ Kanal konnte nicht geladen werden: ${channelId}`, error);
    return null;
  }
}

async function fetchMessage(channel, messageId) {
  try {
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

function requireAdmin(interaction) {
  if (!isAdminMember(interaction.member)) {
    return interaction.reply({
      content: '❌ Nur NightCup Admins dürfen dieses Panel nutzen.',
      flags: MessageFlags.Ephemeral,
    });
  }

  return null;
}

async function refreshRegisteredTeamsSafe(guild) {
  try {
    if (teamSystem.refreshRegisteredTeams) {
      await teamSystem.refreshRegisteredTeams(guild);
    }
  } catch (error) {
    console.error('❌ Registrierte Teams konnten nicht refreshed werden:', error);
  }
}

async function logToChannel(channelId, text) {
  if (!channelId) return;

  const channel = await fetchChannel(channelId);
  if (!channel) return;

  try {
    await channel.send({
      content: `[${new Date().toLocaleString('de-DE')}] ${text}`,
    });
  } catch (error) {
    console.error('❌ Fehler beim Schreiben in Logs:', error);
  }
}

async function logToLive(text) {
  await logToChannel(process.env.LIVE_LOGS_CHANNEL_ID, text);
}

async function sendTestCeremony(interaction) {
  const channel = await fetchChannel(process.env.ANNOUNCEMENT_CHANNEL_ID);

  if (!channel) {
    throw new Error('Ankündigungskanal nicht gefunden. Prüfe ANNOUNCEMENT_CHANNEL_ID.');
  }

  const imagePath = await generateCeremonyImage({
    eventKey: 'friday',
    eventLabel: 'TEST CUP',
    first: { clubName: 'Loco United' },
    second: { clubName: 'Night Kings' },
    third: { clubName: 'Red Wolves' },
    firstLogoPath: null,
    secondLogoPath: null,
    thirdLogoPath: null,
  });

  const attachment = new AttachmentBuilder(imagePath, {
    name: 'test-siegerehrung.png',
  });

  await channel.send({
    content: '🧪 **Test-Siegerehrung**',
    files: [attachment],
  });
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

function chunkArray(arr, size) {
  const result = [];

  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }

  return result;
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.clubName.localeCompare(b.clubName, 'de');
  });
}

async function replyTemp(interaction, payload) {
  await interaction.reply({
    ...payload,
    flags: MessageFlags.Ephemeral,
  }).catch(async () => {
    await interaction.followUp({
      ...payload,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  });
}

function formatUserMention(userId) {
  const id = String(userId || '').trim();
  return id ? `<@${id}>` : '—';
}

function getTeamKey(team) {
  return String(team.teamId || team.id);
}

function normalizeIncomingTeamForGroup(team) {
  return {
    teamId: team.teamId || team.id,
    clubName: team.clubName,
    managerId: team.managerId || null,
    coManagerIds: Array.isArray(team.coManagerIds) ? team.coManagerIds : [],
    isByeTeam: !!team.isByeTeam,
  };
}

function getTeamUserIds(team) {
  return [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ].filter(Boolean);
}

function buildGroupPingMessage(groupLetter, teams) {
  const lines = teams.map(team => {
    const mentions = getTeamUserIds(team)
      .map(id => `<@${id}>`)
      .join(' ');

    return `• **${team.clubName}** ${mentions ? `— ${mentions}` : ''}`;
  });

  return [
    `📣 **Ihr seid in Gruppe ${groupLetter}**`,
    '',
    `Folgende Teams sind in Gruppe ${groupLetter}:`,
    ...lines,
  ].join('\n');
}
function getRoleIdForGroupLetter(letter) {
  return process.env[`GROUP_${letter}_ROLE_ID`] || null;
}

async function getMainGuild() {
  const guildId = process.env.GUILD_ID;

  if (guildId) {
    const guildFromCache = clientRef.guilds.cache.get(guildId);
    if (guildFromCache) return guildFromCache;

    try {
      return await clientRef.guilds.fetch(guildId);
    } catch {
      return null;
    }
  }

  return clientRef.guilds.cache.first() || null;
}

async function removeGroupRoleFromTeam(groupLetter, team) {
  const roleId = getRoleIdForGroupLetter(groupLetter);
  if (!roleId) return;

  const guild = await getMainGuild();
  if (!guild) return;

  const userIds = getTeamUserIds(team);

  for (const userId of userIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (!member) continue;

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
      }
    } catch (error) {
      console.warn(`⚠️ Gruppenrolle konnte nicht entfernt werden: ${userId}`);
    }
  }
}

async function addGroupRoleToTeam(groupLetter, team) {
  const roleId = getRoleIdForGroupLetter(groupLetter);
  if (!roleId) return;

  const guild = await getMainGuild();
  if (!guild) return;

  const userIds = getTeamUserIds(team);

  for (const userId of userIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (!member) continue;

      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
      }
    } catch (error) {
      console.warn(`⚠️ Gruppenrolle konnte nicht vergeben werden: ${userId}`);
    }
  }
}

async function swapGroupRoles(groupLetter, outgoingTeam, incomingTeam) {
  if (!groupLetter) return;

  await removeGroupRoleFromTeam(groupLetter, outgoingTeam);
  await addGroupRoleToTeam(groupLetter, incomingTeam);
}

// =========================
// LIVE PANEL
// =========================

function buildLiveControlEmbed() {
  return new EmbedBuilder()
    .setTitle('🤖 Live Bot Steuerung')
    .setDescription(
      [
        '**Live Admin-Aktionen:**',
        '',
        '• Teams anzeigen',
        '• Teamdetails ansehen',
        '• Team bearbeiten',
        '• Registriertes Team löschen per Auswahl',
        '• Backup / Team nachrücken',
        '• Gruppenergebnis manuell setzen',
        '• K.O.-Ergebnis manuell setzen',
        '• Manager ohne Team anzeigen',
        '• Freilos-Team hinzufügen',
'• Freilos-Team entfernen',
'• Ceremony-Testbild posten',
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildLiveControlRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('live_show_teams')
      .setLabel('📋 Teams anzeigen')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('live_team_details')
      .setLabel('🔎 Teamdetails')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('live_edit_team')
      .setLabel('✏️ Team bearbeiten')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('live_delete_team')
      .setLabel('🗑️ Team löschen')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('live_manual_backup')
      .setLabel('🔁 Nachrücken')
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('live_manual_group_result')
      .setLabel('🏆 Gruppenergebnis')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('live_manual_ko_result')
      .setLabel('🏁 K.O.-Ergebnis')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('live_managers_without_team')
      .setLabel('👥 Manager ohne Team')
      .setStyle(ButtonStyle.Secondary)
  );

const row4 = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('live_add_bye_team')
    .setLabel('🎟️ Freilos hinzufügen')
    .setStyle(ButtonStyle.Success),

  new ButtonBuilder()
    .setCustomId('live_remove_bye_team')
    .setLabel('🚫 Freilos entfernen')
    .setStyle(ButtonStyle.Danger),

  new ButtonBuilder()
    .setCustomId('live_test_ceremony')
    .setLabel('🧪 Ceremony Test')
    .setStyle(ButtonStyle.Secondary)
);

  return [row1, row2, row3, row4];
}

async function ensureLiveControlPanel() {
  const channelId = process.env.LIVE_CONTROL_CHANNEL_ID;
  if (!channelId) return;

  const channel = await fetchChannel(channelId);
  if (!channel) return;

  const adminState = loadAdminState();

  let message = null;
  if (adminState.liveControlPanelMessageId) {
    message = await fetchMessage(channel, adminState.liveControlPanelMessageId);
  }

  if (!message) {
    const created = await channel.send({
      embeds: [buildLiveControlEmbed()],
      components: buildLiveControlRows(),
    });

    adminState.liveControlPanelMessageId = created.id;
    saveAdminState(adminState);
    return;
  }

  await message.edit({
    embeds: [buildLiveControlEmbed()],
    components: buildLiveControlRows(),
  });
}

// =========================
// RENDER HELPERS
// =========================

function buildTableText(rows) {
  const sortedRows = sortRows(rows);

  return sortedRows
    .map((row, index) => {
      return `**${index + 1}. ${row.clubName}**  •  S ${row.s}  •  U ${row.u}  •  N ${row.n}  •  Diff ${row.diff}  •  P ${row.points}`;
    })
    .join('\n');
}

function buildGroupTableEmbed(eventLabel, groupLetter, rows) {
  return new EmbedBuilder()
    .setTitle(`🏆 ${eventLabel} • Gruppe ${groupLetter} • Live-Tabelle`)
    .setDescription(rows.length ? buildTableText(rows) : 'Noch keine Teams.')
    .setColor(0xff0000);
}

function buildGroupScheduleText(matches) {
  return matches
    .map(match => {
      let status = '⏳ Offen';

      if (match.status === 'reported' && match.reportedScore) {
        status = `📝 Gemeldet: ${match.reportedScore.home}:${match.reportedScore.away}`;
      }

      if (match.status === 'confirmed' && match.reportedScore) {
        status = `✅ Bestätigt: ${match.reportedScore.home}:${match.reportedScore.away}`;
      }

      return `**${match.matchNumber}.** ${match.homeClubName} vs ${match.awayClubName}\n🕒 ${match.timeWindow} • ${status}`;
    })
    .join('\n\n');
}

function buildGroupScheduleEmbed(eventLabel, groupLetter, matches) {
  return new EmbedBuilder()
    .setTitle(`⚽ ${eventLabel} • Gruppe ${groupLetter} • Spielplan`)
    .setDescription(
      [
        'Die Ergebnisse werden über den Button darunter eingetragen.',
        '',
        buildGroupScheduleText(matches),
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildGroupScheduleButtons(eventKey, groupLetter) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`result_open:${eventKey}:${groupLetter}`)
      .setLabel('⚽ Ergebnis eintragen')
      .setStyle(ButtonStyle.Primary)
  );
}

function getRoundLabel(roundKey) {
  if (roundKey === 'roundOf16') return 'Achtelfinale';
  if (roundKey === 'quarterFinal') return 'Viertelfinale';
  if (roundKey === 'semiFinal') return 'Halbfinale';
  if (roundKey === 'thirdPlace') return 'Spiel um Platz 3';
  if (roundKey === 'final') return 'Finale';
  return 'K.O.-Phase';
}

function buildKoRoundEmbed(eventLabel, roundKey, matches) {
  const lines = matches.map(match => {
    let status = '⏳ Offen';

    if (match.status === 'reported' && match.reportedScore) {
      status = `📝 Gemeldet: ${match.reportedScore.home}:${match.reportedScore.away}`;
    }

    if (match.status === 'confirmed' && match.reportedScore) {
      status = `✅ Bestätigt: ${match.reportedScore.home}:${match.reportedScore.away}`;
    }

    return [
      `**${match.matchNumber}. ${match.homeClubName} vs ${match.awayClubName}**`,
      `🕒 ${match.timeWindow}`,
      `${status}`,
    ].join('\n');
  });

  return new EmbedBuilder()
    .setTitle(`🏆 ${eventLabel} • ${getRoundLabel(roundKey)}`)
    .setDescription(
      [
        'Ergebnisse werden über den Button darunter eingetragen.',
        '',
        ...lines,
      ].join('\n\n')
    )
    .setColor(0xff0000);
}

function buildKoButtons(eventKey, roundKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ko_result_open:${eventKey}:${roundKey}`)
      .setLabel('⚽ Ergebnis eintragen')
      .setStyle(ButtonStyle.Primary)
  );
}

// =========================
// TEAM HELPERS
// =========================

function getLiveTeams() {
  return loadTeams()
    .filter(team => !team.isTest)
    .sort((a, b) => a.clubName.localeCompare(b.clubName, 'de'));
}

function findTeamById(teamId) {
  return loadTeams().find(t => String(t.id) === String(teamId)) || null;
}

function buildTeamsOverviewEmbeds() {
  const teams = getLiveTeams();

  if (!teams.length) {
    return [
      new EmbedBuilder()
        .setTitle('📋 Registrierte Teams')
        .setDescription('Aktuell sind keine Live-Teams registriert.')
        .setColor(0xff0000),
    ];
  }

  const chunks = chunkArray(teams, 10);

  return chunks.slice(0, 10).map((chunk, index) => {
    const lines = chunk.map((team, i) => {
      return [
        `**${index * 10 + i + 1}. ${safeText(team.clubName)}**`,
        `Manager: ${formatUserMention(team.managerId)}`,
        `Co-VMs: ${
          Array.isArray(team.coManagerIds) && team.coManagerIds.length
            ? team.coManagerIds.map(formatUserMention).join(', ')
            : '—'
        }`,
      ].join('\n');
    });

    return new EmbedBuilder()
      .setTitle(
        index === 0
          ? `📋 Registrierte Teams (${teams.length})`
          : `📋 Registrierte Teams (${index + 1}/${chunks.length})`
      )
      .setDescription(lines.join('\n\n'))
      .setColor(0xff0000);
  });
}

function buildTeamDetailsEmbed(team) {
  const coManagers =
    Array.isArray(team.coManagerIds) && team.coManagerIds.length
      ? team.coManagerIds.map(formatUserMention).join(', ')
      : '—';

  return new EmbedBuilder()
    .setTitle(`🔎 ${safeText(team.clubName)}`)
    .setDescription(
      [
        `**Team-ID:** \`${safeText(team.id)}\``,
        `**Manager:** ${formatUserMention(team.managerId)}`,
        `**Co-Manager:** ${coManagers}`,
        `**Logo:** ${safeText(team.logoFile)}`,
        `**Erstellt:** ${safeText(team.createdAt)}`,
        `**Aktualisiert:** ${safeText(team.updatedAt)}`,
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildTeamSelectRows(customIdBase, placeholder = 'Team auswählen') {
  const teams = getLiveTeams();
  if (!teams.length) return [];

  const chunks = chunkArray(teams, 25);

  return chunks.slice(0, 5).map((chunk, index) => {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${customIdBase}:${index}`)
        .setPlaceholder(`${placeholder} (${index + 1}/${chunks.length})`)
        .addOptions(
          chunk.map(team => ({
            label: safeText(team.clubName).slice(0, 100),
            value: team.id,
            description: `Manager: ${safeText(team.managerId).slice(0, 80)}`,
          }))
        )
    );
  });
}

function buildEditTeamActionRows(teamId, team) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`live_edit_team_data:${teamId}`)
      .setLabel('✏️ Daten bearbeiten')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`live_edit_add_covm:${teamId}`)
      .setLabel('➕ Co-VM hinzufügen')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`live_edit_remove_covm:${teamId}`)
      .setLabel('➖ Co-VM entfernen')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!Array.isArray(team.coManagerIds) || team.coManagerIds.length === 0)
  );

  return [row1];
}

function syncTeamNameAcrossData(teamId, oldClubName, newClubName) {
  if (!newClubName || oldClubName === newClubName) return;

  const checkins = loadCheckins();
  const groups = loadGroups();
  const results = loadResults();
  const ko = loadKo();

  for (const eventKey of ['friday', 'saturday']) {
    const checkinEvent = checkins[eventKey];
    if (checkinEvent?.teams) {
      for (const team of checkinEvent.teams) {
        if (team.teamId === teamId || team.id === teamId || team.clubName === oldClubName) {
          team.clubName = newClubName;
        }
      }
    }
  }
  saveCheckins(checkins);

  for (const eventKey of ['friday', 'saturday']) {
    const event = groups[eventKey];
    if (!event?.groups) continue;

    for (const letter of Object.keys(event.groups)) {
      const group = event.groups[letter];

      for (const team of group.teams || []) {
        if (team.teamId === teamId || team.id === teamId || team.clubName === oldClubName) {
          team.clubName = newClubName;
        }
      }

      for (const row of group.rows || []) {
        if (row.teamId === teamId || row.id === teamId || row.clubName === oldClubName) {
          row.clubName = newClubName;
        }
      }
    }
  }
  saveGroups(groups);

  for (const eventKey of ['friday', 'saturday']) {
    const event = results[eventKey];
    if (!event?.groups) continue;

    for (const letter of Object.keys(event.groups)) {
      const group = event.groups[letter];

      for (const match of group.matches || []) {
        if (match.homeTeamId === teamId || match.homeClubName === oldClubName) {
          match.homeClubName = newClubName;
        }
        if (match.awayTeamId === teamId || match.awayClubName === oldClubName) {
          match.awayClubName = newClubName;
        }
      }
    }
  }
  saveResults(results);

  for (const eventKey of ['friday', 'saturday']) {
    const event = ko[eventKey];
    if (!event?.rounds) continue;

    for (const roundKey of Object.keys(event.rounds)) {
      const round = event.rounds[roundKey];

      for (const match of round.matches || []) {
        if (match.homeTeamId === teamId || match.homeClubName === oldClubName) {
          match.homeClubName = newClubName;
        }
        if (match.awayTeamId === teamId || match.awayClubName === oldClubName) {
          match.awayClubName = newClubName;
        }
      }
    }
  }
  saveKo(ko);
}

function updateRegisteredTeam({ teamId, newClubName, newManagerId, newLogoFile }) {
  const teams = loadTeams();
  const teamIndex = teams.findIndex(t => t.id === teamId);

  if (teamIndex === -1) {
    throw new Error('Team nicht gefunden.');
  }

  const team = teams[teamIndex];
  const oldClubName = team.clubName;

  if (newClubName) {
    const duplicate = teams.find(
      (t, index) =>
        index !== teamIndex &&
        t.clubName.toLowerCase() === newClubName.toLowerCase()
    );

    if (duplicate) {
      throw new Error('Ein anderes Team mit diesem Namen existiert bereits.');
    }

    team.clubName = newClubName;
  }

  if (newManagerId) {
    team.managerId = String(newManagerId);
  }

  if (newLogoFile !== null) {
    team.logoFile = newLogoFile;
  }

  team.updatedAt = new Date().toISOString();
  teams[teamIndex] = team;
  saveTeams(teams);

  if (newClubName && newClubName !== oldClubName) {
    syncTeamNameAcrossData(team.id, oldClubName, newClubName);
  }

  return team;
}

async function getManagersWithoutTeam(guild) {
  const managerRoleId = process.env.MANAGER_ROLE_ID;

  if (!managerRoleId) {
    throw new Error('MANAGER_ROLE_ID fehlt.');
  }

  const managerRole = await guild.roles.fetch(managerRoleId).catch(() => null);

  if (!managerRole) {
    throw new Error('Manager Rolle nicht gefunden.');
  }

  await guild.members.fetch();

  const teams = loadTeams();
  const assignedUsers = new Set();

  for (const team of teams) {
    if (team.managerId) assignedUsers.add(String(team.managerId));

    if (Array.isArray(team.coManagerIds)) {
      for (const id of team.coManagerIds) {
        assignedUsers.add(String(id));
      }
    }
  }

  const managersWithoutTeam = managerRole.members.filter(member => {
    return !assignedUsers.has(String(member.id));
  });

  return [...managersWithoutTeam.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'de')
  );
}

function buildManagersWithoutTeamTextChunks(members) {
  if (!members.length) {
    return [
      [
        '👥 **Manager ohne registriertes Team**',
        '',
        '✅ Aktuell haben alle Manager ein registriertes Team.',
      ].join('\n'),
    ];
  }

  const header = [
    '⚠️ **Manager-Rollen Kontrolle**',
    '',
    'Die folgenden Nutzer besitzen aktuell die Manager-Rolle, sind jedoch keinem registrierten Team zugeordnet.',
    '',
    `➡️ **Teamregistrierung:** <#${TEAM_REGISTER_CHANNEL_ID}>`,
    '',
    'Wer innerhalb von **7 Tagen** kein Team registriert oder keinem Team als Vereinsmanager bzw. Co-VM zugeordnet ist, wird wieder auf die Spieler-Rolle zurückgesetzt.',
    '',
    'Bitte bleibt nur dann Manager, wenn ihr aktiv ein Team verwaltet.',
    '',
    `📊 **Gefunden:** ${members.length} Manager`,
    '',
  ].join('\n');

  const lines = members.map((member, index) => {
    return `**${index + 1}.** <@${member.id}>`;
  });

  const chunks = [];
  let current = header;

  for (const line of lines) {
    const next = `${current}\n${line}`;

    if (next.length > 1900) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}

// =========================
// LIVE DATA OPERATIONS
// =========================

function getActualFormat(teamCount) {
  if (teamCount < 8) return 0;
  if (teamCount < 16) return 8;
  if (teamCount < 24) return 16;
  if (teamCount < 32) return 24;
  return 32;
}

async function deleteRegisteredTeam(teamId) {
  const teams = loadTeams();
  const checkins = loadCheckins();
  const groups = loadGroups();
  const results = loadResults();
  const ko = loadKo();

  const team = teams.find(t => t.id === teamId);
  if (!team) {
    throw new Error('Team nicht gefunden.');
  }

  saveTeams(teams.filter(t => t.id !== teamId));

  for (const eventKey of ['friday', 'saturday']) {
    const event = checkins[eventKey];
    if (!event) continue;

    event.teams = (event.teams || []).filter(t => t.teamId !== teamId && t.id !== teamId);

    if (event.backupDecisions && event.backupDecisions[teamId]) {
      delete event.backupDecisions[teamId];
    }
  }
  saveCheckins(checkins);

  for (const eventKey of ['friday', 'saturday']) {
    const event = groups[eventKey];
    if (!event?.groups) continue;

    for (const letter of Object.keys(event.groups)) {
      const group = event.groups[letter];
      group.teams = (group.teams || []).filter(t => t.teamId !== teamId && t.id !== teamId);
      group.rows = (group.rows || []).filter(r => r.teamId !== teamId && r.id !== teamId);
    }
  }
  saveGroups(groups);

  for (const eventKey of ['friday', 'saturday']) {
    const event = results[eventKey];
    if (!event?.groups) continue;

    for (const letter of Object.keys(event.groups)) {
      const group = event.groups[letter];
      group.matches = (group.matches || []).filter(
        m => m.homeTeamId !== teamId && m.awayTeamId !== teamId
      );
    }
  }
  saveResults(results);

  for (const eventKey of ['friday', 'saturday']) {
    const event = ko[eventKey];
    if (!event?.rounds) continue;

    for (const roundKey of Object.keys(event.rounds)) {
      const round = event.rounds[roundKey];
      round.matches = (round.matches || []).filter(
        m => m.homeTeamId !== teamId && m.awayTeamId !== teamId
      );
    }
  }
  saveKo(ko);

  await logToLive(`🗑️ Registriertes Team gelöscht: ${team.clubName}`);
  return team;
}

function recalculateRows(rows, matches) {
  const nextRows = rows.map(row => ({
    ...row,
    s: 0,
    u: 0,
    n: 0,
    diff: 0,
    points: 0,
  }));

  for (const match of matches) {
    if (match.status !== 'confirmed' || !match.reportedScore) continue;

    const homeRow = nextRows.find(r => r.teamId === match.homeTeamId);
    const awayRow = nextRows.find(r => r.teamId === match.awayTeamId);

    if (!homeRow || !awayRow) continue;

    const homeGoals = Number(match.reportedScore.home);
    const awayGoals = Number(match.reportedScore.away);

    homeRow.diff += homeGoals - awayGoals;
    awayRow.diff += awayGoals - homeGoals;

    if (homeGoals > awayGoals) {
      homeRow.s += 1;
      homeRow.points += 3;
      awayRow.n += 1;
    } else if (homeGoals < awayGoals) {
      awayRow.s += 1;
      awayRow.points += 3;
      homeRow.n += 1;
    } else {
      homeRow.u += 1;
      awayRow.u += 1;
      homeRow.points += 1;
      awayRow.points += 1;
    }
  }

  return nextRows;
}

async function updateLiveGroupMessages(eventKey, groupLetter) {
  const groupsData = loadGroups();
  const resultsData = loadResults();

  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];

  if (!groupMeta) return;

  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) return;

  let rowsToRender = groupMeta.rows || [];

  if (resultGroup?.matches) {
    rowsToRender = recalculateRows(groupMeta.rows, resultGroup.matches);
    groupsData[eventKey].groups[groupLetter].rows = rowsToRender;
    saveGroups(groupsData);
  }

  const tableMessage = await fetchMessage(channel, groupMeta.tableMessageId);
  if (tableMessage) {
    await tableMessage.edit({
      embeds: [buildGroupTableEmbed(groupsData[eventKey].label, groupLetter, rowsToRender)],
    });
  }

  if (groupMeta.pingMessageId) {
    const pingMessage = await fetchMessage(channel, groupMeta.pingMessageId);
    if (pingMessage) {
      await pingMessage.edit({
        content: buildGroupPingMessage(groupLetter, groupMeta.teams || []),
        allowedMentions: { parse: ['users'] },
      });
    }
  }

  if (resultGroup?.scheduleMessageId) {
    const scheduleMessage = await fetchMessage(channel, resultGroup.scheduleMessageId);
    if (scheduleMessage) {
      await scheduleMessage.edit({
        embeds: [buildGroupScheduleEmbed(groupsData[eventKey].label, groupLetter, resultGroup.matches)],
        components: [buildGroupScheduleButtons(eventKey, groupLetter)],
      });
    }
  }
}

async function replaceTeamInLiveGroups(eventKey, outgoingTeam, incomingTeam) {
  const groupsData = loadGroups();
  const resultsData = loadResults();

  const eventGroups = groupsData[eventKey];
  const eventResults = resultsData[eventKey];

  if (!eventGroups?.groups) {
    return null;
  }

  const outgoingId = getTeamKey(outgoingTeam);
  const incoming = normalizeIncomingTeamForGroup(incomingTeam);

  let changedGroupLetter = null;

  for (const letter of Object.keys(eventGroups.groups)) {
    const group = eventGroups.groups[letter];

    const teamIndex = (group.teams || []).findIndex(team => getTeamKey(team) === outgoingId);
    const rowIndex = (group.rows || []).findIndex(row => getTeamKey(row) === outgoingId);

    if (teamIndex === -1 && rowIndex === -1) continue;

    changedGroupLetter = letter;

    const resultGroup = eventResults?.groups?.[letter];

    if (resultGroup?.matches?.length) {
      for (const match of resultGroup.matches) {
        const touchesOutgoing =
          String(match.homeTeamId) === outgoingId ||
          String(match.awayTeamId) === outgoingId;

        if (!touchesOutgoing) continue;

        if (match.status && !['open', 'pending'].includes(match.status)) {
          throw new Error(
            `Team kann nicht ersetzt werden, weil in Gruppe ${letter} bereits ein Ergebnis betroffen ist.`
          );
        }
      }

      for (const match of resultGroup.matches) {
        if (String(match.homeTeamId) === outgoingId) {
          match.homeTeamId = incoming.teamId;
          match.homeClubName = incoming.clubName;
        }

        if (String(match.awayTeamId) === outgoingId) {
          match.awayTeamId = incoming.teamId;
          match.awayClubName = incoming.clubName;
        }
      }
    }

    if (teamIndex !== -1) {
      group.teams[teamIndex] = incoming;
    }

    if (rowIndex !== -1) {
      group.rows[rowIndex] = {
        ...incoming,
        s: 0,
        u: 0,
        n: 0,
        diff: 0,
        points: 0,
      };
    }
  }

  if (!changedGroupLetter) {
    return null;
  }

  saveGroups(groupsData);
  saveResults(resultsData);

  await updateLiveGroupMessages(eventKey, changedGroupLetter);

  return changedGroupLetter;
}

async function promoteBackupSwap(eventKey, outgoingTeamId, incomingTeamId) {
  const checkins = loadCheckins();
  const event = checkins[eventKey];

  if (!event) {
    throw new Error('Check-in Event nicht gefunden.');
  }

  const actualFormat = getActualFormat(event.teams.length);
  if (!actualFormat) {
    throw new Error('Für dieses Event gibt es aktuell kein gültiges Turnierformat.');
  }

  const participantIndex = event.teams.findIndex(team =>
    String(team.teamId || team.id) === String(outgoingTeamId)
  );

  const backupIndex = event.teams.findIndex(team =>
    String(team.teamId || team.id) === String(incomingTeamId)
  );

  if (participantIndex === -1) {
    throw new Error('Das rauszunehmende Team wurde nicht gefunden.');
  }

  if (backupIndex === -1) {
    throw new Error('Das nachrückende Backup-Team wurde nicht gefunden.');
  }

  if (participantIndex >= actualFormat) {
    throw new Error('Das rauszunehmende Team ist aktuell gar nicht im Turnier.');
  }

  if (backupIndex < actualFormat) {
    throw new Error('Das nachrückende Team ist aktuell kein Backup-Team.');
  }

  const participant = event.teams[participantIndex];
  const backup = event.teams[backupIndex];

  const backupDecision = event.backupDecisions?.[backup.teamId || backup.id];

  if (backupDecision && backupDecision !== 'yes') {
    throw new Error('Dieses Backup-Team hat nicht bestätigt, dass es bereitsteht.');
  }

  const changedGroupLetter = await replaceTeamInLiveGroups(eventKey, participant, backup);

if (changedGroupLetter) {
  await swapGroupRoles(changedGroupLetter, participant, backup);
}

event.teams[participantIndex] = backup;
event.teams[backupIndex] = participant;

  saveCheckins(checkins);

  await logToLive(
    changedGroupLetter
      ? `🔁 Manuelles Nachrücken: ${backup.clubName} rückt nach, ${participant.clubName} geht auf Backup. Gruppe ${changedGroupLetter} wurde aktualisiert.`
      : `🔁 Manuelles Nachrücken: ${backup.clubName} rückt nach, ${participant.clubName} geht auf Backup.`
  );

  return { participant, backup, changedGroupLetter };
}

async function manualSetGroupResult(eventKey, groupLetter, matchNumber, homeGoals, awayGoals) {
  const resultsData = loadResults();
  const groupsData = loadGroups();

  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];
  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];

  if (!resultGroup || !groupMeta) {
    throw new Error('Gruppenspiel nicht gefunden.');
  }

  const match = resultGroup.matches.find(m => m.matchNumber === Number(matchNumber));

  if (!match) {
    throw new Error('Match nicht gefunden.');
  }

  if (match.isByeMatch) {
    throw new Error('Freilos-Spiele können nicht manuell überschrieben werden.');
  }

  // Alte Bestätigungsnachricht löschen, falls vorher ein Team gemeldet hatte
  if (match.confirmationMessageId) {
    const channel = await fetchChannel(groupMeta.channelId);

    if (channel) {
      const message = await fetchMessage(channel, match.confirmationMessageId);

      if (message) {
        await message.delete().catch(() => {});
      }
    }

    match.confirmationMessageId = null;
  }

  // Admin überschreibt alles und bestätigt direkt final
  match.status = 'confirmed';
  match.reportedByTeamId = 'admin-manual';
  match.reportedScore = {
    home: Number(homeGoals),
    away: Number(awayGoals),
  };
  match.confirmed = true;

  saveResults(resultsData);

  await updateLiveGroupMessages(eventKey, groupLetter);

  await logToLive(
    `✏️ Admin-Korrektur Gruppe ${groupLetter}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`
  );
}

async function updateLiveKoRoundMessage(eventKey, roundKey) {
  const koData = loadKo();
  const event = koData[eventKey];
  const round = event?.rounds?.[roundKey];

  if (!event || !round) return;

  const channel = await fetchChannel(round.channelId);
  if (!channel) return;

  const message = await fetchMessage(channel, round.messageId);
  if (!message) return;

  await message.edit({
    embeds: [buildKoRoundEmbed(event.label, roundKey, round.matches)],
    components: [buildKoButtons(eventKey, roundKey)],
  });
}

async function manualSetKoResult(eventKey, roundKey, matchNumber, homeGoals, awayGoals) {
  const koData = loadKo();
  const event = koData[eventKey];
  const round = event?.rounds?.[roundKey];

  if (!event || !round) {
    throw new Error('K.O.-Runde nicht gefunden.');
  }

  const match = round.matches.find(m => m.matchNumber === Number(matchNumber));
  if (!match) {
    throw new Error('K.O.-Match nicht gefunden.');
  }

  if (Number(homeGoals) === Number(awayGoals)) {
    throw new Error('In der K.O.-Phase ist kein Unentschieden erlaubt.');
  }

  // Alte Bestätigungsnachricht löschen, falls vorher ein Team gemeldet hatte
  if (match.confirmationMessageId) {
    const channel = await fetchChannel(round.channelId);

    if (channel) {
      const message = await fetchMessage(channel, match.confirmationMessageId);

      if (message) {
        await message.delete().catch(() => {});
      }
    }

    match.confirmationMessageId = null;
  }

  // Admin überschreibt alles und bestätigt direkt final
  match.status = 'confirmed';
  match.reportedByTeamId = 'admin-manual';
  match.reportedScore = {
    home: Number(homeGoals),
    away: Number(awayGoals),
  };
  match.confirmed = true;
  match.confirmedAt = new Date().toISOString();

  if (Number(homeGoals) > Number(awayGoals)) {
    match.winnerTeamId = match.homeTeamId;
    match.loserTeamId = match.awayTeamId;
  } else {
    match.winnerTeamId = match.awayTeamId;
    match.loserTeamId = match.homeTeamId;
  }

  saveKo(koData);
  
  await updateLiveKoRoundMessage(eventKey, roundKey);

    await logToLive(
    `✏️ Admin-Korrektur ${getRoundLabel(roundKey)}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`
  );

  if (roundKey === 'final' || roundKey === 'thirdPlace') {
    await sendTournamentCeremonyIfReady(clientRef, eventKey);
  }
}
function addByeTeamToCheckins(eventKey) {
  const checkins = loadCheckins();
  const event = checkins[eventKey];

  if (!event) {
    throw new Error('Event nicht gefunden.');
  }

  if (event.finalized) {
    throw new Error('Dieses Event ist bereits finalisiert. Freilos-Teams können nur vor der Finalisierung hinzugefügt werden.');
  }

  if (!Array.isArray(event.teams)) {
    event.teams = [];
  }

  if (event.teams.length >= 32) {
    throw new Error('Das Event hat bereits 32 Teams. Mehr geht aktuell nicht.');
  }

  const existingByeTeams = event.teams.filter(team => team.isByeTeam);
  const nextNumber = existingByeTeams.length + 1;

  const byeTeam = {
    teamId: `bye_${eventKey}_${Date.now()}_${nextNumber}`,
    clubName: `Freilos-Team ${nextNumber}`,
    managerId: null,
    coManagerIds: [],
    isByeTeam: true,
    createdAt: new Date().toISOString(),
  };

  event.teams.push(byeTeam);

  saveCheckins(checkins);

    return {
    event,
    byeTeam,
    totalTeams: event.teams.length,
  };
}

function removeByeTeamFromCheckins(eventKey) {
  const checkins = loadCheckins();
  const event = checkins[eventKey];

  if (!event) {
    throw new Error('Event nicht gefunden.');
  }

  if (event.finalized) {
    throw new Error('Dieses Event ist bereits finalisiert. Freilos-Teams können nur vor der Finalisierung entfernt werden.');
  }

  if (!Array.isArray(event.teams) || !event.teams.length) {
    throw new Error('Für dieses Event gibt es keine eingecheckten Teams.');
  }

  const byeIndex = event.teams.findLastIndex(team => team.isByeTeam);

  if (byeIndex === -1) {
    throw new Error('Für dieses Event gibt es aktuell kein Freilos-Team.');
  }

  const removedByeTeam = event.teams[byeIndex];

  event.teams.splice(byeIndex, 1);

  saveCheckins(checkins);

  return {
    event,
    removedByeTeam,
    totalTeams: event.teams.length,
  };
}


// =========================
// SELECT BUILDERS
// =========================

function buildEventSelect(customId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Event auswählen')
      .addOptions([
        { label: 'Freitag', value: 'friday' },
        { label: 'Samstag', value: 'saturday' },
      ])
  );
}

function buildActiveBackupEventSelect(customId) {
  const checkins = loadCheckins();

  const options = ['friday', 'saturday']
    .filter(eventKey => checkins[eventKey]?.teams?.length)
    .map(eventKey => ({
      label: checkins[eventKey]?.label || (eventKey === 'friday' ? 'Freitag' : 'Samstag'),
      value: eventKey,
      description: `${checkins[eventKey].teams.length} eingecheckte Teams`,
    }));

  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Event auswählen')
      .addOptions(options)
  );
}

function buildBackupTeamSelectRows(eventKey, mode, outgoingTeamId = null) {
  const checkins = loadCheckins();
  const event = checkins[eventKey];

  if (!event?.teams?.length) return [];

  const actualFormat = getActualFormat(event.teams.length);
  if (!actualFormat) return [];

  const rawTeams =
    mode === 'outgoing'
      ? event.teams.slice(0, actualFormat).map((team, index) => ({
          team,
          slotNumber: index + 1,
        }))
      : event.teams.slice(actualFormat).map((team, index) => ({
          team,
          slotNumber: actualFormat + index + 1,
        }));

  const entries =
    mode === 'incoming'
      ? rawTeams.filter(entry => {
          const decision =
            event.backupDecisions?.[entry.team.teamId || entry.team.id];

          return decision === 'yes';
        })
      : rawTeams;

  if (!entries.length) return [];

  const chunks = chunkArray(entries, 25);

  return chunks.slice(0, 5).map((chunk, index) => {
    const customId =
      mode === 'outgoing'
        ? `live_backup_pick_outgoing:${eventKey}:${index}`
        : `live_backup_pick_incoming:${eventKey}:${outgoingTeamId}:${index}`;

    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(
          mode === 'outgoing'
            ? `Team auswählen, das raus soll (${index + 1}/${chunks.length})`
            : `Bestätigtes Backup auswählen (${index + 1}/${chunks.length})`
        )
        .addOptions(
          chunk.map(entry => {
            const team = entry.team;
            const decision = event.backupDecisions?.[team.teamId || team.id];

            let backupStatus = 'Warteliste';
            if (decision === 'yes') backupStatus = 'Backup bestätigt';
            if (decision === 'no') backupStatus = 'Backup abgelehnt';

            return {
              label: `${entry.slotNumber}. ${safeText(team.clubName)}`.slice(0, 100),
              value: String(team.teamId || team.id),
              description:
                mode === 'outgoing'
                  ? `Aktuell im Turnier auf Platz ${entry.slotNumber}`
                  : backupStatus,
            };
          })
        )
    );
  });
}

// =========================
// INIT / EXPORTS
// =========================

module.exports = {
  async init(client) {
    clientRef = client;

    ensureFile(ADMIN_FILE, {
      liveControlPanelMessageId: null,
    });

    await ensureLiveControlPanel();
  },

  async handleInteraction(interaction) {
    // =========================
    // BUTTONS
    // =========================
    if (interaction.isButton()) {
      const adminButton =
        [
          'live_show_teams',
          'live_team_details',
          'live_edit_team',
          'live_delete_team',
          'live_manual_backup',
          'live_manual_group_result',
          'live_manual_ko_result',
          'live_managers_without_team',
          'live_add_bye_team',
          'live_remove_bye_team',
          'live_test_ceremony',
        ].includes(interaction.customId) ||
        interaction.customId.startsWith('live_edit_team_data:') ||
        interaction.customId.startsWith('live_edit_add_covm:') ||
        interaction.customId.startsWith('live_edit_remove_covm:');

      if (!adminButton) return false;

      const denied = requireAdmin(interaction);
      if (denied) {
        await denied;
        return true;
      }

      if (interaction.customId === 'live_show_teams') {
        const embeds = buildTeamsOverviewEmbeds();

        await replyTemp(interaction, {
          content: '📋 Hier sind die aktuell registrierten Live-Teams:',
          embeds,
          allowedMentions: { parse: ['users'] },
        });

        return true;
      }

      if (interaction.customId === 'live_managers_without_team') {
        try {
          const members = await getManagersWithoutTeam(interaction.guild);
          const channel = await fetchChannel(MANAGERS_WITHOUT_TEAM_CHANNEL_ID);

          if (!channel) {
            await interaction.reply({
              content: '❌ Zielkanal nicht gefunden.',
              flags: MessageFlags.Ephemeral,
            });
            return true;
          }

          const chunks = buildManagersWithoutTeamTextChunks(members);

          for (const chunk of chunks) {
            await channel.send({
              content: chunk,
              allowedMentions: { parse: ['users'] },
            });
          }

          await interaction.reply({
            content: `✅ Liste wurde in <#${MANAGERS_WITHOUT_TEAM_CHANNEL_ID}> gepostet.`,
            flags: MessageFlags.Ephemeral,
          });
        } catch (error) {
          await interaction.reply({
            content: `❌ ${error.message}`,
            flags: MessageFlags.Ephemeral,
          });
        }

        return true;
      }

      if (interaction.customId === 'live_team_details') {
        const rows = buildTeamSelectRows('live_team_details_select', 'Team für Details auswählen');

        if (!rows.length) {
          await replyTemp(interaction, {
            content: '❌ Aktuell sind keine Teams registriert.',
          });
          return true;
        }

        await interaction.reply({
          content: '🔎 Wähle ein Team aus.',
          components: rows,
          flags: MessageFlags.Ephemeral,
        });

        return true;
      }

      if (interaction.customId === 'live_edit_team') {
        const rows = buildTeamSelectRows('live_edit_team_select', 'Team zum Bearbeiten auswählen');

        if (!rows.length) {
          await replyTemp(interaction, {
            content: '❌ Aktuell sind keine Teams registriert.',
          });
          return true;
        }

        await interaction.reply({
          content: '✏️ Wähle ein Team aus, das du bearbeiten willst.',
          components: rows,
          flags: MessageFlags.Ephemeral,
        });

        return true;
      }

      if (interaction.customId === 'live_delete_team') {
        const rows = buildTeamSelectRows('live_delete_team_select', 'Team zum Löschen auswählen');

        if (!rows.length) {
          await replyTemp(interaction, {
            content: '❌ Aktuell sind keine Teams registriert.',
          });
          return true;
        }

        await interaction.reply({
          content: '🗑️ Wähle ein Team aus, das gelöscht werden soll.',
          components: rows,
          flags: MessageFlags.Ephemeral,
        });

        return true;
      }

      if (interaction.customId.startsWith('live_edit_team_data:')) {
        const [, teamId] = interaction.customId.split(':');
        const team = findTeamById(teamId);

        if (!team) {
          await replyTemp(interaction, {
            content: '❌ Team nicht gefunden.',
          });
          return true;
        }

        const modal = new ModalBuilder()
          .setCustomId(`live_edit_team_modal:${teamId}`)
          .setTitle('Teamdaten bearbeiten');

        const newClubNameInput = new TextInputBuilder()
          .setCustomId('new_club_name')
          .setLabel('Teamname')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(team.clubName?.slice(0, 100) || '');

        const managerIdInput = new TextInputBuilder()
          .setCustomId('new_manager_id')
          .setLabel('Manager ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(team.managerId ? String(team.managerId).slice(0, 100) : '');

        const logoFileInput = new TextInputBuilder()
          .setCustomId('new_logo_file')
          .setLabel('Logo-Dateiname')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(team.logoFile ? String(team.logoFile).slice(0, 100) : '');

        modal.addComponents(
          new ActionRowBuilder().addComponents(newClubNameInput),
          new ActionRowBuilder().addComponents(managerIdInput),
          new ActionRowBuilder().addComponents(logoFileInput)
        );

        await interaction.showModal(modal);
        return true;
      }

      if (interaction.customId.startsWith('live_edit_add_covm:')) {
        const [, teamId] = interaction.customId.split(':');
        const team = findTeamById(teamId);

        if (!team) {
          await replyTemp(interaction, {
            content: '❌ Team nicht gefunden.',
          });
          return true;
        }

        if (!Array.isArray(team.coManagerIds)) {
          team.coManagerIds = [];
        }

        if (team.coManagerIds.length >= 3) {
          await replyTemp(interaction, {
            content: '❌ Dieses Team hat bereits 3 Co-VMs.',
          });
          return true;
        }

        const row = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`live_edit_add_covm_select:${teamId}`)
            .setPlaceholder('User als Co-VM auswählen')
            .setMinValues(1)
            .setMaxValues(1)
        );

        await interaction.reply({
          content: `➕ Wähle den neuen Co-VM für **${team.clubName}** aus.`,
          components: [row],
          flags: MessageFlags.Ephemeral,
        });

        return true;
      }

      if (interaction.customId.startsWith('live_edit_remove_covm:')) {
        const [, teamId] = interaction.customId.split(':');
        const team = findTeamById(teamId);

        if (!team) {
          await replyTemp(interaction, {
            content: '❌ Team nicht gefunden.',
          });
          return true;
        }

        if (!Array.isArray(team.coManagerIds) || !team.coManagerIds.length) {
          await replyTemp(interaction, {
            content: '❌ Dieses Team hat keine Co-VMs.',
          });
          return true;
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`live_edit_remove_covm_select:${teamId}`)
            .setPlaceholder('Co-VM entfernen')
            .addOptions(
              team.coManagerIds.slice(0, 25).map(userId => ({
                label: `User ${userId}`.slice(0, 100),
                description: 'Als Co-VM entfernen',
                value: String(userId),
              }))
            )
        );

        await interaction.reply({
          content: `➖ Wähle den Co-VM aus, der bei **${team.clubName}** entfernt werden soll.`,
          components: [row],
          flags: MessageFlags.Ephemeral,
        });

        return true;
      }

      if (interaction.customId === 'live_manual_backup') {
        const row = buildActiveBackupEventSelect('live_backup_pick_event');

        if (!row) {
          await replyTemp(interaction, {
            content: '❌ Aktuell gibt es kein aktives Event mit eingecheckten Teams.',
          });
          return true;
        }

        await interaction.reply({
          content: '🔁 Wähle zuerst das Event aus.',
          components: [row],
          flags: MessageFlags.Ephemeral,
        });

        return true;
      }

      if (interaction.customId === 'live_manual_group_result') {
        await interaction.reply({
          content: 'Für welches Event willst du ein Gruppenergebnis manuell setzen?',
          components: [buildEventSelect('live_pick_group_event')],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

if (interaction.customId === 'live_test_ceremony') {
  try {
    await sendTestCeremony(interaction);

    await interaction.reply({
      content: '✅ Test-Siegerehrung wurde gepostet.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await interaction.reply({
      content: `❌ ${error.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  return true;
}

      if (interaction.customId === 'live_manual_ko_result') {
        await interaction.reply({
          content: 'Für welches Event willst du ein K.O.-Ergebnis manuell setzen?',
          components: [buildEventSelect('live_pick_ko_event')],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      if (interaction.customId === 'live_add_bye_team') {
  await interaction.reply({
    content: '🎟️ Für welches Event möchtest du ein Freilos-Team hinzufügen?',
    components: [buildEventSelect('live_add_bye_event')],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

if (interaction.customId === 'live_remove_bye_team') {
  await interaction.reply({
    content: '🚫 Für welches Event möchtest du ein Freilos-Team entfernen?',
    components: [buildEventSelect('live_remove_bye_event')],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

    }

    
    // =========================
    // USER SELECT MENUS
    // =========================
    if (interaction.isUserSelectMenu()) {
      const denied = requireAdmin(interaction);
      if (denied) {
        await denied;
        return true;
      }

      if (interaction.customId.startsWith('live_edit_add_covm_select:')) {
  await interaction.deferUpdate();

  const [, teamId] = interaction.customId.split(':');
  const userId = interaction.values?.[0];
  const teams = loadTeams();
  const team = teams.find(t => String(t.id) === String(teamId));

  if (!team || !userId) {
    await interaction.editReply({
      content: '❌ Team oder User nicht gefunden.',
      components: [],
    });
    return true;
  }

  if (!Array.isArray(team.coManagerIds)) {
    team.coManagerIds = [];
  }

  if (String(userId) === String(team.managerId)) {
    await interaction.editReply({
      content: '❌ Der Manager kann nicht zusätzlich Co-VM sein.',
      components: [],
    });
    return true;
  }

  if (team.coManagerIds.map(String).includes(String(userId))) {
    await interaction.editReply({
      content: '❌ Dieser User ist bereits Co-VM.',
      components: [],
    });
    return true;
  }

  if (team.coManagerIds.length >= 3) {
    await interaction.editReply({
      content: '❌ Dieses Team hat bereits 3 Co-VMs.',
      components: [],
    });
    return true;
  }
  
  team.coManagerIds.push(String(userId));
team.updatedAt = new Date().toISOString();
saveTeams(teams);

await refreshRegisteredTeamsSafe(interaction.guild);
await logToLive(`➕ Co-VM hinzugefügt: ${formatUserMention(userId)} zu ${team.clubName}`);

await interaction.editReply({
  content: `✅ ${formatUserMention(userId)} wurde als Co-VM bei **${team.clubName}** hinzugefügt.`,
  components: [],
  allowedMentions: { parse: ['users'] },
});

return true;
}

}

    // =========================
    // STRING SELECT MENUS
    // =========================
    if (interaction.isStringSelectMenu()) {
      const denied = requireAdmin(interaction);
      if (denied) {
        await denied;
        return true;
      }

      if (interaction.customId.startsWith('live_team_details_select:')) {
        const teamId = interaction.values[0];
        const team = findTeamById(teamId);

        if (!team) {
          await interaction.update({
            content: '❌ Team nicht gefunden.',
            embeds: [],
            components: [],
          });
          return true;
        }

        await interaction.update({
          content: '🔎 Teamdetails:',
          embeds: [buildTeamDetailsEmbed(team)],
          components: [],
          allowedMentions: { parse: ['users'] },
        });

        return true;
      }

      if (interaction.customId.startsWith('live_delete_team_select:')) {
        const teamId = interaction.values[0];

        try {
          const deletedTeam = await deleteRegisteredTeam(teamId);
          await refreshRegisteredTeamsSafe(interaction.guild);

          await interaction.update({
            content: `✅ Team gelöscht: **${deletedTeam.clubName}**`,
            components: [],
          });
        } catch (error) {
          await interaction.update({
            content: `❌ ${error.message}`,
            components: [],
          });
        }

        return true;
      }

      if (interaction.customId.startsWith('live_edit_team_select:')) {
        const teamId = interaction.values[0];
        const team = findTeamById(teamId);

        if (!team) {
          await interaction.update({
            content: '❌ Team nicht gefunden.',
            components: [],
          });
          return true;
        }

        await interaction.update({
          content: `✏️ Was möchtest du bei **${team.clubName}** bearbeiten?`,
          embeds: [buildTeamDetailsEmbed(team)],
          components: buildEditTeamActionRows(teamId, team),
          allowedMentions: { parse: ['users'] },
        });

        return true;
      }

      if (interaction.customId.startsWith('live_edit_remove_covm_select:')) {
        const [, teamId] = interaction.customId.split(':');
        const userId = interaction.values[0];
        const teams = loadTeams();
        const team = teams.find(t => String(t.id) === String(teamId));

        if (!team || !userId) {
          await interaction.update({
            content: '❌ Team oder Co-VM nicht gefunden.',
            components: [],
          });
          return true;
        }

        team.coManagerIds = (team.coManagerIds || []).filter(id => String(id) !== String(userId));
        team.updatedAt = new Date().toISOString();
        saveTeams(teams);

        await refreshRegisteredTeamsSafe(interaction.guild);
        await logToLive(`➖ Co-VM entfernt: ${formatUserMention(userId)} aus ${team.clubName}`);

        await interaction.update({
          content: `✅ ${formatUserMention(userId)} wurde als Co-VM bei **${team.clubName}** entfernt.`,
          components: [],
          allowedMentions: { parse: ['users'] },
        });

        return true;
      }

      if (interaction.customId === 'live_backup_pick_event') {
        const eventKey = interaction.values[0];

        const rows = buildBackupTeamSelectRows(eventKey, 'outgoing');

        if (!rows.length) {
          await interaction.update({
            content: '❌ Für dieses Event gibt es kein Team, das ersetzt werden kann.',
            components: [],
          });
          return true;
        }

        await interaction.update({
          content: '🔁 Wähle jetzt das Team aus, das raus soll.',
          components: rows,
        });

        return true;
      }

      if (interaction.customId.startsWith('live_backup_pick_outgoing:')) {
        const [, eventKey] = interaction.customId.split(':');
        const outgoingTeamId = interaction.values[0];

        const rows = buildBackupTeamSelectRows(eventKey, 'incoming', outgoingTeamId);

        if (!rows.length) {
  await interaction.update({
    content: '❌ Es gibt aktuell kein Backup-Team mit Status "Bereit".',
    components: [],
  });
  return true;
}

        await interaction.update({
          content: '🔁 Wähle jetzt das Backup-Team aus, das nachrücken soll.',
          components: rows,
        });

        return true;
      }

      if (interaction.customId.startsWith('live_backup_pick_incoming:')) {
        const [, eventKey, outgoingTeamId] = interaction.customId.split(':');
        const incomingTeamId = interaction.values[0];

        try {
          const result = await promoteBackupSwap(eventKey, outgoingTeamId, incomingTeamId);

if (checkinSystem.refreshEvent) {
  await checkinSystem.refreshEvent(eventKey);
}

          await interaction.update({
            content: [
              '✅ Backup-Swap durchgeführt.',
              '',
              `Raus: **${result.participant.clubName}**`,
              `Rein: **${result.backup.clubName}**`,
              result.changedGroupLetter
                ? `Gruppe **${result.changedGroupLetter}** wurde aktualisiert.`
                : 'Gruppen waren noch nicht erstellt oder mussten nicht aktualisiert werden.',
            ].join('\n'),
            components: [],
          });
        } catch (error) {
          await interaction.update({
            content: `❌ ${error.message}`,
            components: [],
          });
        }

        return true;
      }

      if (interaction.customId === 'live_pick_group_event') {
        const eventKey = interaction.values[0];
        const resultsData = loadResults();
        const event = resultsData[eventKey];

        if (!event || !event.groups) {
          await interaction.update({
            content: '❌ Für dieses Event gibt es aktuell keine Gruppenspiele.',
            components: [],
          });
          return true;
        }

        const groupOptions = Object.keys(event.groups).map(letter => ({
          label: `Gruppe ${letter}`,
          value: letter,
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`live_pick_group_letter:${eventKey}`)
            .setPlaceholder('Gruppe auswählen')
            .addOptions(groupOptions)
        );

        await interaction.update({
          content: `Event **${eventKey}** gewählt. Wähle jetzt die Gruppe aus.`,
          components: [row],
        });

        return true;
      }

      if (interaction.customId.startsWith('live_pick_group_letter:')) {
        const [, eventKey] = interaction.customId.split(':');
        const groupLetter = interaction.values[0];
        const resultsData = loadResults();
        const matches = resultsData[eventKey]?.groups?.[groupLetter]?.matches || [];

        if (!matches.length) {
          await interaction.update({
            content: '❌ Keine Gruppenspiele gefunden.',
            components: [],
          });
          return true;
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`live_pick_group_match:${eventKey}:${groupLetter}`)
            .setPlaceholder('Spiel auswählen')
            .addOptions(
              matches.map(match => ({
                label: `${match.homeClubName} vs ${match.awayClubName}`.slice(0, 100),
                description: `Spiel ${match.matchNumber} • ${match.timeWindow}`,
                value: String(match.matchNumber),
              }))
            )
        );

        await interaction.update({
          content: `Gruppe **${groupLetter}** gewählt. Wähle jetzt das Spiel aus.`,
          components: [row],
        });

        return true;
      }

      if (interaction.customId.startsWith('live_pick_group_match:')) {
        const [, eventKey, groupLetter] = interaction.customId.split(':');
        const matchNumber = interaction.values[0];
        const resultsData = loadResults();
        const match = resultsData[eventKey]?.groups?.[groupLetter]?.matches?.find(
          m => String(m.matchNumber) === String(matchNumber)
        );

        if (!match) {
          await interaction.update({
            content: '❌ Spiel nicht gefunden.',
            components: [],
          });
          return true;
        }

        const modal = new ModalBuilder()
          .setCustomId(`live_group_result_modal:${eventKey}:${groupLetter}:${matchNumber}`)
          .setTitle('Gruppenergebnis setzen');

        const homeInput = new TextInputBuilder()
          .setCustomId('home_goals')
          .setLabel(`Tore ${match.homeClubName}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. 3');

        const awayInput = new TextInputBuilder()
          .setCustomId('away_goals')
          .setLabel(`Tore ${match.awayClubName}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. 1');

        modal.addComponents(
          new ActionRowBuilder().addComponents(homeInput),
          new ActionRowBuilder().addComponents(awayInput)
        );

        await interaction.showModal(modal);
        return true;
      }

      if (interaction.customId === 'live_pick_ko_event') {
        const eventKey = interaction.values[0];
        const koData = loadKo();
        const event = koData[eventKey];

        if (!event || !event.rounds) {
          await interaction.update({
            content: '❌ Für dieses Event gibt es aktuell keine K.O.-Runden.',
            components: [],
          });
          return true;
        }

        const roundOptions = Object.keys(event.rounds).map(roundKey => ({
          label: getRoundLabel(roundKey),
          value: roundKey,
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`live_pick_ko_round:${eventKey}`)
            .setPlaceholder('K.O.-Runde auswählen')
            .addOptions(roundOptions)
        );

        await interaction.update({
          content: `Event **${eventKey}** gewählt. Wähle jetzt die K.O.-Runde aus.`,
          components: [row],
        });

        return true;
      }

      if (interaction.customId.startsWith('live_pick_ko_round:')) {
        const [, eventKey] = interaction.customId.split(':');
        const roundKey = interaction.values[0];
        const koData = loadKo();
        const matches = koData[eventKey]?.rounds?.[roundKey]?.matches || [];

        if (!matches.length) {
          await interaction.update({
            content: '❌ Keine K.O.-Spiele gefunden.',
            components: [],
          });
          return true;
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`live_pick_ko_match:${eventKey}:${roundKey}`)
            .setPlaceholder('Spiel auswählen')
            .addOptions(
              matches.map(match => ({
                label: `${match.homeClubName} vs ${match.awayClubName}`.slice(0, 100),
                description: `Spiel ${match.matchNumber} • ${match.timeWindow}`,
                value: String(match.matchNumber),
              }))
            )
        );

        await interaction.update({
          content: `${getRoundLabel(roundKey)} gewählt. Wähle jetzt das Spiel aus.`,
          components: [row],
        });

        return true;
      }

      if (interaction.customId.startsWith('live_pick_ko_match:')) {
        const [, eventKey, roundKey] = interaction.customId.split(':');
        const matchNumber = interaction.values[0];
        const koData = loadKo();
        const match = koData[eventKey]?.rounds?.[roundKey]?.matches?.find(
          m => String(m.matchNumber) === String(matchNumber)
        );

        if (!match) {
          await interaction.update({
            content: '❌ Spiel nicht gefunden.',
            components: [],
          });
          return true;
        }

        const modal = new ModalBuilder()
          .setCustomId(`live_ko_result_modal:${eventKey}:${roundKey}:${matchNumber}`)
          .setTitle('K.O.-Ergebnis setzen');

        const homeInput = new TextInputBuilder()
          .setCustomId('home_goals')
          .setLabel(`Tore ${match.homeClubName}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. 3');

        const awayInput = new TextInputBuilder()
          .setCustomId('away_goals')
          .setLabel(`Tore ${match.awayClubName}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. 1');

        modal.addComponents(
          new ActionRowBuilder().addComponents(homeInput),
          new ActionRowBuilder().addComponents(awayInput)
        );

        await interaction.showModal(modal);
        return true;
      }
      if (interaction.customId === 'live_add_bye_event') {
  const eventKey = interaction.values[0];

  try {
    const result = addByeTeamToCheckins(eventKey);

    if (checkinSystem.refreshEvent) {
      await checkinSystem.refreshEvent(eventKey);
    }

    await logToLive(
      `🎟️ Freilos hinzugefügt: ${result.byeTeam.clubName} für ${result.event.label || eventKey}. Teams jetzt: ${result.totalTeams}`
    );

    await interaction.update({
      content: [
        `✅ **${result.byeTeam.clubName}** wurde hinzugefügt.`,
        '',
        `Event: **${result.event.label || eventKey}**`,
        `Teams jetzt: **${result.totalTeams}**`,
      ].join('\n'),
      components: [],
    });
  } catch (error) {
    await interaction.update({
      content: `❌ ${error.message}`,
      components: [],
    });
  }

  return true;
}

if (interaction.customId === 'live_remove_bye_event') {
  const eventKey = interaction.values[0];

  try {
    const result = removeByeTeamFromCheckins(eventKey);

    if (checkinSystem.refreshEvent) {
      await checkinSystem.refreshEvent(eventKey);
    }

    await logToLive(
      `🚫 Freilos entfernt: ${result.removedByeTeam.clubName} aus ${result.event.label || eventKey}. Teams jetzt: ${result.totalTeams}`
    );

    await interaction.update({
      content: [
        `✅ **${result.removedByeTeam.clubName}** wurde entfernt.`,
        '',
        `Event: **${result.event.label || eventKey}**`,
        `Teams jetzt: **${result.totalTeams}**`,
      ].join('\n'),
      components: [],
    });
  } catch (error) {
    await interaction.update({
      content: `❌ ${error.message}`,
      components: [],
    });
  }

    return true;
}

    }

    // =========================
    // MODALS
    // =========================
    if (interaction.isModalSubmit()) {
      const denied = requireAdmin(interaction);
      if (denied) {
        await denied;
        return true;
      }

      if (interaction.customId.startsWith('live_edit_team_modal:')) {
        const [, teamId] = interaction.customId.split(':');
        const team = findTeamById(teamId);

        if (!team) {
          await replyTemp(interaction, {
            content: '❌ Team nicht gefunden.',
          });
          return true;
        }

        const newClubNameRaw = interaction.fields.getTextInputValue('new_club_name').trim();
        const newManagerIdRaw = interaction.fields.getTextInputValue('new_manager_id').trim();
        const newLogoFileRaw = interaction.fields.getTextInputValue('new_logo_file').trim();

        try {
          const updatedTeam = updateRegisteredTeam({
            teamId,
            newClubName: newClubNameRaw || null,
            newManagerId: newManagerIdRaw || null,
            newLogoFile: newLogoFileRaw === '' ? null : newLogoFileRaw,
          });

          await refreshRegisteredTeamsSafe(interaction.guild);
          await logToLive(`✏️ Team bearbeitet: ${team.clubName} → ${updatedTeam.clubName}`);

          await replyTemp(interaction, {
            content: [
              `✅ Team erfolgreich bearbeitet.`,
              `**Name:** ${safeText(updatedTeam.clubName)}`,
              `**Manager:** ${formatUserMention(updatedTeam.managerId)}`,
              `**Co-Manager:** ${
                Array.isArray(updatedTeam.coManagerIds) && updatedTeam.coManagerIds.length
                  ? updatedTeam.coManagerIds.map(formatUserMention).join(', ')
                  : '—'
              }`,
              `**Logo:** ${safeText(updatedTeam.logoFile)}`,
            ].join('\n'),
            allowedMentions: { parse: ['users'] },
          });
        } catch (error) {
          await replyTemp(interaction, {
            content: `❌ ${error.message}`,
          });
        }

        return true;
      }

      if (interaction.customId.startsWith('live_group_result_modal:')) {
        const [, eventKey, groupLetter, matchNumber] = interaction.customId.split(':');
        const homeGoals = interaction.fields.getTextInputValue('home_goals').trim();
        const awayGoals = interaction.fields.getTextInputValue('away_goals').trim();

        if (!/^\d+$/.test(homeGoals) || !/^\d+$/.test(awayGoals)) {
          await replyTemp(interaction, {
            content: '❌ Bitte nur ganze Zahlen eingeben.',
          });
          return true;
        }

        try {
          await manualSetGroupResult(
            eventKey,
            groupLetter,
            matchNumber,
            homeGoals,
            awayGoals
          );

          await replyTemp(interaction, {
            content: `✅ Gruppenergebnis manuell gesetzt: ${homeGoals}:${awayGoals}`,
          });
        } catch (error) {
          await replyTemp(interaction, {
            content: `❌ ${error.message}`,
          });
        }

        return true;
      }

      if (interaction.customId.startsWith('live_ko_result_modal:')) {
        const [, eventKey, roundKey, matchNumber] = interaction.customId.split(':');
        const homeGoals = interaction.fields.getTextInputValue('home_goals').trim();
        const awayGoals = interaction.fields.getTextInputValue('away_goals').trim();

        if (!/^\d+$/.test(homeGoals) || !/^\d+$/.test(awayGoals)) {
          await replyTemp(interaction, {
            content: '❌ Bitte nur ganze Zahlen eingeben.',
          });
          return true;
        }

        try {
          await manualSetKoResult(
            eventKey,
            roundKey,
            matchNumber,
            homeGoals,
            awayGoals
          );

          await replyTemp(interaction, {
            content: `✅ K.O.-Ergebnis manuell gesetzt: ${homeGoals}:${awayGoals}`,
          });
        } catch (error) {
          await replyTemp(interaction, {
            content: `❌ ${error.message}`,
          });
        }

        return true;
      }
    }

    return false;
  },

  async handleMessage() {
    return false;
  },
};