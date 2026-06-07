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

const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');
const RESULTS_FILE = path.join(process.cwd(), 'data', 'results.json');
const GROUP_RELEASE_SLOTS = [
  {
    slot: 1,
    matchNumbers: [1, 2],
    plannedStart: '00:00',
    plannedEnd: '00:05',
  },
  {
    slot: 2,
    matchNumbers: [3, 4],
    plannedStart: '00:25',
    plannedEnd: '00:30',
  },
  {
    slot: 3,
    matchNumbers: [5, 6],
    plannedStart: '00:50',
    plannedEnd: '00:55',
  },
];

const INVITE_WINDOW_MINUTES = 5;
const REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const KO_EARLIEST_START = '01:00';

let clientRef = null;
let intervalRef = null;

// =========================
// FILE HELPERS
// =========================

function ensureResultsFile() {
  const dir = path.dirname(RESULTS_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(
      RESULTS_FILE,
      JSON.stringify(
        {
          friday: null,
          saturday: null,
        },
        null,
        2
      ),
      'utf8'
    );
  }
}

function loadGroups() {
  try {
    if (!fs.existsSync(GROUPS_FILE)) {
      return { friday: null, saturday: null };
    }

    const raw = fs.readFileSync(GROUPS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen von groups.json:', error);
    return { friday: null, saturday: null };
  }
}

function loadCheckins() {
  try {
    if (!fs.existsSync(CHECKINS_FILE)) {
      return { friday: null, saturday: null };
    }

    const raw = fs.readFileSync(CHECKINS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen von checkins.json:', error);
    return { friday: null, saturday: null };
  }
}

function loadResults() {
  ensureResultsFile();

  try {
    const raw = fs.readFileSync(RESULTS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen von results.json:', error);
    return { friday: null, saturday: null };
  }
}

function saveResults(data) {
  try {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Fehler beim Schreiben von results.json:', error);
  }
}

function saveGroups(data) {
  try {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Fehler beim Schreiben von groups.json:', error);
  }
}

// =========================
// MATCH GENERATION
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
    'Noch nicht freigegeben',
    'Noch nicht freigegeben',
    'Noch nicht freigegeben',
    'Noch nicht freigegeben',
    'Noch nicht freigegeben',
    'Noch nicht freigegeben',
  ];
}

function enrichMatches(groupLetter, teams) {
  const matches = createRoundRobinMatches(teams);
  const windows = getGroupMatchWindows();

  return matches.map((match, index) => {
    const home = teams.find(t => t.teamId === match.homeTeamId);
    const away = teams.find(t => t.teamId === match.awayTeamId);

    const homeIsBye = !!home?.isByeTeam;
    const awayIsBye = !!away?.isByeTeam;
    const hasByeTeam = homeIsBye || awayIsBye;
    const realTeam = homeIsBye ? away : home;

    return {
      id: `${groupLetter}_match_${index + 1}`,
      groupLetter,
      matchNumber: index + 1,
      timeWindow: windows[index] || '00:00–00:05',
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeClubName: home?.clubName || 'Unbekannt',
      awayClubName: away?.clubName || 'Unbekannt',
      status: hasByeTeam ? 'confirmed' : 'pending',
      reportedByTeamId: hasByeTeam ? realTeam?.teamId || null : null,
reportedScore: hasByeTeam
  ? {
      home: homeIsBye ? 0 : 1,
      away: awayIsBye ? 0 : 1,
    }
  : null,
teamReports: {},
confirmed: hasByeTeam,
confirmationMessageId: null,
disputeMessageId: null,
isByeMatch: hasByeTeam,
    };
  });
}

// =========================
// RENDER HELPERS
// =========================

function buildScheduleText(matches) {
  if (!matches.length) return 'Noch kein Spielplan vorhanden.';

  return matches
    .map(match => {
      let status = '⏳ Offen';

      if (match.status === 'awaiting' && match.waitingForClubName) {
        status = `⏳ Wartet auf Eintragung von ${match.waitingForClubName}`;
      }

      if (match.status === 'disputed') {
        status = '🚨 In Klärung mit Admin';
      }

      if (match.status === 'confirmed' && match.reportedScore) {
        status = match.isByeMatch
          ? `🎟️ Freilos-Wertung: ${match.reportedScore.home}:${match.reportedScore.away}`
          : `✅ Bestätigt: ${match.reportedScore.home}:${match.reportedScore.away}`;
      }

      return `**${match.matchNumber}.** ${match.homeClubName} vs ${match.awayClubName}\n🕒 ${match.timeWindow} • ${status}`;
    })
    .join('\n\n');
}

function buildScheduleEmbed(eventLabel, groupLetter, matches) {
  return new EmbedBuilder()
    .setTitle(`⚽ ${eventLabel} • Gruppe ${groupLetter} • Spielplan`)
    .setDescription(
      [
        'Die Ergebnisse werden über den Button darunter eingetragen.',
        '',
        buildScheduleText(matches),
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildScheduleButtons(eventKey, groupLetter) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`result_open:${eventKey}:${groupLetter}`)
      .setLabel('⚽ Ergebnis eintragen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`admin_result_open:${eventKey}:${groupLetter}`)
      .setLabel('🛠️ Admin-Ergebnis')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`backup_replace_open:${eventKey}:${groupLetter}`)
      .setLabel('🔁 Nachrücker einsetzen')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildTableText(rows) {
  const sortedRows = [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.clubName.localeCompare(b.clubName, 'de');
  });

  return sortedRows
    .map((row, index) => {
      return `**${index + 1}. ${row.clubName}**  •  S ${row.s}  •  U ${row.u}  •  N ${row.n}  •  Diff ${row.diff}  •  P ${row.points}`;
    })
    .join('\n');
}

function getFormatText(format) {
  if (Number(format) === 24) {
    return '🏆 **Turnierformat:** 24er Cup • Platz 1 & 2 kommen weiter + die 4 besten Drittplatzierten';
  }

  if (Number(format) === 18) {
    return '🏆 **Turnierformat:** 18er Cup • Platz 1 kommt weiter';
  }

  if (Number(format) === 16) {
    return '🏆 **Turnierformat:** 16er Cup • Platz 1 & 2 kommen weiter';
  }

  return format ? `🏆 **Turnierformat:** ${format}er Cup` : null;
}

function buildTableEmbed(eventLabel, groupLetter, rows, format = null) {
  const tableText = rows.length > 0
    ? buildTableText(rows)
    : 'Noch keine Teams in dieser Gruppe.';

  const formatText = getFormatText(format);

  return new EmbedBuilder()
    .setTitle(`🏆 ${eventLabel} • Gruppe ${groupLetter} • Live-Tabelle`)
    .setDescription(
      [
        tableText,
        formatText ? `\n${formatText}` : null,
      ].filter(Boolean).join('\n')
    )
    .setColor(0xff0000);
}

function isAdmin(interaction) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (!adminRoleId) return false;

  return interaction.member?.roles?.cache?.has(adminRoleId);
}

function getBackupTeamsForEvent(eventKey) {
  const checkins = loadCheckins();
  const event = checkins[eventKey];

  if (!event || !Array.isArray(event.teams)) return [];

  const format = event.format || null;
  const actualFormat =
    format ||
    (event.teams.length < 8
      ? 0
      : event.teams.length < 16
        ? 8
        : event.teams.length < 24
          ? 16
          : event.teams.length < 32
            ? 24
            : 32);

  if (!actualFormat) return [];

  return event.teams.slice(actualFormat);
}

function getTeamUserIds(team) {
  return [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ].filter(Boolean);
}

function getRoleIdForLetter(letter) {
  return process.env[`GROUP_${letter}_ROLE_ID`] || null;
}

async function updateGroupRoleForReplacement(groupLetter, oldTeam, newTeam) {
  const roleId = getRoleIdForLetter(groupLetter);
  if (!roleId) return;

  const guild = clientRef.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return;

  for (const userId of getTeamUserIds(oldTeam)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && member.roles.cache.has(role.id)) {
      await member.roles.remove(role).catch(() => {});
    }
  }

  for (const userId of getTeamUserIds(newTeam)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(role.id)) {
      await member.roles.add(role).catch(() => {});
    }
  }
}

// =========================
// DISCORD HELPERS
// =========================

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
  } catch (error) {
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
  } catch (error) {
    console.warn('⚠️ Nachricht konnte nicht gelöscht werden.');
  }
}

async function sendGroupSlotReleaseMessage(eventKey, groupLetter, slot, startText, endText) {
  const groupsData = loadGroups();
  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  if (!groupMeta) return;

  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) return;

  await channel.send({
    content: [
      `✅ **Gruppe ${groupLetter} • Spieltag ${slot.slot} ist freigegeben**`,
      '',
      `Die Spiele dürfen jetzt gestartet werden.`,
      `**Einladezeit: ${startText} – ${endText} Uhr**`,
      '',
      `Bitte meldet euer Ergebnis direkt nach dem Spiel über den Button im Spielplan.`,
    ].join('\n'),
  });
}

async function sendMissingResultReminder(eventKey, groupLetter, slot, openMatches) {
  const groupsData = loadGroups();
  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  if (!groupMeta) return;

  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) return;

  await channel.send({
    content: [
  `⚠️ **Gruppe ${groupLetter} • Spieltag ${slot.slot} ist noch nicht abgeschlossen**`,
  '',
  `Bitte tragt die offenen Ergebnisse ein, damit der nächste Zeitslot freigegeben werden kann.`,
  '',
  buildOpenMatchesText(openMatches, groupMeta.teams),
].join('\n'),
  });
}

async function sendKoWaitingNotice(eventKey, groupLetter, isBlocker) {
  const groupsData = loadGroups();
  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  if (!groupMeta) return;

  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) return;

  if (isBlocker) {
    await channel.send({
      content: [
        `⚠️ **Eure Gruppe hält aktuell den Turnierfortschritt auf.**`,
        '',
        `Bitte tragt die noch offenen Ergebnisse ein, damit die K.O.-Phase gestartet werden kann.`,
      ].join('\n'),
    });
    return;
  }

  await channel.send({
    content: [
      `⏳ **Die K.O.-Phase kann noch nicht gestartet werden.**`,
      '',
      `Es laufen noch Gruppenspiele in anderen Gruppen.`,
      `Sobald alle Gruppen abgeschlossen sind, wird die K.O.-Phase automatisch ausgelost und freigegeben.`,
    ].join('\n'),
  });
}

// =========================
// CORE HELPERS
// =========================

function parseTimeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function getCurrentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function getPlannedTimestamp(event, time) {
  const [hours, minutes] = time.split(':').map(Number);

  const base = event?.createdAt ? new Date(event.createdAt) : new Date();
  const planned = new Date(base);

  planned.setHours(hours, minutes, 0, 0);

  if (planned.getTime() <= base.getTime()) {
    planned.setDate(planned.getDate() + 1);
  }

  return planned.getTime();
}

function formatMinutes(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(normalized / 60)).padStart(2, '0');
  const m = String(normalized % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isEventExpired(event) {
  if (event?.resetAt) {
    return Date.now() >= Number(event.resetAt);
  }

  if (event?.createdAt) {
    const ageMs = Date.now() - new Date(event.createdAt).getTime();
    return ageMs >= 8 * 60 * 60 * 1000;
  }

  return false;
}

function isEventInactive(event) {
  return !event || event.completed || event.archived || isEventExpired(event);
}

function minutesWindowFromNow() {
  const start = getCurrentMinutes();
  const end = start + INVITE_WINDOW_MINUTES;

  return {
    startText: formatMinutes(start),
    endText: formatMinutes(end),
    windowText: `${formatMinutes(start)}–${formatMinutes(end)}`,
  };
}

function scoresMatch(scoreA, scoreB) {
  return (
    Number(scoreA.home) === Number(scoreB.home) &&
    Number(scoreA.away) === Number(scoreB.away)
  );
}

function getAdminPing() {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  return adminRoleId ? `<@&${adminRoleId}>` : '@Admin';
}

async function sendDisputeNotice(eventKey, groupLetter, match, groupMeta) {
  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) return null;

  const message = await channel.send({
    content: [
      `🚨 ${getAdminPing()} **Ergebnis stimmt nicht überein**`,
      '',
      `**${match.homeClubName} vs ${match.awayClubName}**`,
      '',
      `Bitte prüfen und per **Admin-Ergebnis** final eintragen.`,
    ].join('\n'),
  });

  return message.id;
}

function plannedWindow(slot) {
  return {
    startText: slot.plannedStart,
    endText: slot.plannedEnd,
    windowText: `${slot.plannedStart}–${slot.plannedEnd}`,
  };
}

function ensureGroupReleaseState(resultGroup) {
  if (!resultGroup.release) {
    resultGroup.release = {
      slots: {},
      koWaiting: {
        lastDoneNoticeAt: null,
        lastBlockerNoticeAt: null,
      },
    };
  }

  for (const slot of GROUP_RELEASE_SLOTS) {
    if (!resultGroup.release.slots[slot.slot]) {
      resultGroup.release.slots[slot.slot] = {
        released: false,
        inviteStart: null,
        inviteEnd: null,
        releasedAt: null,
        lastReminderAt: null,
      };
    }
  }

  if (!resultGroup.release.koWaiting) {
    resultGroup.release.koWaiting = {
      lastDoneNoticeAt: null,
      lastBlockerNoticeAt: null,
    };
  }
}

function getSlotByMatchNumber(matchNumber) {
  return GROUP_RELEASE_SLOTS.find(slot => slot.matchNumbers.includes(Number(matchNumber)));
}

function isMatchReleased(resultGroup, matchNumber) {
  ensureGroupReleaseState(resultGroup);

  const slot = getSlotByMatchNumber(matchNumber);
  if (!slot) return false;

  return !!resultGroup.release.slots[slot.slot]?.released;
}

function getMatchesForSlot(resultGroup, slot) {
  return resultGroup.matches.filter(match =>
    slot.matchNumbers.includes(Number(match.matchNumber))
  );
}

function areMatchesConfirmed(matches) {
  return matches.every(match => match.status === 'confirmed');
}

function getOpenMatches(matches) {
  return matches.filter(match => match.status !== 'confirmed' && !match.isByeMatch);
}

function canSendReminder(lastReminderAt) {
  if (!lastReminderAt) return true;

  const last = new Date(lastReminderAt).getTime();
  return Date.now() - last >= REMINDER_INTERVAL_MS;
}

function buildTeamMentions(team) {
  if (!team) return '';

  return [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ]
    .filter(Boolean)
    .map(id => `<@${id}>`)
    .join(' ');
}

function buildOpenMatchesText(openMatches, groupTeams) {
  if (!openMatches.length) return 'Keine offenen Begegnungen gefunden.';

  return openMatches
    .map(match => {
      const { home, away } = getTeamsOfMatch(match, groupTeams);

      const homeMentions = buildTeamMentions(home) || '*Keine VM/Co-VM gefunden*';
      const awayMentions = buildTeamMentions(away) || '*Keine VM/Co-VM gefunden*';

      return [
        `**${match.homeClubName} vs ${match.awayClubName}**`,
        `${homeMentions}`,
        `${awayMentions}`,
      ].join('\n');
    })
    .join('\n\n');
}

function isGroupFinished(resultGroup) {
  return resultGroup.matches.every(match => match.status === 'confirmed');
}

function areAllGroupsFinished(event) {
  return Object.values(event.groups || {}).every(group => isGroupFinished(group));
}

function getEventAndGroup(resultsData, eventKey, groupLetter) {
  const event = resultsData[eventKey];
  if (!event) return null;

  const group = event.groups?.[groupLetter];
  if (!group) return null;

  return { event, group };
}

function getTeamsOfMatch(match, groupTeams) {
  const home = groupTeams.find(t => t.teamId === match.homeTeamId);
  const away = groupTeams.find(t => t.teamId === match.awayTeamId);
  return { home, away };
}

function isTeamAuthorized(userId, team) {
  if (!team) return false;
  if (team.managerId === userId) return true;
  return Array.isArray(team.coManagerIds) && team.coManagerIds.includes(userId);
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

async function replaceTeamInGroup(eventKey, groupLetter, targetTeamId, backupTeamId) {
  const groupsData = loadGroups();
  const resultsData = loadResults();

  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];

  if (!groupMeta || !resultGroup) return false;

  const checkinsPath = path.join(process.cwd(), 'data', 'checkins.json');
  const checkins = fs.existsSync(checkinsPath)
    ? JSON.parse(fs.readFileSync(checkinsPath, 'utf8') || '{}')
    : {};

  const checkinEvent = checkins[eventKey];
  const backupTeam = checkinEvent?.teams?.find(t => String(t.teamId) === String(backupTeamId));

  if (!backupTeam) return false;
  
  const oldTeam = groupMeta.teams.find(t => String(t.teamId) === String(targetTeamId));
if (!oldTeam) return false;

checkinEvent.teams = checkinEvent.teams.filter(
  t => String(t.teamId) !== String(backupTeamId)
);

fs.writeFileSync(checkinsPath, JSON.stringify(checkins, null, 2), 'utf8');

  groupMeta.teams = groupMeta.teams.map(t =>
    String(t.teamId) === String(targetTeamId) ? backupTeam : t
  );

  groupMeta.rows = groupMeta.rows.map(row =>
    String(row.teamId) === String(targetTeamId)
      ? {
          ...row,
          teamId: backupTeam.teamId,
          clubName: backupTeam.clubName,
          managerId: backupTeam.managerId || null,
          coManagerIds: Array.isArray(backupTeam.coManagerIds) ? backupTeam.coManagerIds : [],
        }
      : row
  );

  resultGroup.matches = resultGroup.matches.map(match => {
    if (String(match.homeTeamId) === String(targetTeamId)) {
      match.homeTeamId = backupTeam.teamId;
      match.homeClubName = backupTeam.clubName;
    }

    if (String(match.awayTeamId) === String(targetTeamId)) {
      match.awayTeamId = backupTeam.teamId;
      match.awayClubName = backupTeam.clubName;
    }

    return match;
  });

  await updateGroupRoleForReplacement(groupLetter, oldTeam, backupTeam);

saveGroups(groupsData);
saveResults(resultsData);

await updateGroupMessages(eventKey, groupLetter);
  
  return true;
}

async function updateGroupMessages(eventKey, groupLetter) {
  const groupsData = loadGroups();
  const resultsData = loadResults();

  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];

  if (!groupMeta || !resultGroup) return;

  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) return;

  const newRows = recalculateRows(groupMeta.rows, resultGroup.matches);
  groupMeta.rows = newRows;
  groupsData[eventKey].groups[groupLetter].rows = newRows;
  saveGroups(groupsData);

  const tableMessage = await fetchMessage(channel, groupMeta.tableMessageId);
  if (tableMessage) {
    await tableMessage.edit({
      embeds: [buildTableEmbed(groupsData[eventKey].label, groupLetter, newRows)],
    });
  }

  const scheduleMessage = await fetchMessage(channel, resultGroup.scheduleMessageId);
  if (scheduleMessage) {
    await scheduleMessage.edit({
      embeds: [buildScheduleEmbed(groupsData[eventKey].label, groupLetter, resultGroup.matches)],
      components: [buildScheduleButtons(eventKey, groupLetter)],
    });
  }
}
async function releaseGroupSlot(eventKey, groupLetter, slot, dynamic = false) {
  const resultsData = loadResults();
  const event = resultsData[eventKey];
  const resultGroup = event?.groups?.[groupLetter];

  if (!event || !resultGroup) return;

  ensureGroupReleaseState(resultGroup);

  const releaseState = resultGroup.release.slots[slot.slot];
  if (releaseState.released) return;

  const window = dynamic ? minutesWindowFromNow() : plannedWindow(slot);

  const slotMatches = getMatchesForSlot(resultGroup, slot);

  for (const match of slotMatches) {
    match.timeWindow = window.windowText;
  }

  releaseState.released = true;
releaseState.inviteStart = window.startText;
releaseState.inviteEnd = window.endText;
releaseState.releasedAt = nowIso();
releaseState.lastReminderAt = null;

  saveResults(resultsData);

  await sendGroupSlotReleaseMessage(
    eventKey,
    groupLetter,
    slot,
    window.startText,
    window.endText
  );

  await updateGroupMessages(eventKey, groupLetter);
}

async function processGroupReleaseTimes(eventKey) {
  const resultsData = loadResults();
  const event = resultsData[eventKey];

  if (!event || !event.groups) return;
if (isEventInactive(event)) return;

  const nowMs = Date.now();

  for (const groupLetter of Object.keys(event.groups)) {
    const resultGroup = event.groups[groupLetter];
    if (!resultGroup) continue;

    ensureGroupReleaseState(resultGroup);

    for (const slot of GROUP_RELEASE_SLOTS) {
      const releaseState = resultGroup.release.slots[slot.slot];
      if (releaseState.released) continue;

      const plannedStartMs = getPlannedTimestamp(event, slot.plannedStart);
if (nowMs < plannedStartMs) continue;

      const previousSlot =
        slot.slot === 1
          ? null
          : GROUP_RELEASE_SLOTS.find(s => s.slot === slot.slot - 1);

      if (!previousSlot) {
        await releaseGroupSlot(eventKey, groupLetter, slot, false);
        continue;
      }

      const previousMatches = getMatchesForSlot(resultGroup, previousSlot);

      if (areMatchesConfirmed(previousMatches)) {
        const isLate = nowMs > plannedStartMs;
        await releaseGroupSlot(eventKey, groupLetter, slot, isLate);
        continue;
      }

      const openMatches = getOpenMatches(previousMatches);

      if (openMatches.length && canSendReminder(releaseState.lastReminderAt)) {
        releaseState.lastReminderAt = nowIso();
        saveResults(resultsData);

        await sendMissingResultReminder(eventKey, groupLetter, previousSlot, openMatches);
      }
    }
  }

  await processKoWaitingNotices(eventKey);
}

async function processKoWaitingNotices(eventKey) {
  const resultsData = loadResults();
  const event = resultsData[eventKey];

  if (!event || !event.groups) return;
  if (isEventInactive(event)) return;

  const nowMs = Date.now();
const koStartMs = getPlannedTimestamp(event, KO_EARLIEST_START);

if (nowMs < koStartMs) return;

  const allFinished = areAllGroupsFinished(event);
  if (allFinished) return;

  for (const groupLetter of Object.keys(event.groups)) {
    const resultGroup = event.groups[groupLetter];
    if (!resultGroup) continue;

    ensureGroupReleaseState(resultGroup);

    const groupFinished = isGroupFinished(resultGroup);

    if (groupFinished) {
      if (canSendReminder(resultGroup.release.koWaiting.lastDoneNoticeAt)) {
        resultGroup.release.koWaiting.lastDoneNoticeAt = nowIso();
        saveResults(resultsData);

        await sendKoWaitingNotice(eventKey, groupLetter, false);
      }

      continue;
    }

        if (canSendReminder(resultGroup.release.koWaiting.lastBlockerNoticeAt)) {
      resultGroup.release.koWaiting.lastBlockerNoticeAt = nowIso();
      saveResults(resultsData);

      await sendKoWaitingNotice(eventKey, groupLetter, true);
    }
  }
}

// =========================
// AUTO SCHEDULE CREATION
// =========================

async function createScheduleForEvent(eventKey) {
  const groupsData = loadGroups();
  const resultsData = loadResults();

  const event = groupsData[eventKey];
  if (!event || !event.groups) return;

  const existing = resultsData[eventKey];

if (existing && existing.cycleKey === event.cycleKey && !existing.resetAt && event.resetAt) {
  existing.resetAt = event.resetAt;
  saveResults(resultsData);
}

if (existing && existing.cycleKey === event.cycleKey) {
  return;
}

  if (existing && existing.groups) {
    for (const letter of Object.keys(existing.groups)) {
      const group = existing.groups[letter];
      if (!group) continue;

      if (group.scheduleMessageId) {
        await deleteMessageIfExists(group.channelId, group.scheduleMessageId);
      }

      if (group.matches) {
        for (const match of group.matches) {
          if (match.confirmationMessageId) {
            await deleteMessageIfExists(group.channelId, match.confirmationMessageId);
          }
        }
      }
    }
  }

  const storedEvent = {
  eventKey,
  cycleKey: event.cycleKey,
  label: event.label,
  format: event.format,
  createdAt: new Date().toISOString(),
  resetAt: event.resetAt || null,
  completed: false,
  archived: false,
  groups: {},
};

  for (const letter of Object.keys(event.groups)) {
    const group = event.groups[letter];
    if (!group) continue;

    const channel = await fetchChannel(group.channelId);
    if (!channel) continue;

    const matches = enrichMatches(letter, group.teams);

    const scheduleMessage = await channel.send({
      embeds: [buildScheduleEmbed(event.label, letter, matches)],
      components: [buildScheduleButtons(eventKey, letter)],
    });

    storedEvent.groups[letter] = {
  channelId: group.channelId,
  scheduleMessageId: scheduleMessage.id,
  matches,
  release: {
    slots: {
      1: {
        released: false,
        inviteStart: null,
        inviteEnd: null,
        releasedAt: null,
        lastReminderAt: null,
      },
      2: {
        released: false,
        inviteStart: null,
        inviteEnd: null,
        releasedAt: null,
        lastReminderAt: null,
      },
      3: {
        released: false,
        inviteStart: null,
        inviteEnd: null,
        releasedAt: null,
        lastReminderAt: null,
      },
    },
    koWaiting: {
      lastDoneNoticeAt: null,
      lastBlockerNoticeAt: null,
    },
  },
};
  }

  resultsData[eventKey] = storedEvent;
saveResults(resultsData);

for (const letter of Object.keys(storedEvent.groups)) {
  await updateGroupMessages(eventKey, letter);
}

console.log(`✅ Spielpläne für ${event.label} erstellt.`);
}

function shouldCreateSchedule(event) {
  return !!(event && event.createdAt);
}

async function reconcileSchedules() {
  const groupsData = loadGroups();

  if (groupsData.friday && !isEventInactive(groupsData.friday) && shouldCreateSchedule(groupsData.friday)) {
    await createScheduleForEvent('friday');
  }

  if (groupsData.saturday && !isEventInactive(groupsData.saturday) && shouldCreateSchedule(groupsData.saturday)) {
    await createScheduleForEvent('saturday');
  }
}

// =========================
// INTERACTION FLOW
// =========================

async function handleOpenResult(interaction, eventKey, groupLetter) {
  const resultsData = loadResults();
  const groupsData = loadGroups();

  const data = getEventAndGroup(resultsData, eventKey, groupLetter);
  if (!data) {
    await interaction.reply({
      content: '❌ Spielplan nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  if (!groupMeta) {
    await interaction.reply({
      content: '❌ Gruppendaten nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const allowedMatches = data.group.matches.filter(match => {
  if (match.isByeMatch) return false;
  if (match.status === 'confirmed') return false;
if (match.status === 'disputed') return false;
  if (!isMatchReleased(data.group, match.matchNumber)) return false;

  const { home, away } = getTeamsOfMatch(match, groupMeta.teams);
  const ownTeam = isTeamAuthorized(interaction.user.id, home) ? home : away;
if (!ownTeam) return false;

if (match.teamReports && match.teamReports[ownTeam.teamId]) return false;
  return isTeamAuthorized(interaction.user.id, home) || isTeamAuthorized(interaction.user.id, away);
});

  if (allowedMatches.length === 0) {
    await interaction.reply({
      content: '❌ Für dich gibt es aktuell kein freigegebenes offenes Spiel zum Eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`result_select:${eventKey}:${groupLetter}`)
    .setPlaceholder('Wähle das Spiel aus')
    .addOptions(
      allowedMatches.map(match => ({
        label: `${match.homeClubName} vs ${match.awayClubName}`,
        description: `Spiel ${match.matchNumber} • ${match.timeWindow}`,
        value: String(match.matchNumber),
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.reply({
    content: 'Wähle das Spiel aus, für das du ein Ergebnis eintragen willst.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleBackupReplaceOpen(interaction, eventKey, groupLetter) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Nachrücker einsetzen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const groupsData = loadGroups();
  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];

  if (!groupMeta || !Array.isArray(groupMeta.teams)) {
    await interaction.reply({
      content: '❌ Gruppendaten nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const options = groupMeta.teams.map(team => ({
    label: team.clubName,
    description: 'Dieses Team ersetzen',
    value: team.teamId,
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`backup_replace_target:${eventKey}:${groupLetter}`)
      .setPlaceholder('Welches Team soll ersetzt werden?')
      .addOptions(options)
  );

  await interaction.reply({
    content: 'Wähle zuerst das Team aus, das ersetzt werden soll.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleBackupReplaceTarget(interaction, eventKey, groupLetter) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Nachrücker einsetzen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const targetTeamId = interaction.values?.[0];
  const backups = getBackupTeamsForEvent(eventKey);

  if (!targetTeamId || backups.length === 0) {
    await interaction.reply({
      content: '❌ Kein Zielteam oder kein Nachrücker gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const options = backups.map(team => ({
    label: team.clubName,
    description: 'Dieses Team einsetzen',
    value: `${targetTeamId}|${team.teamId}`,
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`backup_replace_insert:${eventKey}:${groupLetter}`)
      .setPlaceholder('Welches Nachrücker-Team soll rein?')
      .addOptions(options)
  );

  await interaction.update({
    content: 'Wähle jetzt das Nachrücker-Team aus.',
    components: [row],
  });

  return true;
}

async function handleBackupReplaceInsert(interaction, eventKey, groupLetter) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Nachrücker einsetzen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const [targetTeamId, backupTeamId] = String(interaction.values?.[0] || '').split('|');

  if (!targetTeamId || !backupTeamId) {
    await interaction.reply({
      content: '❌ Auswahl ungültig.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const replaced = await replaceTeamInGroup(eventKey, groupLetter, targetTeamId, backupTeamId);

if (!replaced) {
  await interaction.update({
    content: '❌ Nachrücker konnte nicht eingesetzt werden. Prüfe, ob Zielteam und Nachrücker noch vorhanden sind.',
    components: [],
  });
  return true;
}

await interaction.update({
  content: '✅ Nachrücker wurde eingesetzt und Gruppe/Spielplan wurden aktualisiert.',
  components: [],
});

  return true;
}

async function handleAdminResultOpen(interaction, eventKey, groupLetter) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Ergebnisse manuell eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const resultsData = loadResults();
  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];

  if (!resultGroup || !Array.isArray(resultGroup.matches)) {
    await interaction.reply({
      content: '❌ Spielplan nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const matches = resultGroup.matches.filter(match => !match.isByeMatch);

  if (matches.length === 0) {
    await interaction.reply({
      content: '❌ Keine Spiele gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_result_select:${eventKey}:${groupLetter}`)
      .setPlaceholder('Welches Spiel willst du eintragen?')
      .addOptions(
        matches.map(match => ({
          label: `${match.matchNumber}. ${match.homeClubName} vs ${match.awayClubName}`,
          description: match.reportedScore
            ? `Aktuell: ${match.reportedScore.home}:${match.reportedScore.away}`
            : 'Noch kein Ergebnis',
          value: String(match.matchNumber),
        }))
      )
  );

  await interaction.reply({
    content: 'Wähle das Spiel aus, das du als Admin eintragen willst.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleAdminResultSelect(interaction, eventKey, groupLetter) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Ergebnisse manuell eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const resultsData = loadResults();
  const matchNumber = Number(interaction.values[0]);
  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];
  const match = resultGroup?.matches?.find(m => Number(m.matchNumber) === matchNumber);

  if (!match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`admin_result_modal:${eventKey}:${groupLetter}:${matchNumber}`)
    .setTitle('Admin-Ergebnis eintragen');

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

async function handleAdminResultModal(interaction, eventKey, groupLetter, matchNumber) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen Ergebnisse manuell eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const resultsData = loadResults();
  const groupsData = loadGroups();

  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];
  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];
  const match = resultGroup?.matches?.find(m => Number(m.matchNumber) === Number(matchNumber));

  if (!resultGroup || !groupMeta || !match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const homeGoalsRaw = interaction.fields.getTextInputValue('home_goals').trim();
  const awayGoalsRaw = interaction.fields.getTextInputValue('away_goals').trim();

  if (!/^\d+$/.test(homeGoalsRaw) || !/^\d+$/.test(awayGoalsRaw)) {
    await interaction.reply({
      content: '❌ Bitte gib nur ganze Zahlen ein.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const homeGoals = Number(homeGoalsRaw);
  const awayGoals = Number(awayGoalsRaw);

  if (homeGoals > 20 || awayGoals > 20) {
    await interaction.reply({
      content: '❌ Bitte gib ein Ergebnis zwischen 0 und 20 ein.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (match.confirmationMessageId) {
    await deleteMessageIfExists(groupMeta.channelId, match.confirmationMessageId);
    match.confirmationMessageId = null;
  }

if (match.disputeMessageId) {
  await deleteMessageIfExists(groupMeta.channelId, match.disputeMessageId);
  match.disputeMessageId = null;
}

  match.status = 'confirmed';
  match.reportedByTeamId = null;
  match.reportedScore = {
    home: homeGoals,
    away: awayGoals,
  };
  match.confirmed = true;
  match.teamReports = {};
match.waitingForTeamId = null;
match.waitingForClubName = null;
match.status = 'confirmed';

  saveResults(resultsData);

  await updateGroupMessages(eventKey, groupLetter);

  await interaction.reply({
    content: `✅ Admin-Ergebnis eingetragen: **${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}**`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleSelectResult(interaction, eventKey, groupLetter) {
  const resultsData = loadResults();
  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];
  const matchNumber = Number(interaction.values[0]);

  if (!resultGroup) {
    await interaction.reply({
      content: '❌ Spielplan nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const match = resultGroup.matches.find(m => m.matchNumber === matchNumber);
  if (!match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (match.isByeMatch) {
  await interaction.reply({
    content: '❌ Dieses Spiel ist eine automatische Freilos-Wertung und muss nicht eingetragen werden.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

  if (match.status === 'confirmed') {
  await interaction.reply({
    content: '❌ Dieses Spiel wurde bereits bestätigt.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

if (match.status === 'disputed') {
  await interaction.reply({
    content: '❌ Dieses Spiel ist aktuell in Admin-Klärung.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}
  
  if (!isMatchReleased(resultGroup, match.matchNumber)) {
  await interaction.reply({
    content: '❌ Dieses Spiel wurde noch nicht freigegeben.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

  const modal = new ModalBuilder()
    .setCustomId(`result_modal:${eventKey}:${groupLetter}:${matchNumber}`)
    .setTitle('Ergebnis eintragen');

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

async function handleResultModal(interaction, eventKey, groupLetter, matchNumber) {
  const resultsData = loadResults();
  const groupsData = loadGroups();

  const resultGroup = resultsData[eventKey]?.groups?.[groupLetter];
  const groupMeta = groupsData[eventKey]?.groups?.[groupLetter];

  if (!resultGroup || !groupMeta) {
    await interaction.reply({
      content: '❌ Gruppenspiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const match = resultGroup.matches.find(m => m.matchNumber === Number(matchNumber));
  if (!match) {
    await interaction.reply({
      content: '❌ Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (match.isByeMatch) {
  await interaction.reply({
    content: '❌ Dieses Spiel ist eine automatische Freilos-Wertung und muss nicht eingetragen werden.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

  if (match.status === 'confirmed') {
    await interaction.reply({
      content: '❌ Dieses Spiel wurde bereits bestätigt und kann nicht erneut gemeldet werden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  
  if (match.status === 'disputed') {
  await interaction.reply({
    content: '❌ Dieses Spiel ist aktuell in Admin-Klärung.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}
  
  if (!isMatchReleased(resultGroup, match.matchNumber)) {
  await interaction.reply({
    content: '❌ Dieses Spiel wurde noch nicht freigegeben.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

  const { home, away } = getTeamsOfMatch(match, groupMeta.teams);

  const canReport =
    isTeamAuthorized(interaction.user.id, home) ||
    isTeamAuthorized(interaction.user.id, away);

  if (!canReport) {
    await interaction.reply({
      content: '❌ Du darfst für dieses Spiel kein Ergebnis eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const homeGoalsRaw = interaction.fields.getTextInputValue('home_goals').trim();
  const awayGoalsRaw = interaction.fields.getTextInputValue('away_goals').trim();

  if (!/^\d+$/.test(homeGoalsRaw) || !/^\d+$/.test(awayGoalsRaw)) {
    await interaction.reply({
      content: '❌ Bitte gib nur ganze Zahlen ein.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const homeGoals = Number(homeGoalsRaw);
  const awayGoals = Number(awayGoalsRaw);

  if (homeGoals > 20 || awayGoals > 20) {
    await interaction.reply({
      content: '❌ Bitte gib ein Ergebnis zwischen 0 und 20 ein.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const reportingTeam = isTeamAuthorized(interaction.user.id, home) ? home : away;
const opponentTeam = reportingTeam.teamId === home.teamId ? away : home;

if (!match.teamReports) {
  match.teamReports = {};
}

if (match.teamReports[reportingTeam.teamId]) {
  await interaction.reply({
    content: '❌ Dein Team hat für dieses Spiel bereits ein Ergebnis eingetragen.',
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

match.teamReports[reportingTeam.teamId] = {
  home: homeGoals,
  away: awayGoals,
  reportedByUserId: interaction.user.id,
  reportedAt: nowIso(),
};

const homeReport = match.teamReports[home.teamId];
const awayReport = match.teamReports[away.teamId];

if (homeReport && awayReport) {
  if (scoresMatch(homeReport, awayReport)) {
    match.status = 'confirmed';
    match.reportedScore = {
      home: homeGoals,
      away: awayGoals,
    };
    match.confirmed = true;
    match.reportedByTeamId = null;
    match.waitingForTeamId = null;
    match.waitingForClubName = null;
  } else {
    match.status = 'disputed';
    match.confirmed = false;
    match.reportedScore = null;
    match.waitingForTeamId = null;
    match.waitingForClubName = null;

    if (!match.disputeMessageId) {
      match.disputeMessageId = await sendDisputeNotice(eventKey, groupLetter, match, groupMeta);
    }
  }
} else {
  match.status = 'awaiting';
  match.confirmed = false;
  match.reportedScore = null;
  match.waitingForTeamId = opponentTeam.teamId;
  match.waitingForClubName = opponentTeam.clubName;
}

saveResults(resultsData);

await updateGroupMessages(eventKey, groupLetter);

await interaction.reply({
  content:
    match.status === 'confirmed'
      ? `✅ Ergebnis passt bei beiden Teams. Spiel bestätigt: **${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}**`
      : match.status === 'disputed'
        ? '🚨 Ergebnis weicht ab. Admin wurde zur Klärung informiert.'
        : `✅ Ergebnis eingetragen. Wartet jetzt auf **${opponentTeam.clubName}**.`,
  flags: MessageFlags.Ephemeral,
});
    return true;
}

// =========================
// EXPORTS
// =========================

module.exports = {
  processGroupReleaseTimes,

  async init(client) {
    clientRef = client;
    ensureResultsFile();

    await reconcileSchedules();
    await processGroupReleaseTimes('friday');
await processGroupReleaseTimes('saturday');

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await reconcileSchedules();
          
          await processGroupReleaseTimes('friday');
await processGroupReleaseTimes('saturday');
        } catch (error) {
          console.error('❌ Fehler im Result-Intervall:', error);
        }
      }, 60000);
    }
  },

  async handleInteraction(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('result_open:')) {
      const [, eventKey, groupLetter] = interaction.customId.split(':');
      return handleOpenResult(interaction, eventKey, groupLetter);
    }

    if (interaction.customId.startsWith('admin_result_open:')) {
      const [, eventKey, groupLetter] = interaction.customId.split(':');
      return handleAdminResultOpen(interaction, eventKey, groupLetter);
    }

    if (interaction.customId.startsWith('backup_replace_open:')) {
      const [, eventKey, groupLetter] = interaction.customId.split(':');
      return handleBackupReplaceOpen(interaction, eventKey, groupLetter);
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('result_select:')) {
      const [, eventKey, groupLetter] = interaction.customId.split(':');
      return handleSelectResult(interaction, eventKey, groupLetter);
    }

    if (interaction.customId.startsWith('admin_result_select:')) {
      const [, eventKey, groupLetter] = interaction.customId.split(':');
      return handleAdminResultSelect(interaction, eventKey, groupLetter);
    }

    if (interaction.customId.startsWith('backup_replace_target:')) {
      const [, eventKey, groupLetter] = interaction.customId.split(':');
      return handleBackupReplaceTarget(interaction, eventKey, groupLetter);
    }

    if (interaction.customId.startsWith('backup_replace_insert:')) {
      const [, eventKey, groupLetter] = interaction.customId.split(':');
      return handleBackupReplaceInsert(interaction, eventKey, groupLetter);
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('result_modal:')) {
      const [, eventKey, groupLetter, matchNumber] = interaction.customId.split(':');
      return handleResultModal(interaction, eventKey, groupLetter, matchNumber);
    }

    if (interaction.customId.startsWith('admin_result_modal:')) {
      const [, eventKey, groupLetter, matchNumber] = interaction.customId.split(':');
      return handleAdminResultModal(interaction, eventKey, groupLetter, matchNumber);
    }
  }

  return false;
},

  async handleMessage() {
    return false;
  },
};