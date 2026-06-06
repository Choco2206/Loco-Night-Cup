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
      confirmed: hasByeTeam,
      confirmationMessageId: null,
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

      if (match.status === 'reported' && match.reportedScore) {
        status = `📝 Gemeldet: ${match.reportedScore.home}:${match.reportedScore.away}`;
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
      .setStyle(ButtonStyle.Primary)
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

function buildTableEmbed(eventLabel, groupLetter, rows) {
  return new EmbedBuilder()
    .setTitle(`🏆 ${eventLabel} • Gruppe ${groupLetter} • Live-Tabelle`)
    .setDescription(
      rows.length > 0 ? buildTableText(rows) : 'Noch keine Teams in dieser Gruppe.'
    )
    .setColor(0xff0000);
}

function buildConfirmationButtons(eventKey, groupLetter, matchNumber) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`result_confirm:${eventKey}:${groupLetter}:${matchNumber}`)
      .setLabel('✅ Bestätigen')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`result_reject:${eventKey}:${groupLetter}:${matchNumber}`)
      .setLabel('❌ Ablehnen')
      .setStyle(ButtonStyle.Danger)
  );
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
      `Bitte meldet oder bestätigt die offenen Ergebnisse, damit der nächste Zeitslot freigegeben werden kann.`,
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
        `Bitte meldet oder bestätigt die noch offenen Ergebnisse, damit die K.O.-Phase gestartet werden kann.`,
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
releaseState.lastReminderAt = nowIso();

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

  const nowMinutes = getCurrentMinutes();

  for (const groupLetter of Object.keys(event.groups)) {
    const resultGroup = event.groups[groupLetter];
    if (!resultGroup) continue;

    ensureGroupReleaseState(resultGroup);

    for (const slot of GROUP_RELEASE_SLOTS) {
      const releaseState = resultGroup.release.slots[slot.slot];
      if (releaseState.released) continue;

      const plannedStartMinutes = parseTimeToMinutes(slot.plannedStart);
      if (nowMinutes < plannedStartMinutes) continue;

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
        const isLate = nowMinutes > plannedStartMinutes;
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

  const nowMinutes = getCurrentMinutes();
  const koStartMinutes = parseTimeToMinutes(KO_EARLIEST_START);

  if (nowMinutes < koStartMinutes) return;

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
  if (match.status === 'reported') return false;
  if (match.status === 'confirmed') return false;
  if (!isMatchReleased(data.group, match.matchNumber)) return false;

  const { home, away } = getTeamsOfMatch(match, groupMeta.teams);
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

  if (match.status === 'reported') {
    await interaction.reply({
      content: '❌ Für dieses Spiel wurde bereits ein Ergebnis gemeldet. Bitte warte auf Bestätigung oder Ablehnung.',
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

  if (match.status === 'reported') {
    await interaction.reply({
      content: '❌ Für dieses Spiel wurde bereits ein Ergebnis gemeldet. Bitte warte auf Bestätigung oder Ablehnung.',
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

  match.status = 'reported';
  match.reportedByTeamId = reportingTeam.teamId;
  match.reportedScore = {
    home: homeGoals,
    away: awayGoals,
  };
  match.confirmed = false;

  const channel = await fetchChannel(groupMeta.channelId);
  if (!channel) {
    await interaction.reply({
      content: '❌ Kanal konnte nicht geladen werden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (match.confirmationMessageId) {
    await deleteMessageIfExists(groupMeta.channelId, match.confirmationMessageId);
    match.confirmationMessageId = null;
  }

  const opponentMentions = [
    opponentTeam.managerId,
    ...(Array.isArray(opponentTeam.coManagerIds) ? opponentTeam.coManagerIds : []),
  ]
    .filter(Boolean)
    .map(id => `<@${id}>`)
    .join(' ');

  const confirmMessage = await channel.send({
    content: [
      `⚠️ **Ergebnis gemeldet**`,
      '',
      `**${match.homeClubName} ${match.reportedScore.home}:${match.reportedScore.away} ${match.awayClubName}**`,
      '',
      `Nur das gegnerische Team darf jetzt bestätigen oder ablehnen.`,
      opponentMentions || '*Keine VM/Co-VM-Verlinkung gefunden.*',
    ].join('\n'),
    components: [buildConfirmationButtons(eventKey, groupLetter, match.matchNumber)],
  });

  match.confirmationMessageId = confirmMessage.id;
  saveResults(resultsData);

  await updateGroupMessages(eventKey, groupLetter);

  await interaction.reply({
    content: `✅ Ergebnis wurde gemeldet. Jetzt muss **${opponentTeam.clubName}** bestätigen.`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleConfirmResult(interaction, eventKey, groupLetter, matchNumber) {
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
  if (!match || match.status !== 'reported' || !match.reportedScore) {
    await interaction.reply({
      content: '❌ Für dieses Spiel gibt es aktuell kein offenes Ergebnis zur Bestätigung.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const { home, away } = getTeamsOfMatch(match, groupMeta.teams);

  const reportingTeamId = match.reportedByTeamId;
  const opponentTeam = reportingTeamId === home.teamId ? away : home;

  if (!isTeamAuthorized(interaction.user.id, opponentTeam)) {
    await interaction.reply({
      content: '❌ Nur das gegnerische Team darf dieses Ergebnis bestätigen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  match.status = 'confirmed';
  match.confirmed = true;
  saveResults(resultsData);

  await updateGroupMessages(eventKey, groupLetter);

if (match.confirmationMessageId) {
  setTimeout(async () => {
    await deleteMessageIfExists(groupMeta.channelId, match.confirmationMessageId);
  }, 4000);
}

await interaction.reply({
  content: `✅ Ergebnis bestätigt: **${match.homeClubName} ${match.reportedScore.home}:${match.reportedScore.away} ${match.awayClubName}**`,
  flags: MessageFlags.Ephemeral,
});

await processGroupReleaseTimes(eventKey);

return true;
}

async function handleRejectResult(interaction, eventKey, groupLetter, matchNumber) {
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
  if (!match || match.status !== 'reported' || !match.reportedScore) {
    await interaction.reply({
      content: '❌ Für dieses Spiel gibt es aktuell kein offenes Ergebnis zur Ablehnung.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const { home, away } = getTeamsOfMatch(match, groupMeta.teams);

  const reportingTeamId = match.reportedByTeamId;
  const opponentTeam = reportingTeamId === home.teamId ? away : home;

  if (!isTeamAuthorized(interaction.user.id, opponentTeam)) {
    await interaction.reply({
      content: '❌ Nur das gegnerische Team darf dieses Ergebnis ablehnen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  match.status = 'pending';
  match.reportedByTeamId = null;
  match.reportedScore = null;
  match.confirmed = false;
  saveResults(resultsData);

  await updateGroupMessages(eventKey, groupLetter);

if (match.confirmationMessageId) {
  setTimeout(async () => {
    await deleteMessageIfExists(groupMeta.channelId, match.confirmationMessageId);
  }, 4000);
}

await interaction.reply({
  content: '❌ Ergebnis wurde abgelehnt. Das Spiel ist jetzt wieder offen und kann neu gemeldet werden.',
  flags: MessageFlags.Ephemeral,
});

await processGroupReleaseTimes(eventKey);

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

      if (interaction.customId.startsWith('result_confirm:')) {
        const [, eventKey, groupLetter, matchNumber] = interaction.customId.split(':');
        return handleConfirmResult(interaction, eventKey, groupLetter, matchNumber);
      }

      if (interaction.customId.startsWith('result_reject:')) {
        const [, eventKey, groupLetter, matchNumber] = interaction.customId.split(':');
        return handleRejectResult(interaction, eventKey, groupLetter, matchNumber);
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('result_select:')) {
        const [, eventKey, groupLetter] = interaction.customId.split(':');
        return handleSelectResult(interaction, eventKey, groupLetter);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('result_modal:')) {
        const [, eventKey, groupLetter, matchNumber] = interaction.customId.split(':');
        return handleResultModal(interaction, eventKey, groupLetter, matchNumber);
      }
    }

    return false;
  },

  async handleMessage() {
    return false;
  },
};