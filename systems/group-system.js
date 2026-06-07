const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');

const GROUP_CLEANUP_GRACE_MS = 0;

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

function getAllGroupLetters() {
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
}

function getChannelIdForLetter(letter) {
  return process.env[`GROUP_${letter}_CHANNEL_ID`] || null;
}

function getRoleIdForLetter(letter) {
  return process.env[`GROUP_${letter}_ROLE_ID`] || null;
}

function getAllGroupRoleIds() {
  return getAllGroupLetters()
    .map(letter => getRoleIdForLetter(letter))
    .filter(Boolean);
}

function getTeamUserIds(team) {
  return [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ].filter(Boolean);
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
  const deadlineMs =
    typeof event.deadlineAt === 'number'
      ? event.deadlineAt
      : new Date(event.deadlineAt).getTime();

  return deadlineMs + 20 * 60 * 1000;
}

function shouldDrawNow(event) {
  const drawAt = getDrawTimestamp(event);

  if (!drawAt || Number.isNaN(drawAt)) {
    console.warn('⚠️ Ungültige deadlineAt für Gruppenauslosung:', event.deadlineAt);
    return false;
  }

  return Date.now() >= drawAt;
}

function isEventExpired(event) {
  if (!event?.resetAt) return false;
  return Date.now() >= Number(event.resetAt);
}

function isEventInactive(event) {
  return !event || event.completed || event.archived || isEventExpired(event);
}

// =========================
// RENDER HELPERS
// =========================

function createInitialRows(teams) {
  return teams.map(team => ({
    teamId: team.teamId,
    clubName: team.clubName,
    managerId: team.managerId || null,
    coManagerIds: Array.isArray(team.coManagerIds) ? team.coManagerIds : [],
    isByeTeam: !!team.isByeTeam,
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

async function fetchGuildFromGroups() {
  for (const letter of getAllGroupLetters()) {
    const channelId = getChannelIdForLetter(letter);
    if (!channelId) continue;

    const channel = await fetchChannel(channelId);
    if (channel && channel.guild) return channel.guild;
  }

  return null;
}

// =========================
// ROLE HELPERS
// =========================

async function removeAllGroupRolesFromMember(member) {
  const roleIds = getAllGroupRoleIds();

  for (const roleId of roleIds) {
    if (!member.roles.cache.has(roleId)) continue;

    try {
      await member.roles.remove(roleId);
    } catch (error) {
      console.warn(`⚠️ Gruppenrolle konnte nicht entfernt werden: ${member.id} / ${roleId}`);
    }
  }
}

async function removeAllGroupRolesFromStoredEvent(storedEvent) {
  if (!storedEvent || !storedEvent.groups) return;

  const guild = await fetchGuildFromGroups();

  if (!guild) {
    console.warn('⚠️ Server konnte für Rollen-Cleanup nicht geladen werden.');
    return;
  }

  const userIds = new Set();

  for (const group of Object.values(storedEvent.groups)) {
    if (!group || !Array.isArray(group.teams)) continue;

    for (const team of group.teams) {
      getTeamUserIds(team).forEach(id => userIds.add(id));
    }
  }

  for (const userId of userIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (!member) continue;

      await removeAllGroupRolesFromMember(member);
    } catch (error) {
      console.warn(`⚠️ Member konnte beim Rollen-Cleanup nicht geladen werden: ${userId}`);
    }
  }
}

async function assignGroupRoleToTeams(letter, teams) {
  const roleId = getRoleIdForLetter(letter);

  if (!roleId) {
    console.error(`❌ GROUP_${letter}_ROLE_ID fehlt.`);
    return;
  }

  const guild = await fetchGuildFromGroups();

  if (!guild) {
    console.error('❌ Server konnte für Rollenvergabe nicht geladen werden.');
    return;
  }

  const role =
    guild.roles.cache.get(roleId) ||
    (await guild.roles.fetch(roleId).catch(() => null));

  if (!role) {
    console.error(`❌ Rolle für Gruppe ${letter} wurde nicht gefunden: ${roleId}`);
    return;
  }

  const userIds = new Set();

  for (const team of teams) {
    getTeamUserIds(team).forEach(id => userIds.add(id));
  }

  for (const userId of userIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (!member) continue;

      await removeAllGroupRolesFromMember(member);

      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
      }
    } catch (error) {
      console.warn(`⚠️ Rolle Gruppe ${letter} konnte nicht vergeben werden an User ${userId}`);
    }
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

async function purgeGroupChannel(channelId) {
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
    console.error(`❌ Gruppenkanal konnte nicht geleert werden: ${channelId}`, error);
  }
}

async function cleanupGroupsAfterReset() {
  const groupsData = loadGroups();
  let changed = false;

  for (const eventKey of ['friday', 'saturday']) {
    const storedEvent = groupsData[eventKey];
    if (!storedEvent || !storedEvent.groups) continue;

    if (storedEvent.groupChannelsCleanedAt) continue;

    let cleanupAt = Number(storedEvent.resetAt);

    // Fallback für alte Gruppen, die noch kein resetAt gespeichert haben
    if (!cleanupAt || Number.isNaN(cleanupAt)) {
      const createdAtMs = new Date(storedEvent.createdAt).getTime();
      if (!createdAtMs || Number.isNaN(createdAtMs)) continue;

      cleanupAt = createdAtMs + 8 * 60 * 60 * 1000;
    }

    if (Date.now() < cleanupAt + GROUP_CLEANUP_GRACE_MS) continue;

    await removeAllGroupRolesFromStoredEvent(storedEvent);

    for (const group of Object.values(storedEvent.groups)) {
      if (!group?.channelId) continue;
      await purgeGroupChannel(group.channelId);
    }

    storedEvent.resetAt = cleanupAt;
    storedEvent.groupRolesCleanedAt = new Date().toISOString();
    storedEvent.groupChannelsCleanedAt = new Date().toISOString();

    changed = true;

    console.log(`✅ Gruppenkanäle für ${storedEvent.label} bereinigt.`);
  }

  if (changed) {
    saveGroups(groupsData);
  }
}

async function drawGroupsForEvent(eventKey) {
  const checkins = loadCheckins();
  const groupsData = loadGroups();

  const event = checkins[eventKey];
if (!event) return;
if (isEventInactive(event)) return;

if (!event.finalized) return;
if (event.status !== 'confirmed') return;

  const format = getActualFormat(event.teams.length);
  if (!format) return;

  const existing = groupsData[eventKey];

  if (existing && existing.cycleKey === event.cycleKey) {
    return;
  }

  if (existing) {
    await clearOldGroupPosts(existing);
    await removeAllGroupRolesFromStoredEvent(existing);
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
  resetAt: event.resetAt,
  groupRolesAssignedAt: null,
  groupRolesCleanedAt: null,
  groupChannelsCleanedAt: null,
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

    await assignGroupRoleToTeams(letter, grouped[letter]);

    const rows = createInitialRows(grouped[letter]);

    const tableMessage = await channel.send({
      embeds: [buildTableEmbed(event.label, letter, rows)],
    });

    const pingMessage = await channel.send({
      content: buildPingMessage(letter, grouped[letter]),
    });

    storedEvent.groups[letter] = {
      channelId,
      roleId: getRoleIdForLetter(letter),
      tableMessageId: tableMessage.id,
      pingMessageId: pingMessage.id,
      rows,
      teams: grouped[letter],
    };
  }

  storedEvent.groupRolesAssignedAt = new Date().toISOString();

  groupsData[eventKey] = storedEvent;
  saveGroups(groupsData);

  console.log(`✅ Gruppen für ${event.label} automatisch ausgelost und Rollen verteilt.`);
}

// =========================
// AUTO LOOP
// =========================

async function reconcileAutoDraw() {
  const checkins = loadCheckins();

  if (
  checkins.friday &&
  !isEventInactive(checkins.friday) &&
  checkins.friday.finalized &&
  shouldDrawNow(checkins.friday)
) {
  await drawGroupsForEvent('friday');
}

  if (
  checkins.saturday &&
  !isEventInactive(checkins.saturday) &&
  checkins.saturday.finalized &&
  shouldDrawNow(checkins.saturday)
) {
  await drawGroupsForEvent('saturday');
}

  await cleanupGroupsAfterReset();
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

    
    return false;
  },
};