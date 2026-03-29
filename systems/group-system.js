const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');

let clientRef = null;
let intervalRef = null;

// =========================
// FILE HELPERS
// =========================

function ensureGroupsFile() {
  const dir = path.dirname(GROUPS_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(GROUPS_FILE)) {
    fs.writeFileSync(
      GROUPS_FILE,
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
  ensureGroupsFile();

  try {
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

function saveGroups(data) {
  try {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Fehler beim Schreiben von groups.json:', error);
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

// =========================
// BASIC HELPERS
// =========================

function getActualFormat(teamCount) {
  if (teamCount < 8) return 0;
  if (teamCount < 16) return 8;
  if (teamCount < 24) return 16;
  if (teamCount < 32) return 24;
  return 32;
}

function getGroupLetters(format) {
  if (format === 8) return ['A', 'B'];
  if (format === 16) return ['A', 'B', 'C', 'D'];
  if (format === 24) return ['A', 'B', 'C', 'D', 'E', 'F'];
  if (format === 32) return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  return [];
}

function getChannelIdForLetter(letter) {
  return process.env[`GROUP_${letter}_CHANNEL_ID`] || null;
}

function shuffleArray(array) {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function getDrawTimestamp(event) {
  // 23:25 = deadline + 25 Minuten
  return event.deadlineAt + 25 * 60 * 1000;
}

function shouldDrawNow(event) {
  return Date.now() >= getDrawTimestamp(event);
}

// =========================
// RENDER HELPERS
// =========================

function createInitialRows(teams) {
  return teams.map(team => ({
    teamId: team.teamId,
    clubName: team.clubName,
    managerId: team.managerId,
    coManagerIds: Array.isArray(team.coManagerIds) ? team.coManagerIds : [],
    s: 0,
    u: 0,
    n: 0,
    diff: 0,
    points: 0,
  }));
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
      rows.length > 0
        ? buildTableText(rows)
        : 'Noch keine Teams in dieser Gruppe.'
    )
    .setColor(0xff0000);
}

function buildPingMessage(groupLetter, teams) {
  const lines = teams.map(team => {
    const mentions = [team.managerId, ...(team.coManagerIds || [])]
      .filter(Boolean)
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
// GROUP DRAW
// =========================

async function clearOldGroupPosts(storedEvent) {
  if (!storedEvent || !storedEvent.groups) return;

  for (const letter of Object.keys(storedEvent.groups)) {
    const group = storedEvent.groups[letter];
    if (!group) continue;

    if (group.tableMessageId) {
      await deleteMessageIfExists(group.channelId, group.tableMessageId);
    }

    if (group.pingMessageId) {
      await deleteMessageIfExists(group.channelId, group.pingMessageId);
    }
  }
}

async function drawGroupsForEvent(eventKey) {
  const checkins = loadCheckins();
  const groupsData = loadGroups();

  const event = checkins[eventKey];
  if (!event) return;

  if (!event.finalized) return;
  if (event.status !== 'confirmed') return;

  const format = getActualFormat(event.teams.length);
  if (!format) return;

  // Schon für diesen Zyklus ausgelost?
  const existing = groupsData[eventKey];
  if (existing && existing.cycleKey === event.cycleKey) {
    return;
  }

  // Alte Gruppenposts aus vorherigem Zyklus löschen
  if (existing) {
    await clearOldGroupPosts(existing);
  }

  const groupLetters = getGroupLetters(format);
  const finalTeams = event.teams.slice(0, format);
  const shuffled = shuffleArray(finalTeams);

  const grouped = {};
  groupLetters.forEach(letter => {
    grouped[letter] = [];
  });

  shuffled.forEach((team, index) => {
    const letter = groupLetters[index % groupLetters.length];
    grouped[letter].push(team);
  });

  const storedEvent = {
    eventKey,
    cycleKey: event.cycleKey,
    label: event.label,
    format,
    createdAt: new Date().toISOString(),
    groups: {},
  };

  for (const letter of groupLetters) {
    const channelId = getChannelIdForLetter(letter);

    if (!channelId) {
      console.error(`❌ GROUP_${letter}_CHANNEL_ID fehlt.`);
      continue;
    }

    const channel = await fetchChannel(channelId);
    if (!channel) continue;

    const rows = createInitialRows(grouped[letter]);

    const tableMessage = await channel.send({
      embeds: [buildTableEmbed(event.label, letter, rows)],
    });

    const pingMessage = await channel.send({
      content: buildPingMessage(letter, grouped[letter]),
    });

    storedEvent.groups[letter] = {
      channelId,
      tableMessageId: tableMessage.id,
      pingMessageId: pingMessage.id,
      rows,
      teams: grouped[letter],
    };
  }

  groupsData[eventKey] = storedEvent;
  saveGroups(groupsData);

  console.log(`✅ Gruppen für ${event.label} automatisch ausgelost.`);
}

// =========================
// AUTO LOOP
// =========================

async function reconcileAutoDraw() {
  const checkins = loadCheckins();

  if (checkins.friday && checkins.friday.finalized && shouldDrawNow(checkins.friday)) {
    await drawGroupsForEvent('friday');
  }

  if (checkins.saturday && checkins.saturday.finalized && shouldDrawNow(checkins.saturday)) {
    await drawGroupsForEvent('saturday');
  }
}

// =========================
// EXPORTS
// =========================

module.exports = {
  async init(client) {
    clientRef = client;
    ensureGroupsFile();

    await reconcileAutoDraw();

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await reconcileAutoDraw();
        } catch (error) {
          console.error('❌ Fehler im Gruppen-Intervall:', error);
        }
      }, 60 * 1000);
    }
  },

  async handleInteraction() {
    return false;
  },

  async handleMessage(message) {
  if (!message.guild) return false;
  if (message.author.bot) return false;

  const groupChannelIds = [
    process.env.GROUP_A_CHANNEL_ID,
    process.env.GROUP_B_CHANNEL_ID,
    process.env.GROUP_C_CHANNEL_ID,
    process.env.GROUP_D_CHANNEL_ID,
    process.env.GROUP_E_CHANNEL_ID,
    process.env.GROUP_F_CHANNEL_ID,
    process.env.GROUP_G_CHANNEL_ID,
    process.env.GROUP_H_CHANNEL_ID,
  ].filter(Boolean);

  if (!groupChannelIds.includes(message.channel.id)) {
    return false;
  }

  setTimeout(async () => {
    try {
      await message.delete();
    } catch (error) {}
  }, 10 * 60 * 1000);

  return false;
},
};