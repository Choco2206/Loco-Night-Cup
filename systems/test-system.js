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
const TEST_FILE = path.join(process.cwd(), 'data', 'test-state.json');

let clientRef = null;
let intervalRef = null;

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

function loadTestState() {
  return readJson(TEST_FILE, {
    active: false,
    format: null,
    teamIds: [],
    createdMessageIds: [],
    createdAt: null,
    generated: false,
    label: null,
    checkinMessageId: null,
    groups: {},
    ko: {
      rounds: {},
    },
  });
}

function saveTestState(data) {
  writeJson(TEST_FILE, data);
}

// =========================
// HELPERS
// =========================

function isAdminMember(member) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (!adminRoleId) return false;
  return member?.roles?.cache?.has(adminRoleId) || false;
}

function getTestTeamsFromState() {
  const teams = loadTeams();
  const testState = loadTestState();

  return teams.filter(team => team.isTest && testState.teamIds.includes(team.id));
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

function getGroupLetters(format) {
  if (format === 8) return ['A', 'B'];
  if (format === 16) return ['A', 'B', 'C', 'D'];
  if (format === 24) return ['A', 'B', 'C', 'D', 'E', 'F'];
  if (format === 32) return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  return [];
}

function getGroupChannelId(letter) {
  return process.env[`TEST_GROUP_${letter}_CHANNEL_ID`] || null;
}

function getRoundChannelId(roundKey) {
  if (roundKey === 'roundOf16') return process.env.TEST_ROUND_OF_16_CHANNEL_ID;
  if (roundKey === 'quarterFinal') return process.env.TEST_QUARTERFINAL_CHANNEL_ID;
  if (roundKey === 'semiFinal') return process.env.TEST_SEMIFINAL_CHANNEL_ID;
  if (roundKey === 'thirdPlace') return process.env.TEST_THIRD_PLACE_CHANNEL_ID;
  if (roundKey === 'final') return process.env.TEST_FINAL_CHANNEL_ID;
  return null;
}

function getRoundLabel(roundKey) {
  if (roundKey === 'roundOf16') return 'Achtelfinale';
  if (roundKey === 'quarterFinal') return 'Viertelfinale';
  if (roundKey === 'semiFinal') return 'Halbfinale';
  if (roundKey === 'thirdPlace') return 'Spiel um Platz 3';
  if (roundKey === 'final') return 'Finale';
  return 'K.O.-Phase';
}

function getRoundTimeWindow(roundKey) {
  if (roundKey === 'roundOf16') return '01:00–01:05';
  if (roundKey === 'quarterFinal') return '01:20–01:25';
  if (roundKey === 'semiFinal') return '01:40–01:45';
  if (roundKey === 'thirdPlace') return '02:00–02:05';
  if (roundKey === 'final') return '02:00–02:05';
  return '01:00–01:05';
}

function shuffleArray(array) {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function cloneTeam(team) {
  return {
    teamId: team.id || team.teamId,
    clubName: team.clubName,
    managerId: team.managerId || null,
    coManagerIds: Array.isArray(team.coManagerIds) ? team.coManagerIds : [],
  };
}

// =========================
// CHECK-IN RENDER
// =========================

function getFormatExplanation(format) {
  if (format === 8) {
    return [
      '• 2 Gruppen à 4 Teams',
      '• Top 2 jeder Gruppe kommen weiter',
      '• K.O.-Phase startet ab dem Halbfinale',
    ].join('\n');
  }

  if (format === 16) {
    return [
      '• 4 Gruppen à 4 Teams',
      '• Top 2 jeder Gruppe kommen weiter',
      '• K.O.-Phase startet ab dem Viertelfinale',
    ].join('\n');
  }

  if (format === 24) {
    return [
      '• 6 Gruppen à 4 Teams',
      '• Top 2 jeder Gruppe kommen weiter',
      '• Plus die 4 besten Gruppendritten',
      '• K.O.-Phase startet ab dem Achtelfinale',
    ].join('\n');
  }

  if (format === 32) {
    return [
      '• 8 Gruppen à 4 Teams',
      '• Top 2 jeder Gruppe kommen weiter',
      '• K.O.-Phase startet ab dem Achtelfinale',
    ].join('\n');
  }

  return '• Kein gültiges Format';
}

function buildTestCheckinEmbed(format, teams) {
  return new EmbedBuilder()
    .setTitle(`🧪 Test Check-in • ${format}er Testlauf`)
    .setDescription(
      [
        `**Status:** Automatisch für den Testlauf erstellt`,
        `**Turnierformat:** ${format}er`,
        '',
        '**Format-Erklärung:**',
        getFormatExplanation(format),
        '',
        '**Eingecheckte Testteams:**',
        teams.map((team, index) => `${index + 1}. ${team.clubName}`).join('\n'),
      ].join('\n')
    )
    .setColor(0xff0000);
}

// =========================
// GROUPS
// =========================

function createInitialRows(teams) {
  return teams.map(team => ({
    teamId: team.teamId,
    clubName: team.clubName,
    managerId: team.managerId,
    coManagerIds: team.coManagerIds || [],
    s: 0,
    u: 0,
    n: 0,
    diff: 0,
    points: 0,
  }));
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.clubName.localeCompare(b.clubName, 'de');
  });
}

function buildTableText(rows) {
  const sortedRows = sortRows(rows);

  return sortedRows
    .map((row, index) => {
      return `**${index + 1}. ${row.clubName}**  •  S ${row.s}  •  U ${row.u}  •  N ${row.n}  •  Diff ${row.diff}  •  P ${row.points}`;
    })
    .join('\n');
}

function buildGroupTableEmbed(format, groupLetter, rows) {
  return new EmbedBuilder()
    .setTitle(`🏆 Test • ${format}er • Gruppe ${groupLetter}`)
    .setDescription(rows.length ? buildTableText(rows) : 'Noch keine Teams.')
    .setColor(0xff0000);
}

function buildGroupInfoText(groupLetter, teams) {
  const lines = teams.map(team => `• **${team.clubName}**`);
  return [
    `📣 **Ihr seid in Test-Gruppe ${groupLetter}**`,
    '',
    `Folgende Teams sind in Gruppe ${groupLetter}:`,
    ...lines,
  ].join('\n');
}

// =========================
// GROUP MATCHES
// =========================

function createRoundRobinMatches(teams) {
  if (!Array.isArray(teams) || teams.length !== 4) return [];

  const [t1, t2, t3, t4] = teams;

  return [
    { homeTeamId: t1.teamId, awayTeamId: t2.teamId },
    { homeTeamId: t3.teamId, awayTeamId: t4.teamId },

    { homeTeamId: t1.teamId, awayTeamId: t3.teamId },
    { homeTeamId: t2.teamId, awayTeamId: t4.teamId },

    { homeTeamId: t1.teamId, awayTeamId: t4.teamId },
    { homeTeamId: t2.teamId, awayTeamId: t3.teamId },
  ];
}

function getGroupMatchWindows() {
  return [
    '00:00–00:05',
    '00:00–00:05',
    '00:20–00:25',
    '00:20–00:25',
    '00:40–00:45',
    '00:40–00:45',
  ];
}

function createGroupMatches(groupLetter, teams) {
  const base = createRoundRobinMatches(teams);
  const windows = getGroupMatchWindows();

  return base.map((match, index) => {
    const home = teams.find(t => t.teamId === match.homeTeamId);
    const away = teams.find(t => t.teamId === match.awayTeamId);

    return {
      id: `${groupLetter}_match_${index + 1}`,
      groupLetter,
      matchNumber: index + 1,
      timeWindow: windows[index],
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      homeClubName: home.clubName,
      awayClubName: away.clubName,
      status: 'pending',
      reportedByTeamId: null,
      reportedScore: null,
      confirmed: false,
      confirmationMessageId: null,
    };
  });
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

function buildGroupScheduleEmbed(format, groupLetter, matches) {
  return new EmbedBuilder()
    .setTitle(`⚽ Test • ${format}er • Gruppe ${groupLetter} • Spielplan`)
    .setDescription(
      [
        'Ergebnisse werden über den Button darunter eingetragen.',
        '',
        buildGroupScheduleText(matches),
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildGroupScheduleButtons(groupLetter) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`test_group_result_open:${groupLetter}`)
      .setLabel('⚽ Test-Ergebnis eintragen')
      .setStyle(ButtonStyle.Primary)
  );
}

function recalculateGroupRows(rows, matches) {
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

// =========================
// K.O.
// =========================

function buildKoRoundEmbed(roundKey, matches) {
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
    .setTitle(`🏁 Test • ${getRoundLabel(roundKey)}`)
    .setDescription(
      [
        'Ergebnisse werden über den Button darunter eingetragen.',
        '',
        ...lines,
      ].join('\n\n')
    )
    .setColor(0xff0000);
}

function buildKoRoundButtons(roundKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`test_ko_result_open:${roundKey}`)
      .setLabel('⚽ Test-Ergebnis eintragen')
      .setStyle(ButtonStyle.Primary)
  );
}

function createKoMatches(roundKey, pairs) {
  const timeWindow = getRoundTimeWindow(roundKey);

  return pairs.map((pair, index) => {
    const [home, away] = pair;

    return {
      id: `${roundKey}_match_${index + 1}`,
      roundKey,
      matchNumber: index + 1,
      timeWindow,
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      homeClubName: home.clubName,
      awayClubName: away.clubName,
      homeManagerId: home.managerId,
      awayManagerId: away.managerId,
      homeCoManagerIds: home.coManagerIds || [],
      awayCoManagerIds: away.coManagerIds || [],
      status: 'pending',
      reportedByTeamId: null,
      reportedScore: null,
      confirmed: false,
      confirmationMessageId: null,
      winnerTeamId: null,
      loserTeamId: null,
    };
  });
}

function roundIsComplete(roundData) {
  return roundData.matches.every(match => match.status === 'confirmed');
}

function getWinnerStub(match) {
  const homeGoals = Number(match.reportedScore.home);
  const awayGoals = Number(match.reportedScore.away);

  if (homeGoals === awayGoals) return null;

  if (homeGoals > awayGoals) {
    return {
      teamId: match.homeTeamId,
      clubName: match.homeClubName,
      managerId: match.homeManagerId,
      coManagerIds: match.homeCoManagerIds || [],
    };
  }

  return {
    teamId: match.awayTeamId,
    clubName: match.awayClubName,
    managerId: match.awayManagerId,
    coManagerIds: match.awayCoManagerIds || [],
  };
}

function getLoserStub(match) {
  const homeGoals = Number(match.reportedScore.home);
  const awayGoals = Number(match.reportedScore.away);

  if (homeGoals === awayGoals) return null;

  if (homeGoals > awayGoals) {
    return {
      teamId: match.awayTeamId,
      clubName: match.awayClubName,
      managerId: match.awayManagerId,
      coManagerIds: match.awayCoManagerIds || [],
    };
  }

  return {
    teamId: match.homeTeamId,
    clubName: match.homeClubName,
    managerId: match.homeManagerId,
    coManagerIds: match.homeCoManagerIds || [],
  };
}

// =========================
// GENERATION
// =========================

async function generateTestFlowIfNeeded() {
  const state = loadTestState();
  if (!state.active || !state.format) return;
  if (state.generated) return;

  const teams = getTestTeamsFromState().map(cloneTeam);
  if (teams.length !== state.format) return;

  // 1. Check-in Nachricht
  const checkinChannel = await fetchChannel(process.env.TEST_CHECKIN_CHANNEL_ID);
  if (!checkinChannel) return;

  const checkinMessage = await checkinChannel.send({
    embeds: [buildTestCheckinEmbed(state.format, teams)],
  });

  state.checkinMessageId = checkinMessage.id;

  // 2. Gruppen auslosen
  const groupLetters = getGroupLetters(state.format);
  const shuffled = shuffleArray(teams);
  state.groups = {};

  groupLetters.forEach(letter => {
    state.groups[letter] = {
      channelId: getGroupChannelId(letter),
      tableMessageId: null,
      infoMessageId: null,
      scheduleMessageId: null,
      rows: [],
      teams: [],
      matches: [],
    };
  });

  shuffled.forEach((team, index) => {
    const letter = groupLetters[index % groupLetters.length];
    state.groups[letter].teams.push(team);
  });

  for (const letter of groupLetters) {
    const group = state.groups[letter];
    group.rows = createInitialRows(group.teams);
    group.matches = createGroupMatches(letter, group.teams);

    const channel = await fetchChannel(group.channelId);
    if (!channel) continue;

    const tableMessage = await channel.send({
      embeds: [buildGroupTableEmbed(state.format, letter, group.rows)],
    });

    const infoMessage = await channel.send({
      content: buildGroupInfoText(letter, group.teams),
    });

    const scheduleMessage = await channel.send({
      embeds: [buildGroupScheduleEmbed(state.format, letter, group.matches)],
      components: [buildGroupScheduleButtons(letter)],
    });

    group.tableMessageId = tableMessage.id;
    group.infoMessageId = infoMessage.id;
    group.scheduleMessageId = scheduleMessage.id;
  }

  state.ko = { rounds: {} };
  state.label = `${state.format}er Testlauf`;
  state.generated = true;

  saveTestState(state);
}

// =========================
// GROUP UPDATE
// =========================

async function updateGroupMessages(groupLetter) {
  const state = loadTestState();
  const group = state.groups?.[groupLetter];
  if (!group) return;

  const channel = await fetchChannel(group.channelId);
  if (!channel) return;

  group.rows = recalculateGroupRows(group.rows, group.matches);
  saveTestState(state);

  const tableMessage = await fetchMessage(channel, group.tableMessageId);
  if (tableMessage) {
    await tableMessage.edit({
      embeds: [buildGroupTableEmbed(state.format, groupLetter, group.rows)],
    });
  }

  const scheduleMessage = await fetchMessage(channel, group.scheduleMessageId);
  if (scheduleMessage) {
    await scheduleMessage.edit({
      embeds: [buildGroupScheduleEmbed(state.format, groupLetter, group.matches)],
      components: [buildGroupScheduleButtons(groupLetter)],
    });
  }
}

// =========================
// K.O. CREATION
// =========================

function allGroupMatchesConfirmed() {
  const state = loadTestState();
  const groups = state.groups || {};

  const letters = Object.keys(groups);
  if (!letters.length) return false;

  for (const letter of letters) {
    const group = groups[letter];
    if (!group.matches.every(match => match.status === 'confirmed')) {
      return false;
    }
  }

  return true;
}

function getQualifiedTeamsFromTestGroups() {
  const state = loadTestState();
  const format = state.format;
  const letters = Object.keys(state.groups).sort();

  const placements = {};
  for (const letter of letters) {
    placements[letter] = sortRows(state.groups[letter].rows);
  }

  if (format === 8) {
    return {
      semiFinal: [
        [cloneTeam(placements.A[0]), cloneTeam(placements.B[1])],
        [cloneTeam(placements.B[0]), cloneTeam(placements.A[1])],
      ],
    };
  }

  if (format === 16) {
    return {
      quarterFinal: [
        [cloneTeam(placements.A[0]), cloneTeam(placements.B[1])],
        [cloneTeam(placements.B[0]), cloneTeam(placements.A[1])],
        [cloneTeam(placements.C[0]), cloneTeam(placements.D[1])],
        [cloneTeam(placements.D[0]), cloneTeam(placements.C[1])],
      ],
    };
  }

  if (format === 24) {
    const winners = letters.map(letter => cloneTeam(placements[letter][0]));
    const runners = letters.map(letter => cloneTeam(placements[letter][1]));
    const thirds = letters.map(letter => cloneTeam(placements[letter][2]));
    const bestThirds = sortRows(thirds).slice(0, 4).map(cloneTeam);

    return {
      roundOf16: [
        [winners[0], bestThirds[3]],
        [winners[1], bestThirds[2]],
        [winners[2], bestThirds[1]],
        [winners[3], bestThirds[0]],
        [winners[4], runners[5]],
        [winners[5], runners[4]],
        [runners[0], runners[3]],
        [runners[1], runners[2]],
      ],
    };
  }

  if (format === 32) {
    return {
      roundOf16: [
        [cloneTeam(placements.A[0]), cloneTeam(placements.B[1])],
        [cloneTeam(placements.B[0]), cloneTeam(placements.A[1])],
        [cloneTeam(placements.C[0]), cloneTeam(placements.D[1])],
        [cloneTeam(placements.D[0]), cloneTeam(placements.C[1])],
        [cloneTeam(placements.E[0]), cloneTeam(placements.F[1])],
        [cloneTeam(placements.F[0]), cloneTeam(placements.E[1])],
        [cloneTeam(placements.G[0]), cloneTeam(placements.H[1])],
        [cloneTeam(placements.H[0]), cloneTeam(placements.G[1])],
      ],
    };
  }

  return null;
}

async function createKoRound(roundKey, pairs) {
  const state = loadTestState();
  const channelId = getRoundChannelId(roundKey);
  if (!channelId) return;

  const channel = await fetchChannel(channelId);
  if (!channel) return;

  const roundData = {
    channelId,
    messageId: null,
    matches: createKoMatches(roundKey, pairs),
  };

  const message = await channel.send({
    embeds: [buildKoRoundEmbed(roundKey, roundData.matches)],
    components: [buildKoRoundButtons(roundKey)],
  });

  roundData.messageId = message.id;
  state.ko.rounds[roundKey] = roundData;
  saveTestState(state);
}

async function createInitialKoIfReady() {
  const state = loadTestState();
  if (!state.active || !state.generated) return;
  if (!allGroupMatchesConfirmed()) return;

  if (Object.keys(state.ko.rounds || {}).length > 0) return;

  const qualified = getQualifiedTeamsFromTestGroups();
  if (!qualified) return;

  if (qualified.roundOf16) {
    await createKoRound('roundOf16', qualified.roundOf16);
  } else if (qualified.quarterFinal) {
    await createKoRound('quarterFinal', qualified.quarterFinal);
  } else if (qualified.semiFinal) {
    await createKoRound('semiFinal', qualified.semiFinal);
  }
}

async function updateKoRoundMessage(roundKey) {
  const state = loadTestState();
  const round = state.ko?.rounds?.[roundKey];
  if (!round) return;

  const channel = await fetchChannel(round.channelId);
  if (!channel) return;

  const message = await fetchMessage(channel, round.messageId);
  if (!message) return;

  await message.edit({
    embeds: [buildKoRoundEmbed(roundKey, round.matches)],
    components: [buildKoRoundButtons(roundKey)],
  });
}

async function advanceKoIfReady() {
  const state = loadTestState();
  const rounds = state.ko?.rounds || {};

  if (rounds.roundOf16 && roundIsComplete(rounds.roundOf16) && !rounds.quarterFinal) {
    const winners = rounds.roundOf16.matches.map(getWinnerStub).filter(Boolean);
    if (winners.length === 8) {
      await createKoRound('quarterFinal', [
        [winners[0], winners[1]],
        [winners[2], winners[3]],
        [winners[4], winners[5]],
        [winners[6], winners[7]],
      ]);
      return;
    }
  }

  if (rounds.quarterFinal && roundIsComplete(rounds.quarterFinal) && !rounds.semiFinal) {
    const winners = rounds.quarterFinal.matches.map(getWinnerStub).filter(Boolean);
    if (winners.length === 4) {
      await createKoRound('semiFinal', [
        [winners[0], winners[1]],
        [winners[2], winners[3]],
      ]);
      return;
    }
  }

  if (rounds.semiFinal && roundIsComplete(rounds.semiFinal)) {
    if (!rounds.final || !rounds.thirdPlace) {
      const winners = rounds.semiFinal.matches.map(getWinnerStub).filter(Boolean);
      const losers = rounds.semiFinal.matches.map(getLoserStub).filter(Boolean);

      if (winners.length === 2 && !rounds.final) {
        await createKoRound('final', [[winners[0], winners[1]]]);
      }

      const stateAfterFinal = loadTestState();
      if (losers.length === 2 && !stateAfterFinal.ko.rounds.thirdPlace) {
        await createKoRound('thirdPlace', [[losers[0], losers[1]]]);
      }

      return;
    }
  }
}

// =========================
// CONFIRM FLOW
// =========================

function buildConfirmButtons(scope, key1, key2) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`test_confirm:${scope}:${key1}:${key2}`)
      .setLabel('✅ Bestätigen')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`test_reject:${scope}:${key1}:${key2}`)
      .setLabel('❌ Ablehnen')
      .setStyle(ButtonStyle.Danger)
  );
}

async function createConfirmMessage(channelId, content, scope, key1, key2) {
  const channel = await fetchChannel(channelId);
  if (!channel) return null;

  const msg = await channel.send({
    content,
    components: [buildConfirmButtons(scope, key1, key2)],
  });

  return msg.id;
}

// =========================
// INTERACTIONS
// =========================

async function handleOpenGroupResult(interaction, groupLetter) {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({
      content: '❌ Im Testmodus dürfen nur Admins die Test-Ergebnisse steuern.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const state = loadTestState();
  const group = state.groups?.[groupLetter];
  if (!group) {
    await interaction.reply({
      content: '❌ Test-Gruppe nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`test_select_group:${groupLetter}`)
    .setPlaceholder('Spiel auswählen')
    .addOptions(
      group.matches.map(match => ({
        label: `${match.homeClubName} vs ${match.awayClubName}`,
        description: `Spiel ${match.matchNumber} • ${match.timeWindow}`,
        value: String(match.matchNumber),
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.reply({
    content: 'Wähle das Gruppenspiel aus.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleSelectGroup(interaction, groupLetter) {
  const state = loadTestState();
  const group = state.groups?.[groupLetter];
  const matchNumber = Number(interaction.values[0]);

  if (!group) {
    await interaction.reply({
      content: '❌ Gruppe nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const match = group.matches.find(m => m.matchNumber === matchNumber);
  if (!match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`test_modal_group:${groupLetter}:${matchNumber}`)
    .setTitle('Test Gruppenergebnis');

  const homeInput = new TextInputBuilder()
    .setCustomId('home_goals')
    .setLabel(`Tore ${match.homeClubName}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const awayInput = new TextInputBuilder()
    .setCustomId('away_goals')
    .setLabel(`Tore ${match.awayClubName}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(homeInput),
    new ActionRowBuilder().addComponents(awayInput)
  );

  await interaction.showModal(modal);
  return true;
}

async function handleGroupModal(interaction, groupLetter, matchNumber) {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Testergebnisse melden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const state = loadTestState();
  const group = state.groups?.[groupLetter];
  if (!group) {
    await interaction.reply({
      content: '❌ Gruppe nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const match = group.matches.find(m => m.matchNumber === Number(matchNumber));
  if (!match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const homeGoals = interaction.fields.getTextInputValue('home_goals').trim();
  const awayGoals = interaction.fields.getTextInputValue('away_goals').trim();

  if (!/^\d+$/.test(homeGoals) || !/^\d+$/.test(awayGoals)) {
    await interaction.reply({
      content: '❌ Bitte nur ganze Zahlen eingeben.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  match.status = 'reported';
  match.reportedByTeamId = 'test-admin';
  match.reportedScore = {
    home: Number(homeGoals),
    away: Number(awayGoals),
  };

  const confirmationId = await createConfirmMessage(
    group.channelId,
    [
      `⚠️ **Test-Ergebnis gemeldet**`,
      '',
      `**${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}**`,
      '',
      `Bestätige oder lehne das Ergebnis ab.`,
    ].join('\n'),
    'group',
    groupLetter,
    String(match.matchNumber)
  );

  match.confirmationMessageId = confirmationId;
  saveTestState(state);

  await updateGroupMessages(groupLetter);

  await interaction.reply({
    content: '✅ Test-Ergebnis gemeldet. Jetzt bestätigen oder ablehnen.',
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleOpenKoResult(interaction, roundKey) {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({
      content: '❌ Im Testmodus dürfen nur Admins die Test-Ergebnisse steuern.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const state = loadTestState();
  const round = state.ko?.rounds?.[roundKey];
  if (!round) {
    await interaction.reply({
      content: '❌ Test-K.O.-Runde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`test_select_ko:${roundKey}`)
    .setPlaceholder('Spiel auswählen')
    .addOptions(
      round.matches.map(match => ({
        label: `${match.homeClubName} vs ${match.awayClubName}`,
        description: `Spiel ${match.matchNumber} • ${match.timeWindow}`,
        value: String(match.matchNumber),
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.reply({
    content: 'Wähle das K.O.-Spiel aus.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleSelectKo(interaction, roundKey) {
  const state = loadTestState();
  const round = state.ko?.rounds?.[roundKey];
  const matchNumber = Number(interaction.values[0]);

  if (!round) {
    await interaction.reply({
      content: '❌ Runde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const match = round.matches.find(m => m.matchNumber === matchNumber);
  if (!match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`test_modal_ko:${roundKey}:${matchNumber}`)
    .setTitle(`Test ${getRoundLabel(roundKey)}`);

  const homeInput = new TextInputBuilder()
    .setCustomId('home_goals')
    .setLabel(`Tore ${match.homeClubName}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const awayInput = new TextInputBuilder()
    .setCustomId('away_goals')
    .setLabel(`Tore ${match.awayClubName}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(homeInput),
    new ActionRowBuilder().addComponents(awayInput)
  );

  await interaction.showModal(modal);
  return true;
}

async function handleKoModal(interaction, roundKey, matchNumber) {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Testergebnisse melden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const state = loadTestState();
  const round = state.ko?.rounds?.[roundKey];
  if (!round) {
    await interaction.reply({
      content: '❌ Runde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const match = round.matches.find(m => m.matchNumber === Number(matchNumber));
  if (!match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const homeGoals = interaction.fields.getTextInputValue('home_goals').trim();
  const awayGoals = interaction.fields.getTextInputValue('away_goals').trim();

  if (!/^\d+$/.test(homeGoals) || !/^\d+$/.test(awayGoals)) {
    await interaction.reply({
      content: '❌ Bitte nur ganze Zahlen eingeben.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (Number(homeGoals) === Number(awayGoals)) {
    await interaction.reply({
      content: '❌ In der K.O.-Phase ist im Test kein Unentschieden erlaubt.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  match.status = 'reported';
  match.reportedByTeamId = 'test-admin';
  match.reportedScore = {
    home: Number(homeGoals),
    away: Number(awayGoals),
  };

  const confirmationId = await createConfirmMessage(
    round.channelId,
    [
      `⚠️ **Test-K.O.-Ergebnis gemeldet**`,
      '',
      `**${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}**`,
      '',
      `Bestätige oder lehne das Ergebnis ab.`,
    ].join('\n'),
    'ko',
    roundKey,
    String(match.matchNumber)
  );

  match.confirmationMessageId = confirmationId;
  saveTestState(state);

  await updateKoRoundMessage(roundKey);

  await interaction.reply({
    content: '✅ Test-K.O.-Ergebnis gemeldet. Jetzt bestätigen oder ablehnen.',
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleConfirm(interaction, scope, key1, key2) {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen im Testmodus bestätigen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const state = loadTestState();

  if (scope === 'group') {
    const group = state.groups?.[key1];
    if (!group) {
      await interaction.reply({
        content: '❌ Gruppe nicht gefunden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const match = group.matches.find(m => m.matchNumber === Number(key2));
    if (!match || !match.reportedScore) {
      await interaction.reply({
        content: '❌ Spiel nicht gefunden oder es gibt kein offenes Ergebnis.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    match.status = 'confirmed';
    match.confirmed = true;
    saveTestState(state);

    await updateGroupMessages(key1);

    if (match.confirmationMessageId) {
      setTimeout(async () => {
        await deleteMessageIfExists(group.channelId, match.confirmationMessageId);
      }, 4000);
    }

    await interaction.reply({
      content: `✅ Test-Ergebnis bestätigt: ${match.homeClubName} ${match.reportedScore.home}:${match.reportedScore.away} ${match.awayClubName}`,
      flags: MessageFlags.Ephemeral,
    });

    await createInitialKoIfReady();
    await advanceKoIfReady();

    return true;
  }

  if (scope === 'ko') {
    const round = state.ko?.rounds?.[key1];
    if (!round) {
      await interaction.reply({
        content: '❌ Runde nicht gefunden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const match = round.matches.find(m => m.matchNumber === Number(key2));
    if (!match || !match.reportedScore) {
      await interaction.reply({
        content: '❌ Spiel nicht gefunden oder es gibt kein offenes Ergebnis.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    match.status = 'confirmed';
    match.confirmed = true;

    const homeGoals = Number(match.reportedScore.home);
    const awayGoals = Number(match.reportedScore.away);

    if (homeGoals > awayGoals) {
      match.winnerTeamId = match.homeTeamId;
      match.loserTeamId = match.awayTeamId;
    } else {
      match.winnerTeamId = match.awayTeamId;
      match.loserTeamId = match.homeTeamId;
    }

    saveTestState(state);
    await updateKoRoundMessage(key1);

    if (match.confirmationMessageId) {
      setTimeout(async () => {
        await deleteMessageIfExists(round.channelId, match.confirmationMessageId);
      }, 4000);
    }

    await interaction.reply({
      content: `✅ Test-K.O.-Ergebnis bestätigt: ${match.homeClubName} ${match.reportedScore.home}:${match.reportedScore.away} ${match.awayClubName}`,
      flags: MessageFlags.Ephemeral,
    });

    await advanceKoIfReady();

    return true;
  }

  return false;
}

async function handleReject(interaction, scope, key1, key2) {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen im Testmodus ablehnen.',
      flags: MessageFlags.Ephemeral,
    });
      return true;
  }

  const state = loadTestState();

  if (scope === 'group') {
    const group = state.groups?.[key1];
    if (!group) {
      await interaction.reply({
        content: '❌ Gruppe nicht gefunden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const match = group.matches.find(m => m.matchNumber === Number(key2));
    if (!match) {
      await interaction.reply({
        content: '❌ Spiel nicht gefunden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    match.status = 'pending';
    match.reportedByTeamId = null;
    match.reportedScore = null;
    match.confirmed = false;
    saveTestState(state);

    await updateGroupMessages(key1);

    if (match.confirmationMessageId) {
      setTimeout(async () => {
        await deleteMessageIfExists(group.channelId, match.confirmationMessageId);
      }, 4000);
    }

    await interaction.reply({
      content: '❌ Test-Gruppenergebnis abgelehnt.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (scope === 'ko') {
    const round = state.ko?.rounds?.[key1];
    if (!round) {
      await interaction.reply({
        content: '❌ Runde nicht gefunden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const match = round.matches.find(m => m.matchNumber === Number(key2));
    if (!match) {
      await interaction.reply({
        content: '❌ Spiel nicht gefunden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    match.status = 'pending';
    match.reportedByTeamId = null;
    match.reportedScore = null;
    match.confirmed = false;
    match.winnerTeamId = null;
    match.loserTeamId = null;
    saveTestState(state);

    await updateKoRoundMessage(key1);

    if (match.confirmationMessageId) {
      setTimeout(async () => {
        await deleteMessageIfExists(round.channelId, match.confirmationMessageId);
      }, 4000);
    }

    await interaction.reply({
      content: '❌ Test-K.O.-Ergebnis abgelehnt.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  return false;
}

// =========================
// EXPORTS
// =========================

module.exports = {
  async init(client) {
    clientRef = client;

    ensureFile(TEST_FILE, {
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

    await generateTestFlowIfNeeded();
    await createInitialKoIfReady();
    await advanceKoIfReady();

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await generateTestFlowIfNeeded();
          await createInitialKoIfReady();
          await advanceKoIfReady();
        } catch (error) {
          console.error('❌ Fehler im Test-System-Intervall:', error);
        }
      }, 15000);
    }
  },

  async handleInteraction(interaction) {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('test_group_result_open:')) {
        const [, groupLetter] = interaction.customId.split(':');
        return handleOpenGroupResult(interaction, groupLetter);
      }

      if (interaction.customId.startsWith('test_ko_result_open:')) {
        const [, roundKey] = interaction.customId.split(':');
        return handleOpenKoResult(interaction, roundKey);
      }

      if (interaction.customId.startsWith('test_confirm:')) {
        const [, scope, key1, key2] = interaction.customId.split(':');
        return handleConfirm(interaction, scope, key1, key2);
      }

      if (interaction.customId.startsWith('test_reject:')) {
        const [, scope, key1, key2] = interaction.customId.split(':');
        return handleReject(interaction, scope, key1, key2);
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('test_select_group:')) {
        const [, groupLetter] = interaction.customId.split(':');
        return handleSelectGroup(interaction, groupLetter);
      }

      if (interaction.customId.startsWith('test_select_ko:')) {
        const [, roundKey] = interaction.customId.split(':');
        return handleSelectKo(interaction, roundKey);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('test_modal_group:')) {
        const [, groupLetter, matchNumber] = interaction.customId.split(':');
        return handleGroupModal(interaction, groupLetter, matchNumber);
      }

      if (interaction.customId.startsWith('test_modal_ko:')) {
        const [, roundKey, matchNumber] = interaction.customId.split(':');
        return handleKoModal(interaction, roundKey, matchNumber);
      }
    }

    return false;
  },

  async handleMessage() {
    return false;
  },
};