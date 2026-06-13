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

const { sendTournamentCeremonyIfReady } = require('./announcement');

const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');
const RESULTS_FILE = path.join(process.cwd(), 'data', 'results.json');
const KO_FILE = path.join(process.cwd(), 'data', 'ko.json');
const KO_CLEANUP_GRACE_MS = 0;
const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const INVITE_WINDOW_MINUTES = 5;
const KO_FIRST_REMINDER_AFTER_INVITE_MS = 20 * 60 * 1000;
const KO_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const KO_NEXT_ROUND_BUFFER_MS = 0;

let clientRef = null;
let intervalRef = null;
let koProcessing = false;
const EVENT_TYPES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// =========================
// FILE HELPERS
// =========================

function ensureKoFile() {
  const dir = path.dirname(KO_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(KO_FILE)) {
    fs.writeFileSync(
      KO_FILE,
      JSON.stringify(
        {
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
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
      return {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      };
    }

    const raw = fs.readFileSync(GROUPS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      monday: parsed.monday || null,
      tuesday: parsed.tuesday || null,
      wednesday: parsed.wednesday || null,
      thursday: parsed.thursday || null,
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
      sunday: parsed.sunday || null,
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen von groups.json:', error);

    return {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
  }
}

function loadResults() {
  try {
    if (!fs.existsSync(RESULTS_FILE)) {
      return {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      };
    }

    const raw = fs.readFileSync(RESULTS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      monday: parsed.monday || null,
      tuesday: parsed.tuesday || null,
      wednesday: parsed.wednesday || null,
      thursday: parsed.thursday || null,
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
      sunday: parsed.sunday || null,
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen von results.json:', error);

    return {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
  }
}

function loadCheckins() {
  try {
    if (!fs.existsSync(CHECKINS_FILE)) {
      return {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      };
    }

    const raw = fs.readFileSync(CHECKINS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      monday: parsed.monday || null,
      tuesday: parsed.tuesday || null,
      wednesday: parsed.wednesday || null,
      thursday: parsed.thursday || null,
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
      sunday: parsed.sunday || null,
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen von checkins.json:', error);

    return {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
  }
}

function loadKo() {
  ensureKoFile();

  try {
    const raw = fs.readFileSync(KO_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      monday: parsed.monday || null,
      tuesday: parsed.tuesday || null,
      wednesday: parsed.wednesday || null,
      thursday: parsed.thursday || null,
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
      sunday: parsed.sunday || null,
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen von ko.json:', error);

    return {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
  }
}

function saveKo(data) {
  try {
    fs.writeFileSync(KO_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Fehler beim Schreiben von ko.json:', error);
  }
}

// =========================
// HELPERS
// =========================

function isUserAllowedForTeam(userId, team) {
  if (!userId || !team) return false;

  const allowedIds = [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ]
    .filter(Boolean)
    .map(id => String(id));

  return allowedIds.includes(String(userId));
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.clubName.localeCompare(b.clubName, 'de');
  });
}

function getRoundChannelId(roundKey) {
  if (roundKey === 'roundOf16') return process.env.KO_ROUND_OF_16_CHANNEL_ID;
  if (roundKey === 'quarterFinal') return process.env.KO_QUARTERFINAL_CHANNEL_ID;
  if (roundKey === 'semiFinal') return process.env.KO_SEMIFINAL_CHANNEL_ID;
  if (roundKey === 'thirdPlace') return process.env.KO_THIRD_PLACE_CHANNEL_ID;
  if (roundKey === 'final') return process.env.KO_FINAL_CHANNEL_ID;
  return null;
}

function getRoundRoleId(roundKey) {
  if (roundKey === 'roundOf16') return process.env.KO_ROUND_OF_16_ROLE_ID;
  if (roundKey === 'quarterFinal') return process.env.KO_QUARTERFINAL_ROLE_ID;
  if (roundKey === 'semiFinal') return process.env.KO_SEMIFINAL_ROLE_ID;
  if (roundKey === 'thirdPlace') return process.env.KO_THIRD_PLACE_ROLE_ID;
  if (roundKey === 'final') return process.env.KO_FINAL_ROLE_ID;
  return null;
}

function getAllKoRoleIds() {
  return [
    process.env.KO_ROUND_OF_16_ROLE_ID,
    process.env.KO_QUARTERFINAL_ROLE_ID,
    process.env.KO_SEMIFINAL_ROLE_ID,
    process.env.KO_THIRD_PLACE_ROLE_ID,
    process.env.KO_FINAL_ROLE_ID,
  ].filter(Boolean);
}

function getRoundLabel(roundKey) {
  if (roundKey === 'roundOf16') return 'Achtelfinale';
  if (roundKey === 'quarterFinal') return 'Viertelfinale';
  if (roundKey === 'semiFinal') return 'Halbfinale';
  if (roundKey === 'thirdPlace') return 'Spiel um Platz 3';
  if (roundKey === 'final') return 'Finale';
  return 'K.O.-Phase';
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

function isAdmin(interaction) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (!adminRoleId) return false;

  return interaction.member?.roles?.cache?.has(adminRoleId);
}

async function sendKoDisputeNotice(eventKey, roundKey, match, round) {
  const channel = await fetchChannel(round.channelId);
  if (!channel) return null;

  const message = await channel.send({
    content: [
      `🚨 ${getAdminPing()} **K.O.-Ergebnis stimmt nicht überein**`,
      '',
      `**${getRoundLabel(roundKey)}**`,
      `**${match.homeClubName} vs ${match.awayClubName}**`,
      '',
      `Bitte prüfen und per **Admin-Ergebnis** final eintragen.`,
    ].join('\n'),
  });

  return message.id;
}

function getDynamicWindowFromNow() {
  const start = getCurrentMinutes();
  const end = start + INVITE_WINDOW_MINUTES;

  return {
    startText: formatMinutes(start),
    endText: formatMinutes(end),
    windowText: `${formatMinutes(start)}–${formatMinutes(end)}`,
  };
}

function isEventExpired(event) {
  if (!event?.resetAt) return false;
  return Date.now() >= Number(event.resetAt);
}

function isEventInactive(event) {
  return !event || event.completed || event.archived || isEventExpired(event);
}

function getRoundCompletedAt(round) {
  if (!round?.matches?.length) return null;

  const confirmedTimes = round.matches
    .map(match => match.confirmedAt)
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(value => !Number.isNaN(value));

  if (!confirmedTimes.length) return null;

  return Math.max(...confirmedTimes);
}

function canAdvanceAfterBuffer(round) {
  const completedAt = getRoundCompletedAt(round);
  if (!completedAt) return false;

  return Date.now() >= completedAt + KO_NEXT_ROUND_BUFFER_MS;
}

function ensureRoundReleaseState(round) {
  if (!round.release) {
    round.release = {
      released: false,
      releasedAt: null,
      inviteStart: null,
      inviteEnd: null,
      lastReminderAt: null,
      earliestReleaseAt: null,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(round.release, 'earliestReleaseAt')) {
    round.release.earliestReleaseAt = null;
  }
}

function isRoundReleased(round) {
  ensureRoundReleaseState(round);
  return round.release.released === true;
}

function canSendKoReminder(lastReminderAt) {
  if (!lastReminderAt) return true;
  return Date.now() - new Date(lastReminderAt).getTime() >= KO_REMINDER_INTERVAL_MS;
}

function getOpenKoMatches(matches) {
  return matches.filter(match => match.status !== 'confirmed');
}

function buildKoOpenMatchesText(matches) {
  if (!matches.length) return 'Keine offenen Spiele gefunden.';

  return matches
    .map(match => {
      const homeMentions = [
        match.homeManagerId,
        ...(match.homeCoManagerIds || []),
      ]
        .filter(Boolean)
        .map(id => `<@${id}>`)
        .join(' ');

      const awayMentions = [
        match.awayManagerId,
        ...(match.awayCoManagerIds || []),
      ]
        .filter(Boolean)
        .map(id => `<@${id}>`)
        .join(' ');

      return [
        `**${match.homeClubName} vs ${match.awayClubName}**`,
        homeMentions || '*Keine VM/Co-VM gefunden*',
        awayMentions || '*Keine VM/Co-VM gefunden*',
      ].join('\n');
    })
    .join('\n\n');
}

function cloneTeam(row) {
  return {
    teamId: row.teamId,
    clubName: row.clubName,
    managerId: row.managerId,
    coManagerIds: Array.isArray(row.coManagerIds) ? row.coManagerIds : [],
  };
}

function getTeamUserIds(team) {
  return [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ].filter(Boolean);
}

function getUserIdsFromMatches(matches) {
  const userIds = new Set();

  for (const match of matches) {
    [
      match.homeManagerId,
      ...(match.homeCoManagerIds || []),
      match.awayManagerId,
      ...(match.awayCoManagerIds || []),
    ]
      .filter(Boolean)
      .forEach(id => userIds.add(id));
  }

  return [...userIds];
}

function buildKoRoundMentions(matches) {
  const userIds = getUserIdsFromMatches(matches);

  return userIds.length
    ? userIds.map(id => `<@${id}>`).join(' ')
    : '';
}

function getQualifiedTeamsFromGroups(eventKey) {
  const groupsData = loadGroups();
  const event = groupsData[eventKey];
  if (!event || !event.groups) return null;

  const format = event.format;
  const groupLetters = Object.keys(event.groups).sort();

  const groupPlacements = {};
  for (const letter of groupLetters) {
    const rows = sortRows(event.groups[letter].rows || []);
    groupPlacements[letter] = rows;
  }

  if (format === 8) {
    return {
      format,
      semiFinal: [
        [cloneTeam(groupPlacements.A[0]), cloneTeam(groupPlacements.B[1])],
        [cloneTeam(groupPlacements.B[0]), cloneTeam(groupPlacements.A[1])],
      ],
    };
  }

  if (format === 16) {
    return {
      format,
      quarterFinal: [
        [cloneTeam(groupPlacements.A[0]), cloneTeam(groupPlacements.B[1])],
        [cloneTeam(groupPlacements.B[0]), cloneTeam(groupPlacements.A[1])],
        [cloneTeam(groupPlacements.C[0]), cloneTeam(groupPlacements.D[1])],
        [cloneTeam(groupPlacements.D[0]), cloneTeam(groupPlacements.C[1])],
      ],
    };
  }

  if (format === 24) {
  const winners = groupLetters.map(letter => cloneTeam(groupPlacements[letter][0]));
  const runners = groupLetters.map(letter => cloneTeam(groupPlacements[letter][1]));

  const thirdRows = groupLetters
    .map(letter => groupPlacements[letter][2])
    .filter(Boolean);

  const bestThirds = sortRows(thirdRows)
    .slice(0, 4)
    .map(cloneTeam);

  return {
    format,
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
      format,
      roundOf16: [
        [cloneTeam(groupPlacements.A[0]), cloneTeam(groupPlacements.B[1])],
        [cloneTeam(groupPlacements.B[0]), cloneTeam(groupPlacements.A[1])],
        [cloneTeam(groupPlacements.C[0]), cloneTeam(groupPlacements.D[1])],
        [cloneTeam(groupPlacements.D[0]), cloneTeam(groupPlacements.C[1])],
        [cloneTeam(groupPlacements.E[0]), cloneTeam(groupPlacements.F[1])],
        [cloneTeam(groupPlacements.F[0]), cloneTeam(groupPlacements.E[1])],
        [cloneTeam(groupPlacements.G[0]), cloneTeam(groupPlacements.H[1])],
        [cloneTeam(groupPlacements.H[0]), cloneTeam(groupPlacements.G[1])],
      ],
    };
  }

  return null;
}

function createKoMatches(format, roundKey, pairs) {
  const timeWindow = 'Noch nicht freigegeben';

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
disputeMessageId: null,
teamReports: {},
waitingForTeamId: null,
waitingForClubName: null,
winnerTeamId: null,
loserTeamId: null,
    };
  });
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

async function sendKoReleaseMessage(eventKey, roundKey, round, startText, endText) {
  const channel = await fetchChannel(round.channelId);
  if (!channel) return;

  const mentions = buildKoRoundMentions(round.matches);

  await channel.send({
    content: [
      mentions,
      '',
      `✅ **${getRoundLabel(roundKey)} ist freigegeben**`,
      '',
      `Die Spiele dürfen jetzt gestartet werden.`,
      `**Einladezeit: ${startText} – ${endText} Uhr**`,
      '',
      `Bitte meldet euer Ergebnis direkt nach dem Spiel über den Button im K.O.-Plan.`,
    ].filter(Boolean).join('\n'),
  });
}

async function sendKoMissingResultReminder(roundKey, round) {
  const channel = await fetchChannel(round.channelId);
  if (!channel) return;

  const openMatches = getOpenKoMatches(round.matches);

  await channel.send({
    content: [
      `⚠️ **${getRoundLabel(roundKey)} ist noch nicht abgeschlossen**`,
      '',
      `Folgende K.O.-Spiele sind noch offen:`,
      '',
      buildKoOpenMatchesText(openMatches),
      '',
      `Falls ihr noch spielt, in der Verlängerung seid oder ins Elfmeterschießen geht: bitte kurz Bescheid geben.`,
      `Tragt danach das Ergebnis schnellstmöglich ein, damit der Turnierlauf weitergehen kann.`,
      '',
      `Die nächste Runde wird automatisch freigegeben, sobald alle Ergebnisse bestätigt sind.`,
    ].join('\n'),
  });
}

async function purgeKoChannel(channelId) {
  const channel = await fetchChannel(channelId);
  if (!channel) return;

  try {
    let messages;

    do {
      messages = await channel.messages.fetch({ limit: 100 });

      const deletable = messages.filter(message => !message.pinned);

      if (deletable.size > 0) {
        await channel.bulkDelete(deletable, true);
      }
    } while (messages.size === 100);
  } catch (error) {
    console.error(`❌ K.O.-Kanal konnte nicht geleert werden: ${channelId}`, error);
  }
}

async function cleanupKoAfterReset() {
  const koData = loadKo();
  const groupsData = loadGroups();
const checkinsData = loadCheckins();
  let changed = false;

  for (const eventKey of EVENT_TYPES) {
    const event = koData[eventKey];
    if (!event || !event.rounds) continue;

    if (event.koChannelsCleanedAt) continue;

    const resetAt =
  event.resetAt ||
  groupsData[eventKey]?.resetAt ||
  checkinsData[eventKey]?.resetAt;
    if (!resetAt) continue;

    if (Date.now() < Number(resetAt) + KO_CLEANUP_GRACE_MS) continue;

    for (const round of Object.values(event.rounds)) {
      if (round?.matches) {
        await removeKoRolesFromMatches(round.matches);
      }

      if (round?.channelId) {
        await purgeKoChannel(round.channelId);
      }
    }

    event.resetAt = resetAt;
    event.koRolesCleanedAt = new Date().toISOString();
    event.koChannelsCleanedAt = new Date().toISOString();

    changed = true;

    console.log(`✅ K.O.-Kanäle für ${event.label} um 07:00 Uhr bereinigt.`);
  }

  if (changed) {
    saveKo(koData);
  }
}

async function fetchGuildFromKoChannels() {
  const channelIds = [
    process.env.KO_ROUND_OF_16_CHANNEL_ID,
    process.env.KO_QUARTERFINAL_CHANNEL_ID,
    process.env.KO_SEMIFINAL_CHANNEL_ID,
    process.env.KO_THIRD_PLACE_CHANNEL_ID,
    process.env.KO_FINAL_CHANNEL_ID,
  ].filter(Boolean);

  for (const channelId of channelIds) {
    const channel = await fetchChannel(channelId);
    if (channel && channel.guild) return channel.guild;
  }

  return null;
}

// =========================
// ROLE HELPERS
// =========================

async function removeAllKoRolesFromMember(member) {
  const roleIds = getAllKoRoleIds();

  for (const roleId of roleIds) {
    if (!member.roles.cache.has(roleId)) continue;

    try {
      await member.roles.remove(roleId);
    } catch (error) {
      console.warn(`⚠️ K.O.-Rolle konnte nicht entfernt werden: ${member.id} / ${roleId}`);
    }
  }
}

async function assignKoRoleToUserIds(roundKey, userIds) {
  const roleId = getRoundRoleId(roundKey);

  if (!roleId) {
    console.error(`❌ Rollen-ID für ${roundKey} fehlt.`);
    return;
  }

  const guild = await fetchGuildFromKoChannels();

  if (!guild) {
    console.error('❌ Server konnte für K.O.-Rollenvergabe nicht geladen werden.');
    return;
  }

  const role =
    guild.roles.cache.get(roleId) ||
    (await guild.roles.fetch(roleId).catch(() => null));

  if (!role) {
    console.error(`❌ K.O.-Rolle wurde nicht gefunden: ${roundKey} / ${roleId}`);
    return;
  }

  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    try {
      const member = await guild.members.fetch(userId);
      if (!member) continue;

      await removeAllKoRolesFromMember(member);

      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
      }
    } catch (error) {
      console.warn(`⚠️ K.O.-Rolle ${roundKey} konnte nicht vergeben werden an User ${userId}`);
    }
  }
}

async function removeKoRolesFromMatches(matches) {
  const guild = await fetchGuildFromKoChannels();
  if (!guild) return;

  const userIds = getUserIdsFromMatches(matches);

  for (const userId of userIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (!member) continue;

      await removeAllKoRolesFromMember(member);
    } catch (error) {
      console.warn(`⚠️ K.O.-Rollen konnten nicht entfernt werden bei User ${userId}`);
    }
  }
}

async function assignKoRoleToMatches(roundKey, matches) {
  const userIds = getUserIdsFromMatches(matches);
  await assignKoRoleToUserIds(roundKey, userIds);
}

// =========================
// RENDER HELPERS
// =========================

function buildRoundEmbed(eventLabel, roundKey, matches) {
  const lines = matches.map(match => {
    let status = '⏳ Offen';

    if (match.status === 'awaiting' && match.waitingForClubName) {
  status = `⏳ Wartet auf Eintragung von ${match.waitingForClubName}`;
}

if (match.status === 'disputed') {
  status = '🚨 In Klärung mit Admin';
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
    ...(roundKey === 'semiFinal'
      ? [
          '',
          '⚠️ **Hinweis:** Die Verlierer aus dem Halbfinale spielen danach noch das **Spiel um Platz 3**.',
        ]
      : []),
  ].join('\n\n')
)
    .setColor(0xff0000);
}

function buildRoundButtons(eventKey, roundKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ko_result_open:${eventKey}:${roundKey}`)
      .setLabel('⚽ Ergebnis eintragen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ko_admin_result_open:${eventKey}:${roundKey}`)
      .setLabel('🛠️ Admin-Ergebnis')
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendOrEditRoundMessage(eventKey, roundKey, roundData, eventLabel) {
  const channel = await fetchChannel(roundData.channelId);
  if (!channel) return roundData;

  const existing = roundData.messageId ? await fetchMessage(channel, roundData.messageId) : null;

  if (!existing) {
    const created = await channel.send({
      embeds: [buildRoundEmbed(eventLabel, roundKey, roundData.matches)],
      components: [buildRoundButtons(eventKey, roundKey)],
    });

    roundData.messageId = created.id;
    return roundData;
  }

  await existing.edit({
    embeds: [buildRoundEmbed(eventLabel, roundKey, roundData.matches)],
    components: [buildRoundButtons(eventKey, roundKey)],
  });

  return roundData;
}

// =========================
// AUTO GENERATION
// =========================

function allGroupMatchesConfirmed(eventKey) {
  const groupsData = loadGroups();
  const resultsData = loadResults();

  const groupEvent = groupsData[eventKey];
  const resultEvent = resultsData[eventKey];

  if (!groupEvent || !groupEvent.groups) return false;
  if (!resultEvent || !resultEvent.groups) return false;

  if (
    groupEvent.cycleKey &&
    resultEvent.cycleKey &&
    groupEvent.cycleKey !== resultEvent.cycleKey
  ) {
    return false;
  }

  const groupLetters = Object.keys(groupEvent.groups).sort();

  if (groupLetters.length === 0) return false;

  for (const letter of groupLetters) {
    const drawnGroup = groupEvent.groups[letter];
    const resultGroup = resultEvent.groups[letter];

    if (!drawnGroup || !Array.isArray(drawnGroup.matches)) return false;
    if (!resultGroup || !Array.isArray(resultGroup.matches)) return false;

    if (drawnGroup.matches.length === 0) return false;

    if (resultGroup.matches.length !== drawnGroup.matches.length) {
      return false;
    }

    const confirmedMatches = resultGroup.matches.filter(match => {
      return match.status === 'confirmed';
    });

    if (confirmedMatches.length !== drawnGroup.matches.length) {
      return false;
    }
  }

  return true;
}

async function createInitialKoRound(eventKey) {
  const koData = loadKo();
  const groupsData = loadGroups();
  const groupEvent = groupsData[eventKey];

if (!groupEvent) return;
if (isEventInactive(groupEvent)) return;
if (koData[eventKey] && koData[eventKey].cycleKey === groupEvent.cycleKey) return;
if (!allGroupMatchesConfirmed(eventKey)) return;

  const qualified = getQualifiedTeamsFromGroups(eventKey);
  if (!qualified) return;

  const eventStore = {
  cycleKey: groupEvent.cycleKey,
  label: groupEvent.label,
  format: qualified.format,
  createdAt: new Date().toISOString(),
  resetAt: groupEvent.resetAt,
  koChannelsCleanedAt: null,
  koRolesCleanedAt: null,
  rounds: {},
};

  if (qualified.semiFinal) {
    eventStore.rounds.semiFinal = {
      channelId: getRoundChannelId('semiFinal'),
      roleId: getRoundRoleId('semiFinal'),
      messageId: null,
      matches: createKoMatches(qualified.format, 'semiFinal', qualified.semiFinal),
      completed: false,
release: {
  released: false,
  releasedAt: null,
  inviteStart: null,
  inviteEnd: null,
  lastReminderAt: null,
},
    };

    await assignKoRoleToMatches('semiFinal', eventStore.rounds.semiFinal.matches);

  }

  if (qualified.quarterFinal) {
    eventStore.rounds.quarterFinal = {
  channelId: getRoundChannelId('quarterFinal'),
  roleId: getRoundRoleId('quarterFinal'),
  messageId: null,
  matches: createKoMatches(qualified.format, 'quarterFinal', qualified.quarterFinal),
  completed: false,
  release: {
    released: false,
    releasedAt: null,
    inviteStart: null,
    inviteEnd: null,
    lastReminderAt: null,
  },
};

    await assignKoRoleToMatches('quarterFinal', eventStore.rounds.quarterFinal.matches);

    
  }

  if (qualified.roundOf16) {
    eventStore.rounds.roundOf16 = {
  channelId: getRoundChannelId('roundOf16'),
  roleId: getRoundRoleId('roundOf16'),
  messageId: null,
  matches: createKoMatches(qualified.format, 'roundOf16', qualified.roundOf16),
  completed: false,
  release: {
    released: false,
    releasedAt: null,
    inviteStart: null,
    inviteEnd: null,
    lastReminderAt: null,
  },
};

    await assignKoRoleToMatches('roundOf16', eventStore.rounds.roundOf16.matches);

    
  }

  koData[eventKey] = eventStore;
  saveKo(koData);

  console.log(`✅ Erste K.O.-Runde für ${eventStore.label} erstellt und Rollen verteilt.`);
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

function getUserIdsFromTeams(teams) {
  const ids = new Set();

  for (const team of teams) {
    getTeamUserIds(team).forEach(id => ids.add(id));
  }

  return [...ids];
}

async function advanceKoIfReady(eventKey) {
  const koData = loadKo();
  const event = koData[eventKey];
  if (!event || !event.rounds) return;
  if (isEventInactive(event)) return;

  if (event.rounds.roundOf16 && roundIsComplete(event.rounds.roundOf16) && !event.rounds.quarterFinal) {
        if (!canAdvanceAfterBuffer(event.rounds.roundOf16)) return;
    const winners = event.rounds.roundOf16.matches.map(getWinnerStub).filter(Boolean);

    if (winners.length === 8) {
      await removeKoRolesFromMatches(event.rounds.roundOf16.matches);

      const pairs = [
        [winners[0], winners[1]],
        [winners[2], winners[3]],
        [winners[4], winners[5]],
        [winners[6], winners[7]],
      ];

      event.rounds.quarterFinal = {
        channelId: getRoundChannelId('quarterFinal'),
        roleId: getRoundRoleId('quarterFinal'),
        messageId: null,
        matches: createKoMatches(event.format, 'quarterFinal', pairs),
        completed: false,
        release: {
  released: false,
  releasedAt: null,
  inviteStart: null,
  inviteEnd: null,
  lastReminderAt: null,
},
      };

      await assignKoRoleToMatches('quarterFinal', event.rounds.quarterFinal.matches);

saveKo(koData);
await releaseKoRound(eventKey, 'quarterFinal');
return;
    }
  }

  if (event.rounds.quarterFinal && roundIsComplete(event.rounds.quarterFinal) && !event.rounds.semiFinal) {
        if (!canAdvanceAfterBuffer(event.rounds.quarterFinal)) return;
    const winners = event.rounds.quarterFinal.matches.map(getWinnerStub).filter(Boolean);

    if (winners.length === 4) {
      await removeKoRolesFromMatches(event.rounds.quarterFinal.matches);

      const pairs = [
        [winners[0], winners[1]],
        [winners[2], winners[3]],
      ];

      event.rounds.semiFinal = {
        channelId: getRoundChannelId('semiFinal'),
        roleId: getRoundRoleId('semiFinal'),
        messageId: null,
        matches: createKoMatches(event.format, 'semiFinal', pairs),
        completed: false,
        release: {
  released: false,
  releasedAt: null,
  inviteStart: null,
  inviteEnd: null,
  lastReminderAt: null,
},
      };

      await assignKoRoleToMatches('semiFinal', event.rounds.semiFinal.matches);

saveKo(koData);
await releaseKoRound(eventKey, 'semiFinal');
return;
    }
  }

  if (event.rounds.semiFinal && roundIsComplete(event.rounds.semiFinal)) {
        if (!canAdvanceAfterBuffer(event.rounds.semiFinal)) return;
    if (!event.rounds.final || !event.rounds.thirdPlace) {
      const winners = event.rounds.semiFinal.matches.map(getWinnerStub).filter(Boolean);
      const losers = event.rounds.semiFinal.matches.map(getLoserStub).filter(Boolean);

      if (winners.length === 2 && losers.length === 2) {
        await removeKoRolesFromMatches(event.rounds.semiFinal.matches);

        if (!event.rounds.final) {
          event.rounds.final = {
            channelId: getRoundChannelId('final'),
            roleId: getRoundRoleId('final'),
            messageId: null,
            matches: createKoMatches(event.format, 'final', [[winners[0], winners[1]]]),
            completed: false,
            release: {
  released: false,
  releasedAt: null,
  inviteStart: null,
  inviteEnd: null,
  lastReminderAt: null,
},
          };

          await assignKoRoleToUserIds('final', getUserIdsFromTeams(winners));

          
        }

        if (!event.rounds.thirdPlace) {
          event.rounds.thirdPlace = {
            channelId: getRoundChannelId('thirdPlace'),
            roleId: getRoundRoleId('thirdPlace'),
            messageId: null,
            matches: createKoMatches(event.format, 'thirdPlace', [[losers[0], losers[1]]]),
            completed: false,
            release: {
  released: false,
  releasedAt: null,
  inviteStart: null,
  inviteEnd: null,
  lastReminderAt: null,
},
          };

          await assignKoRoleToUserIds('thirdPlace', getUserIdsFromTeams(losers));

          
        }

        saveKo(koData);
await releaseKoRound(eventKey, 'final');
await releaseKoRound(eventKey, 'thirdPlace');
return;
      }
    }
  }
}

async function releaseKoRound(eventKey, roundKey) {
  const koData = loadKo();
  const event = koData[eventKey];
  const round = event?.rounds?.[roundKey];

  if (!event || !round) return;

  ensureRoundReleaseState(round);

  if (round.release.released) return;

  const window = getDynamicWindowFromNow();

  for (const match of round.matches) {
    match.timeWindow = window.windowText;
  }

  round.release.released = true;
  round.release.releasedAt = nowIso();
  round.release.inviteStart = window.startText;
  round.release.inviteEnd = window.endText;
round.release.lastReminderAt = new Date(
  Date.now() +
  INVITE_WINDOW_MINUTES * 60 * 1000 +
  KO_FIRST_REMINDER_AFTER_INVITE_MS -
  KO_REMINDER_INTERVAL_MS
).toISOString();

  saveKo(koData);

  round.messageId = (await sendOrEditRoundMessage(eventKey, roundKey, round, event.label)).messageId;
saveKo(koData);

await sendKoReleaseMessage(eventKey, roundKey, round, window.startText, window.endText);
}

async function processKoReminders(eventKey) {
  const koData = loadKo();
  const event = koData[eventKey];

  if (!event || !event.rounds) return;
  if (isEventInactive(event)) return;

  for (const roundKey of Object.keys(event.rounds)) {
    const round = event.rounds[roundKey];
    if (!round) continue;

    ensureRoundReleaseState(round);

    if (!round.release.released) continue;
    if (roundIsComplete(round)) continue;

    if (!canSendKoReminder(round.release.lastReminderAt)) continue;

    round.release.lastReminderAt = nowIso();
    saveKo(koData);

    await sendKoMissingResultReminder(roundKey, round);
  }
}

async function releasePendingKoRounds(eventKey) {
  const koData = loadKo();
  const event = koData[eventKey];

  if (!event || !event.rounds) return;
  if (isEventInactive(event)) return;

  for (const roundKey of Object.keys(event.rounds)) {
    const round = event.rounds[roundKey];
    if (!round) continue;

    ensureRoundReleaseState(round);

    if (round.release.released) continue;

    await releaseKoRound(eventKey, roundKey);
  }
}

async function reconcileKoAuto() {
  if (koProcessing) return;

  koProcessing = true;

  try {
    for (const eventKey of EVENT_TYPES) {
      await createInitialKoRound(eventKey);
      await advanceKoIfReady(eventKey);
      await releasePendingKoRounds(eventKey);
      await processKoReminders(eventKey);
    }

    await cleanupKoAfterReset();
  } finally {
    koProcessing = false;
  }
}

// =========================
// INTERACTION HELPERS
// =========================

function findRoundAndMatch(koData, eventKey, roundKey, matchNumber) {
  const event = koData[eventKey];
  if (!event) return null;

  const round = event.rounds?.[roundKey];
  if (!round) return null;

  const match = round.matches.find(m => m.matchNumber === Number(matchNumber));
  if (!match) return null;

  return { event, round, match };
}

function isAuthorizedForMatch(userId, match) {
  const homeTeam = {
    managerId: match.homeManagerId,
    coManagerIds: match.homeCoManagerIds || [],
  };
  const awayTeam = {
    managerId: match.awayManagerId,
    coManagerIds: match.awayCoManagerIds || [],
  };

  return isUserAllowedForTeam(userId, homeTeam) || isUserAllowedForTeam(userId, awayTeam);
}

async function handleOpenResult(interaction, eventKey, roundKey) {
  const koData = loadKo();
  const event = koData[eventKey];
  const round = event?.rounds?.[roundKey];

  if (!event || !round) {
    await interaction.reply({
      content: '❌ K.O.-Runde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!isRoundReleased(round)) {
    await interaction.reply({
      content: `❌ ${getRoundLabel(roundKey)} wurde noch nicht freigegeben.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const allowedMatches = round.matches.filter(match => {
  if (match.status === 'confirmed') return false;
  if (match.status === 'disputed') return false;
  if (!isAuthorizedForMatch(interaction.user.id, match)) return false;

  const ownTeamId = isUserAllowedForTeam(interaction.user.id, {
    managerId: match.homeManagerId,
    coManagerIds: match.homeCoManagerIds || [],
  })
    ? match.homeTeamId
    : match.awayTeamId;

  if (match.teamReports && match.teamReports[ownTeamId]) return false;

  return true;
});

  if (allowedMatches.length === 0) {
    await interaction.reply({
      content: '❌ Für dich gibt es aktuell kein offenes K.O.-Spiel zum Eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`ko_select:${eventKey}:${roundKey}`)
    .setPlaceholder('Wähle die Paarung aus')
    .addOptions(
      allowedMatches.map(match => ({
        label: `${match.homeClubName} vs ${match.awayClubName}`,
        description: `${getRoundLabel(roundKey)} • ${match.timeWindow}`,
        value: String(match.matchNumber),
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.reply({
    content: 'Wähle die Paarung aus, für die du ein Ergebnis eintragen willst.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleAdminResultOpen(interaction, eventKey, roundKey) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen K.O.-Ergebnisse manuell eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const koData = loadKo();
  const round = koData[eventKey]?.rounds?.[roundKey];

  if (!round || !Array.isArray(round.matches)) {
    await interaction.reply({
      content: '❌ K.O.-Runde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ko_admin_result_select:${eventKey}:${roundKey}`)
      .setPlaceholder('Welches K.O.-Spiel willst du eintragen?')
      .addOptions(
        round.matches.map(match => ({
          label: `${match.matchNumber}. ${match.homeClubName} vs ${match.awayClubName}`,
          description: match.reportedScore
            ? `Aktuell: ${match.reportedScore.home}:${match.reportedScore.away}`
            : 'Noch kein Ergebnis',
          value: String(match.matchNumber),
        }))
      )
  );

  await interaction.reply({
    content: 'Wähle das K.O.-Spiel aus, das du als Admin eintragen willst.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleAdminResultSelect(interaction, eventKey, roundKey) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen K.O.-Ergebnisse manuell eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const koData = loadKo();
  const round = koData[eventKey]?.rounds?.[roundKey];
  const matchNumber = Number(interaction.values[0]);
  const match = round?.matches?.find(m => Number(m.matchNumber) === matchNumber);

  if (!match) {
    await interaction.reply({
      content: '❌ K.O.-Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`ko_admin_result_modal:${eventKey}:${roundKey}:${matchNumber}`)
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

async function handleAdminResultModal(interaction, eventKey, roundKey, matchNumber) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Nur Admins dürfen K.O.-Ergebnisse manuell eintragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const koData = loadKo();
  const found = findRoundAndMatch(koData, eventKey, roundKey, matchNumber);

  if (!found) {
    await interaction.reply({
      content: '❌ K.O.-Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const { event, round, match } = found;

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

  if (homeGoals === awayGoals) {
    await interaction.reply({
      content: '❌ In der K.O.-Phase muss es einen Sieger geben.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (match.confirmationMessageId) {
    await deleteMessageIfExists(round.channelId, match.confirmationMessageId);
    match.confirmationMessageId = null;
  }

  if (match.disputeMessageId) {
    await deleteMessageIfExists(round.channelId, match.disputeMessageId);
    match.disputeMessageId = null;
  }

  match.status = 'confirmed';
  match.reportedByTeamId = null;
  match.reportedScore = {
    home: homeGoals,
    away: awayGoals,
  };
  match.confirmed = true;
  match.confirmedAt = nowIso();
  match.teamReports = {};
  match.waitingForTeamId = null;
  match.waitingForClubName = null;

  if (homeGoals > awayGoals) {
    match.winnerTeamId = match.homeTeamId;
    match.loserTeamId = match.awayTeamId;
  } else {
    match.winnerTeamId = match.awayTeamId;
    match.loserTeamId = match.homeTeamId;
  }

  saveKo(koData);

  round.messageId = (await sendOrEditRoundMessage(eventKey, roundKey, round, event.label)).messageId;
  saveKo(koData);

  await interaction.reply({
    content: `✅ Admin-Ergebnis eingetragen: **${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}**`,
    flags: MessageFlags.Ephemeral,
  });

  await reconcileKoAuto();

  try {
    if (roundKey === 'final' || roundKey === 'thirdPlace') {
      await sendTournamentCeremonyIfReady(clientRef, eventKey);
    }
  } catch (error) {
    console.error('❌ Fehler bei der automatischen Siegerehrung:', error);
  }

  return true;
}

async function handleSelectResult(interaction, eventKey, roundKey) {
  const koData = loadKo();
  const round = koData[eventKey]?.rounds?.[roundKey];
  const matchNumber = Number(interaction.values[0]);

  if (!round) {
    await interaction.reply({
      content: '❌ Runde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!isRoundReleased(round)) {
    await interaction.reply({
      content: `❌ ${getRoundLabel(roundKey)} wurde noch nicht freigegeben.`,
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
  
  if (match.status === 'disputed') {
  await interaction.reply({
    content: '❌ Dieses Spiel ist aktuell in Admin-Klärung.',
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

  const modal = new ModalBuilder()
    .setCustomId(`ko_modal:${eventKey}:${roundKey}:${matchNumber}`)
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

async function handleResultModal(interaction, eventKey, roundKey, matchNumber) {
  const koData = loadKo();
  const found = findRoundAndMatch(koData, eventKey, roundKey, matchNumber);

  if (!found) {
    await interaction.reply({
      content: '❌ K.O.-Spiel nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const { event, round, match } = found;

  if (!isRoundReleased(round)) {
    await interaction.reply({
      content: `❌ ${getRoundLabel(roundKey)} wurde noch nicht freigegeben.`,
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

  if (!isAuthorizedForMatch(interaction.user.id, match)) {
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

  if (homeGoals === awayGoals) {
    await interaction.reply({
      content: '❌ In der K.O.-Phase muss es einen Sieger geben. Bitte trage kein Unentschieden ein.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const reportingHome = isUserAllowedForTeam(interaction.user.id, {
    managerId: match.homeManagerId,
    coManagerIds: match.homeCoManagerIds || [],
  });

  const reportingTeamId = reportingHome ? match.homeTeamId : match.awayTeamId;
  const opponentTeamId = reportingHome ? match.awayTeamId : match.homeTeamId;
  const opponentClubName = reportingHome ? match.awayClubName : match.homeClubName;

  if (!match.teamReports) {
    match.teamReports = {};
  }

  if (match.teamReports[reportingTeamId]) {
    await interaction.reply({
      content: '❌ Dein Team hat für dieses Spiel bereits ein Ergebnis eingetragen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  match.teamReports[reportingTeamId] = {
    home: homeGoals,
    away: awayGoals,
    reportedByUserId: interaction.user.id,
    reportedAt: nowIso(),
  };

  const homeReport = match.teamReports[match.homeTeamId];
  const awayReport = match.teamReports[match.awayTeamId];

  if (homeReport && awayReport) {
    if (scoresMatch(homeReport, awayReport)) {
      match.status = 'confirmed';
      match.reportedScore = {
        home: homeGoals,
        away: awayGoals,
      };
      match.confirmed = true;
      match.confirmedAt = nowIso();
      match.reportedByTeamId = null;
      match.waitingForTeamId = null;
      match.waitingForClubName = null;

      if (homeGoals > awayGoals) {
        match.winnerTeamId = match.homeTeamId;
        match.loserTeamId = match.awayTeamId;
      } else {
        match.winnerTeamId = match.awayTeamId;
        match.loserTeamId = match.homeTeamId;
      }
    } else {
      match.status = 'disputed';
      match.confirmed = false;
      match.reportedScore = null;
      match.confirmedAt = null;
      match.winnerTeamId = null;
      match.loserTeamId = null;
      match.waitingForTeamId = null;
      match.waitingForClubName = null;

      if (!match.disputeMessageId) {
        match.disputeMessageId = await sendKoDisputeNotice(eventKey, roundKey, match, round);
      }
    }
  } else {
    match.status = 'awaiting';
    match.confirmed = false;
    match.reportedScore = null;
    match.waitingForTeamId = opponentTeamId;
    match.waitingForClubName = opponentClubName;
  }

  saveKo(koData);

  round.messageId = (await sendOrEditRoundMessage(eventKey, roundKey, round, event.label)).messageId;
  saveKo(koData);

  await interaction.reply({
    content:
      match.status === 'confirmed'
        ? `✅ Ergebnis passt bei beiden Teams. Spiel bestätigt: **${match.homeClubName} ${homeGoals}:${awayGoals} ${match.awayClubName}**`
        : match.status === 'disputed'
          ? '🚨 Ergebnis weicht ab. Admin wurde zur Klärung informiert.'
          : `✅ Ergebnis eingetragen. Wartet jetzt auf **${opponentClubName}**.`,
    flags: MessageFlags.Ephemeral,
  });

  if (match.status === 'confirmed') {
    await reconcileKoAuto();

    try {
      if (roundKey === 'final' || roundKey === 'thirdPlace') {
        await sendTournamentCeremonyIfReady(clientRef, eventKey);
      }
    } catch (error) {
      console.error('❌ Fehler bei der automatischen Siegerehrung:', error);
    }
  }

  return true;
}

// =========================
// EXPORTS
// =========================

module.exports = {
  async init(client) {
    clientRef = client;
    ensureKoFile();

    await reconcileKoAuto();

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await reconcileKoAuto();
        } catch (error) {
          console.error('❌ Fehler im K.O.-Intervall:', error);
        }
      }, 60000);
    }
  },

  async handleInteraction(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('ko_result_open:')) {
      const [, eventKey, roundKey] = interaction.customId.split(':');
      return handleOpenResult(interaction, eventKey, roundKey);
    }

    if (interaction.customId.startsWith('ko_admin_result_open:')) {
      const [, eventKey, roundKey] = interaction.customId.split(':');
      return handleAdminResultOpen(interaction, eventKey, roundKey);
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('ko_select:')) {
      const [, eventKey, roundKey] = interaction.customId.split(':');
      return handleSelectResult(interaction, eventKey, roundKey);
    }

    if (interaction.customId.startsWith('ko_admin_result_select:')) {
      const [, eventKey, roundKey] = interaction.customId.split(':');
      return handleAdminResultSelect(interaction, eventKey, roundKey);
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('ko_modal:')) {
      const [, eventKey, roundKey, matchNumber] = interaction.customId.split(':');
      return handleResultModal(interaction, eventKey, roundKey, matchNumber);
    }

    if (interaction.customId.startsWith('ko_admin_result_modal:')) {
      const [, eventKey, roundKey, matchNumber] = interaction.customId.split(':');
      return handleAdminResultModal(interaction, eventKey, roundKey, matchNumber);
    }
  }

  return false;
},

  async handleMessage() {
    return false;
  },
};
