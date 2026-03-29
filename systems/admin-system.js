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
const TEST_FILE = path.join(process.cwd(), 'data', 'test-state.json');
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
    testControlPanelMessageId: null,
    liveControlPanelMessageId: null,
  });
}
function saveAdminState(data) {
  writeJson(ADMIN_FILE, data);
}

function loadTestState() {
  return readJson(TEST_FILE, {
    active: false,
    format: null,
    teamIds: [],
    createdMessageIds: [],
    createdAt: null,
  });
}
function saveTestState(data) {
  writeJson(TEST_FILE, data);
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

async function deleteMessageIfExists(channelId, messageId) {
  if (!channelId || !messageId) return;

  const channel = await fetchChannel(channelId);
  if (!channel) return;

  const message = await fetchMessage(channel, messageId);
  if (!message) return;

  try {
    await message.delete();
  } catch {}
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

async function logToTest(text) {
  await logToChannel(process.env.TEST_LOGS_CHANNEL_ID, text);
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.clubName.localeCompare(b.clubName, 'de');
  });
}

// =========================
// TEST PANEL
// =========================

function buildTestControlEmbed(testState) {
  const status = testState.active
    ? `🟢 Aktiv (${testState.format}er Testlauf)`
    : '⚪ Kein aktiver Testlauf';

  return new EmbedBuilder()
    .setTitle('🧪 Test Lab Steuerung')
    .setDescription(
      [
        `**Status:** ${status}`,
        '',
        '**Testlauf starten:**',
        '• 8er',
        '• 16er',
        '• 24er',
        '• 32er',
        '',
        '**Admin-Aktionen:**',
        '• Backup / Team nachrücken',
        '• Gruppenergebnis manuell setzen',
        '• K.O.-Ergebnis manuell setzen',
        '• Test komplett löschen',
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildTestControlRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_test_start_8')
      .setLabel('8er Test')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_test_start_16')
      .setLabel('16er Test')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_test_start_24')
      .setLabel('24er Test')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_test_start_32')
      .setLabel('32er Test')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_manual_backup')
      .setLabel('🔁 Team/Backup nachrücken')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_manual_group_result')
      .setLabel('🏆 Gruppenergebnis setzen')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('admin_manual_ko_result')
      .setLabel('🏁 K.O.-Ergebnis setzen')
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_test_delete')
      .setLabel('🗑️ Test komplett löschen')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3];
}

async function ensureTestControlPanel() {
  const channelId = process.env.TEST_CONTROL_CHANNEL_ID;
  if (!channelId) return;

  const channel = await fetchChannel(channelId);
  if (!channel) return;

  const adminState = loadAdminState();
  const testState = loadTestState();

  let message = null;
  if (adminState.testControlPanelMessageId) {
    message = await fetchMessage(channel, adminState.testControlPanelMessageId);
  }

  if (!message) {
    const created = await channel.send({
      embeds: [buildTestControlEmbed(testState)],
      components: buildTestControlRows(),
    });

    adminState.testControlPanelMessageId = created.id;
    saveAdminState(adminState);
    return;
  }

  await message.edit({
    embeds: [buildTestControlEmbed(testState)],
    components: buildTestControlRows(),
  });
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
        '• Registriertes Team löschen',
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
      .setCustomId('live_delete_team')
      .setLabel('🗑️ Registriertes Team löschen')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('live_manual_backup')
      .setLabel('🔁 Team/Backup nachrücken')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('live_manual_group_result')
      .setLabel('🏆 Gruppenergebnis setzen')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('live_manual_ko_result')
      .setLabel('🏁 K.O.-Ergebnis setzen')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
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
// TEST HELPERS
// =========================

function createTestTeams(format) {
  const teams = [];
  for (let i = 1; i <= format; i++) {
    teams.push({
      id: `test_team_${Date.now()}_${i}`,
      clubName: `Test Team ${i}`,
      managerId: process.env.ADMIN_ROLE_ID || 'test-admin',
      coManagerIds: [],
      logoFile: null,
      isTest: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return teams;
}

function getTestChannelIds() {
  return [
    process.env.TEST_CONTROL_CHANNEL_ID,
    process.env.TEST_CHECKIN_CHANNEL_ID,
    process.env.TEST_GROUP_A_CHANNEL_ID,
    process.env.TEST_GROUP_B_CHANNEL_ID,
    process.env.TEST_GROUP_C_CHANNEL_ID,
    process.env.TEST_GROUP_D_CHANNEL_ID,
    process.env.TEST_GROUP_E_CHANNEL_ID,
    process.env.TEST_GROUP_F_CHANNEL_ID,
    process.env.TEST_GROUP_G_CHANNEL_ID,
    process.env.TEST_GROUP_H_CHANNEL_ID,
    process.env.TEST_ROUND_OF_16_CHANNEL_ID,
    process.env.TEST_QUARTERFINAL_CHANNEL_ID,
    process.env.TEST_SEMIFINAL_CHANNEL_ID,
    process.env.TEST_THIRD_PLACE_CHANNEL_ID,
    process.env.TEST_FINAL_CHANNEL_ID,
    process.env.TEST_RESULT_CHECK_CHANNEL_ID,
    process.env.TEST_LOGS_CHANNEL_ID,
  ].filter(Boolean);
}

async function clearTestChannelMessages() {
  const channelIds = getTestChannelIds();

  for (const channelId of channelIds) {
    const channel = await fetchChannel(channelId);
    if (!channel) continue;

    try {
      const messages = await channel.messages.fetch({ limit: 100 });

      for (const msg of messages.values()) {
        if (msg.author?.id === clientRef.user.id) {
          try {
            await msg.delete();
          } catch {}
        }
      }
    } catch (error) {
      console.error(`❌ Fehler beim Leeren von Kanal ${channelId}:`, error);
    }
  }
}

async function startTestRun(format) {
  const teams = loadTeams();
  const filteredTeams = teams.filter(team => !team.isTest);
  const newTestTeams = createTestTeams(format);
  saveTeams([...filteredTeams, ...newTestTeams]);

  saveTestState({
    active: true,
    format,
    teamIds: newTestTeams.map(t => t.id),
    createdMessageIds: [],
    createdAt: new Date().toISOString(),
    generated: false,
    label: null,
    checkinMessageId: null,
    groups: {},
    ko: { rounds: {} },
  });

  const checkinChannel = await fetchChannel(process.env.TEST_CHECKIN_CHANNEL_ID);
  if (checkinChannel) {
    await checkinChannel.send({
      content: `🧪 ${format}er Testlauf gestartet`,
    });
  }

  await logToTest(`🧪 ${format}er Testlauf gestartet.`);
  await ensureTestControlPanel();
}

async function deleteTestRun() {
  const teams = loadTeams();
  saveTeams(teams.filter(team => !team.isTest));

  saveTestState({
    active: false,
    format: null,
    teamIds: [],
    createdMessageIds: [],
    createdAt: null,
    generated: false,
    label: null,
    checkinMessageId: null,
    groups: {},
    ko: { rounds: {} },
  });

  await clearTestChannelMessages();
  await logToTest('🗑️ Testlauf komplett gelöscht.');
  await ensureTestControlPanel();
}

// =========================
// SHARED RENDER HELPERS
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
// LIVE DATA OPERATIONS
// =========================

function getActualFormat(teamCount) {
  if (teamCount < 8) return 0;
  if (teamCount < 16) return 8;
  if (teamCount < 24) return 16;
  if (teamCount < 32) return 24;
  return 32;
}

async function deleteRegisteredTeam(clubName) {
  const teams = loadTeams();
  const checkins = loadCheckins();
  const groups = loadGroups();
  const results = loadResults();
  const ko = loadKo();

  const team = teams.find(t => t.clubName.toLowerCase() === clubName.toLowerCase());
  if (!team) {
    throw new Error('Team nicht gefunden.');
  }

  const teamId = team.id;

  // teams.json
  saveTeams(teams.filter(t => t.id !== teamId));

  // checkins.json
  for (const eventKey of ['friday', 'saturday']) {
    const event = checkins[eventKey];
    if (!event) continue;

    event.teams = (event.teams || []).filter(t => t.teamId !== teamId && t.id !== teamId);
    if (event.backupDecisions && event.backupDecisions[teamId]) {
      delete event.backupDecisions[teamId];
    }
  }
  saveCheckins(checkins);

  // groups.json
  for (const eventKey of ['friday', 'saturday']) {
    const event = groups[eventKey];
    if (!event?.groups) continue;

    for (const letter of Object.keys(event.groups)) {
      const group = event.groups[letter];
      group.teams = (group.teams || []).filter(t => t.teamId !== teamId);
      group.rows = (group.rows || []).filter(r => r.teamId !== teamId);
    }
  }
  saveGroups(groups);

  // results.json
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

  // ko.json
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
}

async function promoteBackupSwap(eventKey, outgoingClubName, incomingClubName, isTest = false) {
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

  if (isTest) {
    await logToTest(`🔁 Manuelles Nachrücken: ${backup.clubName} rückt nach, ${participant.clubName} geht auf Backup.`);
  } else {
    await logToLive(`🔁 Manuelles Nachrücken: ${backup.clubName} rückt nach, ${participant.clubName} geht auf Backup.`);
  }
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

async function manualSetGroupResult(eventKey, groupLetter, matchNumber, homeGoals, awayGoals, isTest = false) {
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

  if (isTest) {
    await logToTest(`✏️ Admin-Korrektur Gruppe ${groupLetter}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`);
  } else {
    await logToLive(`✏️ Admin-Korrektur Gruppe ${groupLetter}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`);
  }
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

async function manualSetKoResult(eventKey, roundKey, matchNumber, homeGoals, awayGoals, isTest = false) {
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

  if (isTest) {
    await logToTest(`✏️ Admin-Korrektur ${getRoundLabel(roundKey)}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`);
  } else {
    await logToLive(`✏️ Admin-Korrektur ${getRoundLabel(roundKey)}: ${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}`);
  }
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
      testControlPanelMessageId: null,
      liveControlPanelMessageId: null,
    });
    ensureFile(TEST_FILE, {
      active: false,
      format: null,
      teamIds: [],
      createdMessageIds: [],
      createdAt: null,
    });

    await ensureTestControlPanel();
    await ensureLiveControlPanel();
  },

  async handleInteraction(interaction) {
    // =========================
    // BUTTONS
    // =========================
    if (interaction.isButton()) {
      const allButtons = [
        'admin_test_start_8',
        'admin_test_start_16',
        'admin_test_start_24',
        'admin_test_start_32',
        'admin_test_delete',
        'admin_manual_backup',
        'admin_manual_group_result',
        'admin_manual_ko_result',
        'live_delete_team',
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

      // TEST
      if (interaction.customId === 'admin_test_start_8') {
        await startTestRun(8);
        await interaction.reply({ content: '✅ 8er Testlauf gestartet.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.customId === 'admin_test_start_16') {
        await startTestRun(16);
        await interaction.reply({ content: '✅ 16er Testlauf gestartet.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.customId === 'admin_test_start_24') {
        await startTestRun(24);
        await interaction.reply({ content: '✅ 24er Testlauf gestartet.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.customId === 'admin_test_start_32') {
        await startTestRun(32);
        await interaction.reply({ content: '✅ 32er Testlauf gestartet.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.customId === 'admin_test_delete') {
        await deleteTestRun();
        await interaction.reply({ content: '✅ Testlauf komplett gelöscht.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (interaction.customId === 'admin_manual_backup' || interaction.customId === 'live_manual_backup') {
        const modal = new ModalBuilder()
          .setCustomId(
            interaction.customId === 'admin_manual_backup'
              ? 'admin_backup_modal'
              : 'live_backup_modal'
          )
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

      if (interaction.customId === 'admin_manual_group_result' || interaction.customId === 'live_manual_group_result') {
        await interaction.reply({
          content: 'Für welches Event willst du ein Gruppenergebnis manuell setzen?',
          components: [buildEventSelect(
            interaction.customId === 'admin_manual_group_result'
              ? 'admin_pick_group_event'
              : 'live_pick_group_event'
          )],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (interaction.customId === 'admin_manual_ko_result' || interaction.customId === 'live_manual_ko_result') {
        await interaction.reply({
          content: 'Für welches Event willst du ein K.O.-Ergebnis manuell setzen?',
          components: [buildEventSelect(
            interaction.customId === 'admin_manual_ko_result'
              ? 'admin_pick_ko_event'
              : 'live_pick_ko_event'
          )],
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

      // TEST GROUP RESULT
      if (interaction.customId === 'admin_pick_group_event' || interaction.customId === 'live_pick_group_event') {
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

        const isTest = interaction.customId === 'admin_pick_group_event';
        const groupOptions = Object.keys(event.groups).map(letter => ({
          label: `Gruppe ${letter}`,
          value: letter,
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${isTest ? 'admin' : 'live'}_pick_group_letter:${eventKey}`)
            .setPlaceholder('Gruppe auswählen')
            .addOptions(groupOptions)
        );

        await interaction.update({
          content: `Event **${eventKey}** gewählt. Wähle jetzt die Gruppe aus.`,
          components: [row],
        });
        return true;
      }

      if (
        interaction.customId.startsWith('admin_pick_group_letter:') ||
        interaction.customId.startsWith('live_pick_group_letter:')
      ) {
        const [prefix, eventKey] = interaction.customId.split(':');
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
            .setCustomId(`${prefix.replace('letter', 'match')}:${eventKey}:${groupLetter}`)
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

      if (
        interaction.customId.startsWith('admin_pick_group_match:') ||
        interaction.customId.startsWith('live_pick_group_match:')
      ) {
        const [prefix, eventKey, groupLetter] = interaction.customId.split(':');
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
          .setCustomId(
            `${prefix.startsWith('admin') ? 'admin' : 'live'}_group_result_modal:${eventKey}:${groupLetter}:${matchNumber}`
          )
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

      // K.O.
      if (interaction.customId === 'admin_pick_ko_event' || interaction.customId === 'live_pick_ko_event') {
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

        const isTest = interaction.customId === 'admin_pick_ko_event';
        const roundOptions = Object.keys(event.rounds).map(roundKey => ({
          label: getRoundLabel(roundKey),
          value: roundKey,
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${isTest ? 'admin' : 'live'}_pick_ko_round:${eventKey}`)
            .setPlaceholder('K.O.-Runde auswählen')
            .addOptions(roundOptions)
        );

        await interaction.update({
          content: `Event **${eventKey}** gewählt. Wähle jetzt die K.O.-Runde aus.`,
          components: [row],
        });
        return true;
      }

      if (
        interaction.customId.startsWith('admin_pick_ko_round:') ||
        interaction.customId.startsWith('live_pick_ko_round:')
      ) {
        const [prefix, eventKey] = interaction.customId.split(':');
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
            .setCustomId(`${prefix.replace('round', 'match')}:${eventKey}:${roundKey}`)
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

      if (
        interaction.customId.startsWith('admin_pick_ko_match:') ||
        interaction.customId.startsWith('live_pick_ko_match:')
      ) {
        const [prefix, eventKey, roundKey] = interaction.customId.split(':');
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
          .setCustomId(
            `${prefix.startsWith('admin') ? 'admin' : 'live'}_ko_result_modal:${eventKey}:${roundKey}:${matchNumber}`
          )
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

      if (interaction.customId === 'admin_backup_modal' || interaction.customId === 'live_backup_modal') {
        const eventKey = interaction.fields.getTextInputValue('event_key').trim().toLowerCase();
        const outgoingTeam = interaction.fields.getTextInputValue('outgoing_team').trim();
        const incomingTeam = interaction.fields.getTextInputValue('incoming_team').trim();

        try {
          await promoteBackupSwap(
            eventKey,
            outgoingTeam,
            incomingTeam,
            interaction.customId === 'admin_backup_modal'
          );

          await interaction.reply({
            content: `✅ Backup-Swap durchgeführt.\nRaus: **${outgoingTeam}**\nRein: **${incomingTeam}**`,
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

      if (interaction.customId === 'live_delete_team_modal') {
        const clubName = interaction.fields.getTextInputValue('club_name').trim();

        try {
          await deleteRegisteredTeam(clubName);
          await interaction.reply({
            content: `✅ Team gelöscht: **${clubName}**`,
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

      if (
        interaction.customId.startsWith('admin_group_result_modal:') ||
        interaction.customId.startsWith('live_group_result_modal:')
      ) {
        const [, eventKey, groupLetter, matchNumber] = interaction.customId.split(':');
        const homeGoals = interaction.fields.getTextInputValue('home_goals').trim();
        const awayGoals = interaction.fields.getTextInputValue('away_goals').trim();

        if (!/^\d+$/.test(homeGoals) || !/^\d+$/.test(awayGoals)) {
          await interaction.reply({
            content: '❌ Bitte nur ganze Zahlen eingeben.',
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }

        try {
          await manualSetGroupResult(
            eventKey,
            groupLetter,
            matchNumber,
            homeGoals,
            awayGoals,
            interaction.customId.startsWith('admin_')
          );

          await interaction.reply({
            content: `✅ Gruppenergebnis manuell gesetzt: ${homeGoals}:${awayGoals}`,
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

      if (
        interaction.customId.startsWith('admin_ko_result_modal:') ||
        interaction.customId.startsWith('live_ko_result_modal:')
      ) {
        const [, eventKey, roundKey, matchNumber] = interaction.customId.split(':');
        const homeGoals = interaction.fields.getTextInputValue('home_goals').trim();
        const awayGoals = interaction.fields.getTextInputValue('away_goals').trim();

        if (!/^\d+$/.test(homeGoals) || !/^\d+$/.test(awayGoals)) {
          await interaction.reply({
            content: '❌ Bitte nur ganze Zahlen eingeben.',
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }

        try {
          await manualSetKoResult(
            eventKey,
            roundKey,
            matchNumber,
            homeGoals,
            awayGoals,
            interaction.customId.startsWith('admin_')
          );

          await interaction.reply({
            content: `✅ K.O.-Ergebnis manuell gesetzt: ${homeGoals}:${awayGoals}`,
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
    }

    return false;
  },

  async handleMessage() {
    return false;
  },
};