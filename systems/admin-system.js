const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');
const ADMIN_FILE = path.join(process.cwd(), 'data', 'admin-system.json');
const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');
const RESULTS_FILE = path.join(process.cwd(), 'data', 'results.json');
const KO_FILE = path.join(process.cwd(), 'data', 'ko.json');

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

async function replyTemp(interaction, payload, deleteAfterMs = 4000) {
  const response = await interaction.reply({
    ...payload,
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  }).catch(async () => {
    return interaction.followUp({
      ...payload,
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });
  });

  if (!response) return;

  setTimeout(async () => {
    try {
      if (interaction.channel) {
        const msg = await interaction.channel.messages.fetch(response.id).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    } catch {}
  }, deleteAfterMs);
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
        '• Teams anzeigen',
        '• Teamdetails ansehen',
        '• Team bearbeiten',
        '• Registriertes Team löschen',
        '• Quick Delete über Auswahlmenü',
        '• Backup / Team nachrücken',
        '• Gruppenergebnis manuell setzen',
        '• K.O.-Ergebnis manuell setzen',
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
      .setCustomId('live_quick_delete_team')
      .setLabel('⚡ Quick Delete')
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
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3];
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
  return loadTeams().find(t => t.id === teamId) || null;
}

function findTeamByClubName(clubName) {
  return loadTeams().find(
    t => t.clubName.toLowerCase() === clubName.toLowerCase()
  ) || null;
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
      return `**${index * 10 + i + 1}. ${safeText(team.clubName)}**\nManager: \`${safeText(team.managerId)}\``;
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
  const coManagers = Array.isArray(team.coManagerIds) && team.coManagerIds.length
    ? team.coManagerIds.join(', ')
    : '—';

  return new EmbedBuilder()
    .setTitle(`🔎 ${safeText(team.clubName)}`)
    .setDescription(
      [
        `**Team-ID:** \`${safeText(team.id)}\``,
        `**Manager:** \`${safeText(team.managerId)}\``,
        `**Co-Manager:** ${coManagers}`,
        `**Logo:** ${safeText(team.logoFile)}`,
        `**Erstellt:** ${safeText(team.createdAt)}`,
        `**Aktualisiert:** ${safeText(team.updatedAt)}`,
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildTeamSelect(customId, placeholder = 'Team auswählen') {
  const teams = getLiveTeams();

  if (!teams.length) return null;

  const limited = teams.slice(0, 25);

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(
        limited.map(team => ({
          label: team.clubName.slice(0, 100),
          value: team.id,
          description: `Manager: ${safeText(team.managerId).slice(0, 80)}`,
        }))
      )
  );
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

function updateRegisteredTeam({
  teamId,
  newClubName,
  newManagerId,
  newCoManagerIds,
  newLogoFile,
}) {
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
    team.managerId = newManagerId;
  }

  if (newCoManagerIds !== null) {
    team.coManagerIds = newCoManagerIds;
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

async function promoteBackupSwap(eventKey, outgoingClubName, incomingClubName) {
  const checkins = loadCheckins();
  const event = checkins[eventKey];

  if (!event) {
    throw new Error('Check-in Event nicht gefunden.');
  }

  const actualFormat = getActualFormat(event.teams.length);
  if (!actualFormat) {
    throw new Error('Für dieses Event gibt es aktuell kein gültiges Turnierformat.');
  }

  const participantIndex = event.teams.findIndex(
    team => team.clubName.toLowerCase() === outgoingClubName.toLowerCase()
  );

  const backupIndex = event.teams.findIndex(
    team => team.clubName.toLowerCase() === incomingClubName.toLowerCase()
  );

  if (participantIndex === -1) {
    throw new Error('Das rauszunehmende Team wurde nicht gefunden.');
  }

  if (backupIndex === -1) {
    throw new Error('Das nachrückende Backup-Team wurde nicht gefunden.');
  }

  if (participantIndex >= actualFormat) {
    throw new Error('Das rauszunehmende Team ist aktuell gar nicht teilnahmeberechtigt.');
  }

  if (backupIndex < actualFormat) {
    throw new Error('Das nachrückende Team ist aktuell kein Backup.');
  }

  const participant = event.teams[participantIndex];
  const backup = event.teams[backupIndex];

  event.teams[participantIndex] = backup;
  event.teams[backupIndex] = participant;

  saveCheckins(checkins);
  await logToLive(`🔁 Manuelles Nachrücken: ${backup.clubName} rückt nach, ${participant.clubName} geht auf Backup.`);
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

  if (!groupMeta || !resultGroup) return;

  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) return;

  const newRows = recalculateRows(groupMeta.rows, resultGroup.matches);
  groupsData[eventKey].groups[groupLetter].rows = newRows;
  saveGroups(groupsData);

  const tableMessage = await fetchMessage(channel, groupMeta.tableMessageId);
  if (tableMessage) {
    await tableMessage.edit({
      embeds: [buildGroupTableEmbed(groupsData[eventKey].label, groupLetter, newRows)],
    });
  }

  const scheduleMessage = await fetchMessage(channel, resultGroup.scheduleMessageId);
  if (scheduleMessage) {
    await scheduleMessage.edit({
      embeds: [buildGroupScheduleEmbed(groupsData[eventKey].label, groupLetter, resultGroup.matches)],
      components: [buildGroupScheduleButtons(eventKey, groupLetter)],
    });
  }
}

async function manualSetGroupResult(eventKey, groupLetter, matchNumber, homeGoals, awayGoals) {
  const resultsData = loadResults();
  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];

  if (!resultGroup) {
    throw new Error('Gruppenspiel nicht gefunden.');
  }

  const match = resultGroup.matches.find(m => m.matchNumber === Number(matchNumber));
  if (!match) {
    throw new Error('Match nicht gefunden.');
  }

  match.status = 'confirmed';
  match.reportedByTeamId = 'admin-manual';
  match.reportedScore = {
    home: Number(homeGoals),
    away: Number(awayGoals),
  };
  match.confirmed = true;

  saveResults(resultsData);
  await updateLiveGroupMessages(eventKey, groupLetter);
  await logToLive(`✏️ Admin-Korrektur Gruppe ${groupLetter}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`);
}

function getRoundLabel(roundKey) {
  if (roundKey === 'roundOf16') return 'Achtelfinale';
  if (roundKey === 'quarterFinal') return 'Viertelfinale';
  if (roundKey === 'semiFinal') return 'Halbfinale';
  if (roundKey === 'thirdPlace') return 'Spiel um Platz 3';
  if (roundKey === 'final') return 'Finale';
  return 'K.O.-Phase';
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

  match.status = 'confirmed';
  match.reportedByTeamId = 'admin-manual';
  match.reportedScore = {
    home: Number(homeGoals),
    away: Number(awayGoals),
  };
  match.confirmed = true;

  if (Number(homeGoals) > Number(awayGoals)) {
    match.winnerTeamId = match.homeTeamId;
    match.loserTeamId = match.awayTeamId;
  } else {
    match.winnerTeamId = match.awayTeamId;
    match.loserTeamId = match.homeTeamId;
  }

  saveKo(koData);
  await updateLiveKoRoundMessage(eventKey, roundKey);
  await logToLive(`✏️ Admin-Korrektur ${getRoundLabel(roundKey)}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`);
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

// =========================
// INIT
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
      const allButtons = [
        'live_show_teams',
        'live_team_details',
        'live_edit_team',
        'live_delete_team',
        'live_quick_delete_team',
        'live_manual_backup',
        'live_manual_group_result',
        'live_manual_ko_result',
      ];

      if (!allButtons.includes(interaction.customId)) return false;

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
        });
        return true;
      }

      if (interaction.customId === 'live_team_details') {
        const row = buildTeamSelect('live_team_details_select', 'Team für Details auswählen');

        if (!row) {
          await replyTemp(interaction, {
            content: '❌ Aktuell sind keine Teams registriert.',
          });
          return true;
        }

        await interaction.reply({
          content: '🔎 Wähle ein Team aus.',
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (interaction.customId === 'live_quick_delete_team') {
        const row = buildTeamSelect('live_quick_delete_team_select', 'Team zum Löschen auswählen');

        if (!row) {
          await replyTemp(interaction, {
            content: '❌ Aktuell sind keine Teams registriert.',
          });
          return true;
        }

        await interaction.reply({
          content: '⚡ Wähle ein Team aus, das direkt gelöscht werden soll.',
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (interaction.customId === 'live_edit_team') {
        const row = buildTeamSelect('live_edit_team_select', 'Team zum Bearbeiten auswählen');

        if (!row) {
          await replyTemp(interaction, {
            content: '❌ Aktuell sind keine Teams registriert.',
          });
          return true;
        }

        await interaction.reply({
          content: '✏️ Wähle ein Team aus, das du bearbeiten willst.',
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (interaction.customId === 'live_delete_team') {
        const modal = new ModalBuilder()
          .setCustomId('live_delete_team_modal')
          .setTitle('Registriertes Team löschen');

        const teamInput = new TextInputBuilder()
          .setCustomId('club_name')
          .setLabel('Exakter Teamname')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. Loco Squad');

        modal.addComponents(
          new ActionRowBuilder().addComponents(teamInput)
        );

        await interaction.showModal(modal);
        return true;
      }

      if (interaction.customId === 'live_manual_backup') {
        const modal = new ModalBuilder()
          .setCustomId('live_backup_modal')
          .setTitle('Team / Backup nachrücken');

        const eventInput = new TextInputBuilder()
          .setCustomId('event_key')
          .setLabel('Event (friday oder saturday)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('friday');

        const outgoingInput = new TextInputBuilder()
          .setCustomId('outgoing_team')
          .setLabel('Teilnehmendes Team, das raus soll')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. Team A');

        const incomingInput = new TextInputBuilder()
          .setCustomId('incoming_team')
          .setLabel('Backup-Team, das nachrücken soll')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. Team B');

        modal.addComponents(
          new ActionRowBuilder().addComponents(eventInput),
          new ActionRowBuilder().addComponents(outgoingInput),
          new ActionRowBuilder().addComponents(incomingInput)
        );

        await interaction.showModal(modal);
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

      if (interaction.customId === 'live_manual_ko_result') {
        await interaction.reply({
          content: 'Für welches Event willst du ein K.O.-Ergebnis manuell setzen?',
          components: [buildEventSelect('live_pick_ko_event')],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
    }

    // =========================
    // SELECT MENUS
    // =========================
    if (interaction.isStringSelectMenu()) {
      const denied = requireAdmin(interaction);
      if (denied) {
        await denied;
        return true;
      }

      if (interaction.customId === 'live_team_details_select') {
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
        });
        return true;
      }

      if (interaction.customId === 'live_quick_delete_team_select') {
        const teamId = interaction.values[0];

        try {
          const deletedTeam = await deleteRegisteredTeam(teamId);
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

      if (interaction.customId === 'live_edit_team_select') {
        const teamId = interaction.values[0];
        const team = findTeamById(teamId);

        if (!team) {
          await interaction.update({
            content: '❌ Team nicht gefunden.',
            components: [],
          });
          return true;
        }

        const modal = new ModalBuilder()
          .setCustomId(`live_edit_team_modal:${teamId}`)
          .setTitle('Registriertes Team bearbeiten');

        const newClubNameInput = new TextInputBuilder()
          .setCustomId('new_club_name')
          .setLabel('Neuer Teamname (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(team.clubName?.slice(0, 100) || '');

        const managerIdInput = new TextInputBuilder()
          .setCustomId('new_manager_id')
          .setLabel('Neue Manager ID (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(team.managerId ? String(team.managerId).slice(0, 100) : '');

        const coManagerIdsInput = new TextInputBuilder()
          .setCustomId('new_co_manager_ids')
          .setLabel('Co-Manager IDs, Komma getrennt')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(
            Array.isArray(team.coManagerIds) && team.coManagerIds.length
              ? team.coManagerIds.join(', ')
              : ''
          );

        const logoFileInput = new TextInputBuilder()
          .setCustomId('new_logo_file')
          .setLabel('Logo-Dateiname')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(team.logoFile ? String(team.logoFile).slice(0, 100) : '');

        modal.addComponents(
          new ActionRowBuilder().addComponents(newClubNameInput),
          new ActionRowBuilder().addComponents(managerIdInput),
          new ActionRowBuilder().addComponents(coManagerIdsInput),
          new ActionRowBuilder().addComponents(logoFileInput)
        );

        await interaction.showModal(modal);
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
                label: `${match.homeClubName} vs ${match.awayClubName}`,
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
          .setLabel(`Tore ${match.homeClubName}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. 3');

        const awayInput = new TextInputBuilder()
          .setCustomId('away_goals')
          .setLabel(`Tore ${match.awayClubName}`)
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
                label: `${match.homeClubName} vs ${match.awayClubName}`,
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
          .setLabel(`Tore ${match.homeClubName}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('z. B. 3');

        const awayInput = new TextInputBuilder()
          .setCustomId('away_goals')
          .setLabel(`Tore ${match.awayClubName}`)
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

      if (interaction.customId === 'live_backup_modal') {
        const eventKey = interaction.fields.getTextInputValue('event_key').trim().toLowerCase();
        const outgoingTeam = interaction.fields.getTextInputValue('outgoing_team').trim();
        const incomingTeam = interaction.fields.getTextInputValue('incoming_team').trim();

        try {
          await promoteBackupSwap(eventKey, outgoingTeam, incomingTeam);

          await replyTemp(interaction, {
            content: `✅ Backup-Swap durchgeführt.\nRaus: **${outgoingTeam}**\nRein: **${incomingTeam}**`,
          });
        } catch (error) {
          await replyTemp(interaction, {
            content: `❌ ${error.message}`,
          });
        }

        return true;
      }

      if (interaction.customId === 'live_delete_team_modal') {
        const clubName = interaction.fields.getTextInputValue('club_name').trim();

        try {
          const team = findTeamByClubName(clubName);
          if (!team) {
            throw new Error('Team nicht gefunden.');
          }

          const deletedTeam = await deleteRegisteredTeam(team.id);
          await replyTemp(interaction, {
            content: `✅ Team gelöscht: **${deletedTeam.clubName}**`,
          });
        } catch (error) {
          await replyTemp(interaction, {
            content: `❌ ${error.message}`,
          });
        }

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
        const newCoManagerIdsRaw = interaction.fields.getTextInputValue('new_co_manager_ids').trim();
        const newLogoFileRaw = interaction.fields.getTextInputValue('new_logo_file').trim();

        const parsedCoManagerIds =
          newCoManagerIdsRaw === ''
            ? []
            : newCoManagerIdsRaw
                .split(',')
                .map(id => id.trim())
                .filter(Boolean);

        try {
          const updatedTeam = updateRegisteredTeam({
            teamId,
            newClubName: newClubNameRaw || null,
            newManagerId: newManagerIdRaw || null,
            newCoManagerIds: parsedCoManagerIds,
            newLogoFile: newLogoFileRaw === '' ? null : newLogoFileRaw,
          });

          await logToLive(`✏️ Team bearbeitet: ${team.clubName} → ${updatedTeam.clubName}`);

          await replyTemp(interaction, {
            content: [
              `✅ Team erfolgreich bearbeitet.`,
              `**Name:** ${safeText(updatedTeam.clubName)}`,
              `**Manager:** ${safeText(updatedTeam.managerId)}`,
              `**Co-Manager:** ${
                Array.isArray(updatedTeam.coManagerIds) && updatedTeam.coManagerIds.length
                  ? updatedTeam.coManagerIds.join(', ')
                  : '—'
              }`,
              `**Logo:** ${safeText(updatedTeam.logoFile)}`,
            ].join('\n'),
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