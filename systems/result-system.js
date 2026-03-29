const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');
const RESULTS_FILE = path.join(process.cwd(), 'data', 'results.json');

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
    '00:00–00:05',
    '00:00–00:05',
    '00:20–00:25',
    '00:20–00:25',
    '00:40–00:45',
    '00:40–00:45',
  ];
}

function enrichMatches(groupLetter, teams) {
  const matches = createRoundRobinMatches(teams);
  const windows = getGroupMatchWindows();

  return matches.map((match, index) => {
    const home = teams.find(t => t.teamId === match.homeTeamId);
    const away = teams.find(t => t.teamId === match.awayTeamId);

    return {
      id: `${groupLetter}_match_${index + 1}`,
      groupLetter,
      matchNumber: index + 1,
      timeWindow: windows[index] || '00:00–00:05',
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeClubName: home?.clubName || 'Unbekannt',
      awayClubName: away?.clubName || 'Unbekannt',
      status: 'pending',
      reportedByTeamId: null,
      reportedScore: null,
      confirmed: false,
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

      if (match.status === 'reported') {
        status = `📝 Gemeldet: ${match.reportedScore.home}:${match.reportedScore.away}`;
      }

      if (match.status === 'confirmed') {
        status = `✅ Bestätigt: ${match.reportedScore.home}:${match.reportedScore.away}`;
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

// =========================
// CORE
// =========================

async function createScheduleForEvent(eventKey) {
  const groupsData = loadGroups();
  const resultsData = loadResults();

  const event = groupsData[eventKey];
  if (!event || !event.groups) return;

  // Schon für diesen Zyklus erstellt?
  const existing = resultsData[eventKey];
  if (existing && existing.cycleKey === event.cycleKey) {
    return;
  }

  // Alte Spielpläne löschen
  if (existing && existing.groups) {
    for (const letter of Object.keys(existing.groups)) {
      const group = existing.groups[letter];
      if (!group) continue;

      if (group.scheduleMessageId) {
        await deleteMessageIfExists(group.channelId, group.scheduleMessageId);
      }
    }
  }

  const storedEvent = {
    eventKey,
    cycleKey: event.cycleKey,
    label: event.label,
    format: event.format,
    createdAt: new Date().toISOString(),
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
    };
  }

  resultsData[eventKey] = storedEvent;
  saveResults(resultsData);

  console.log(`✅ Spielpläne für ${event.label} erstellt.`);
}

function shouldCreateSchedule(event) {
  if (!event || !event.createdAt) return false;

  // Sobald Gruppen existieren, direkt Spielplan erstellen
  return true;
}

async function reconcileSchedules() {
  const groupsData = loadGroups();

  if (groupsData.friday && shouldCreateSchedule(groupsData.friday)) {
    await createScheduleForEvent('friday');
  }

  if (groupsData.saturday && shouldCreateSchedule(groupsData.saturday)) {
    await createScheduleForEvent('saturday');
  }
}

// =========================
// EXPORTS
// =========================

module.exports = {
  async init(client) {
    clientRef = client;
    ensureResultsFile();

    await reconcileSchedules();

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await reconcileSchedules();
        } catch (error) {
          console.error('❌ Fehler im Result-Intervall:', error);
        }
      }, 60 * 1000);
    }
  },

  async handleInteraction() {
    return false;
  },

  async handleMessage() {
    return false;
  },
};