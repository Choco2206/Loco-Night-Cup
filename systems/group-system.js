const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');

const GROUP_CLEANUP_GRACE_MS = 0;

let clientRef = null;
let intervalRef = null;

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

function createEmptyEventData() {
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

function ensureGroupsFile() {
  const dir = path.dirname(GROUPS_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(GROUPS_FILE)) {
    fs.writeFileSync(
      GROUPS_FILE,
      JSON.stringify(createEmptyEventData(), null, 2),
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
    return createEmptyEventData();
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
      return createEmptyEventData();
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
    return createEmptyEventData();
  }
}

function saveCheckins(data) {
  try {
    fs.writeFileSync(CHECKINS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Fehler beim Schreiben von checkins.json:', error);
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

function removeUserIdFromTeam(team, userId) {
  let changed = false;

  if (String(team.managerId) === String(userId)) {
    team.managerId = null;
    changed = true;
  }

  if (Array.isArray(team.coManagerIds)) {
    const before = team.coManagerIds.length;

    team.coManagerIds = team.coManagerIds.filter(
      id => String(id) !== String(userId)
    );

    if (team.coManagerIds.length !== before) {
      changed = true;
    }
  }

  return changed;
}

function removeUserIdFromStorage(userId) {
  const checkins = loadCheckins();
  const groupsData = loadGroups();

  let checkinsChanged = false;
  let groupsChanged = false;

  for (const eventKey of EVENT_TYPES) {
    const event = checkins[eventKey];

    if (event && Array.isArray(event.teams)) {
      for (const team of event.teams) {
        if (removeUserIdFromTeam(team, userId)) {
          checkinsChanged = true;
        }
      }
    }

    const storedEvent = groupsData[eventKey];

    if (storedEvent?.groups) {
      for (const group of Object.values(storedEvent.groups)) {
        if (Array.isArray(group.teams)) {
          for (const team of group.teams) {
            if (removeUserIdFromTeam(team, userId)) {
              groupsChanged = true;
            }
          }
        }

        if (Array.isArray(group.rows)) {
          for (const row of group.rows) {
            if (removeUserIdFromTeam(row, userId)) {
              groupsChanged = true;
            }
          }
        }
      }
    }
  }

  if (checkinsChanged) saveCheckins(checkins);
  if (groupsChanged) saveGroups(groupsData);

  if (checkinsChanged || groupsChanged) {
    console.log(`🧹 User ${userId} aus checkins.json/groups.json entfernt.`);
  }
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
  if (event?.drawAt) {
    return Number(event.drawAt);
  }

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
      removeUserIdFromStorage(userId);
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
    let member = null;

    try {
      member = await guild.members.fetch(userId);
    } catch (error) {
      console.warn(`⚠️ User ${userId} ist nicht mehr auf dem Server.`);
      removeUserIdFromStorage(userId);
      continue;
    }

    if (!member) {
      console.warn(`⚠️ User ${userId} nicht gefunden.`);
      removeUserIdFromStorage(userId);
      continue;
    }

    try {
      await removeAllGroupRolesFromMember(member);

      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
      }
    } catch (error) {
      console.warn(`⚠️ Rolle Gruppe ${letter} konnte nicht vergeben werden an User ${userId}`);
    }
  }
}

async function syncGroupRolesForEvent(eventKey) {
  const checkins = loadCheckins();
  const groupsData = loadGroups();

  const event = checkins[eventKey];
  const storedEvent = groupsData[eventKey];

  if (!event || !storedEvent || !storedEvent.groups) return;

  // WICHTIG: Niemals alte Gruppenzyklen erneut synchronisieren
  if (storedEvent.cycleKey !== event.cycleKey) return;

  // WICHTIG: Nach Cleanup keine Rollen mehr anfassen
  if (storedEvent.groupRolesCleanedAt || storedEvent.groupChannelsCleanedAt) return;

  // WICHTIG: Nur aktive/finalisierte Events dürfen Rollen syncen
  if (isEventInactive(event)) return;
  if (!event.finalized) return;
  if (event.status !== 'confirmed') return;

  let changed = false;

  for (const [letter, group] of Object.entries(storedEvent.groups)) {
    if (!group || !Array.isArray(group.teams)) continue;

    const updatedTeams = group.teams.map(groupTeam => {
      const freshTeam = event.teams.find(
        t => String(t.teamId) === String(groupTeam.teamId)
      );

      if (!freshTeam) return groupTeam;

      return {
        ...groupTeam,
        managerId: freshTeam.managerId || groupTeam.managerId || null,
        coManagerIds: Array.isArray(freshTeam.coManagerIds)
          ? freshTeam.coManagerIds
          : [],
      };
    });

    group.teams = updatedTeams;

    if (Array.isArray(group.rows)) {
      group.rows = group.rows.map(row => {
        const freshTeam = event.teams.find(
          t => String(t.teamId) === String(row.teamId)
        );

        if (!freshTeam) return row;

        return {
          ...row,
          managerId: freshTeam.managerId || row.managerId || null,
          coManagerIds: Array.isArray(freshTeam.coManagerIds)
            ? freshTeam.coManagerIds
            : [],
        };
      });
    }

    await assignGroupRoleToTeams(letter, updatedTeams);
    changed = true;
  }

  if (changed) {
    saveGroups(groupsData);
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

  for (const eventKey of EVENT_TYPES) {
    const storedEvent = groupsData[eventKey];
    if (!storedEvent || !storedEvent.groups) continue;

    if (storedEvent.groupChannelsCleanedAt) continue;

    let cleanupAt = Number(storedEvent.resetAt);

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

// Aktives Turnierformat speichern
event.format = format;
event.activeTeamIds = event.teams
  .slice(0, format)
  .map(team => team.teamId);

event.backupTeamIds = event.teams
  .slice(format)
  .map(team => team.teamId);

saveCheckins(checkins);

const existing = groupsData[eventKey];

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
  await cleanupGroupsAfterReset();

  const checkins = loadCheckins();

  for (const eventKey of EVENT_TYPES) {
    const event = checkins[eventKey];

    if (
      event &&
      !isEventInactive(event) &&
      event.finalized &&
      event.status === 'confirmed' &&
      shouldDrawNow(event)
    ) {
      await drawGroupsForEvent(eventKey);
    }
  }

  for (const eventKey of EVENT_TYPES) {
    await syncGroupRolesForEvent(eventKey);
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
        const freshMessage = await message.channel.messages
          .fetch(message.id)
          .catch(() => null);

        if (!freshMessage) return;
        if (freshMessage.pinned) return;
        if (freshMessage.author.bot) return;

        await freshMessage.delete().catch(() => {});
      } catch (error) {
        console.warn('⚠️ Gruppen-Nachricht konnte nicht automatisch gelöscht werden.');
      }
    }, 10 * 60 * 1000);

    return false;
  },
};
