const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const BANLIST_FILE = path.join(process.cwd(), 'data', 'banlist.json');
const MAX_LIST_MESSAGE_LENGTH = 1800;

let clientRef = null;
let midnightTimeoutRef = null;
let dailyIntervalRef = null;

function ensureFile(filePath, fallback) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function loadBanlist() {
  ensureFile(BANLIST_FILE, {
    infoMessageId: null,
    listMessageId: null,
    listMessageIds: [],
    bans: [],
  });

  try {
    const raw = fs.readFileSync(BANLIST_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};

    const listMessageIds = Array.isArray(parsed.listMessageIds)
      ? parsed.listMessageIds.filter(Boolean).map(String)
      : [];

    if (!listMessageIds.length && parsed.listMessageId) {
      listMessageIds.push(String(parsed.listMessageId));
    }

    return {
      infoMessageId: parsed.infoMessageId || null,
      listMessageId: parsed.listMessageId || null,
      listMessageIds,
      bans: Array.isArray(parsed.bans) ? parsed.bans : [],
    };
  } catch (error) {
    console.error('❌ Fehler beim Lesen der Sperrliste:', error);

    return {
      infoMessageId: null,
      listMessageId: null,
      listMessageIds: [],
      bans: [],
    };
  }
}

function saveBanlist(data) {
  fs.writeFileSync(BANLIST_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function fetchBanlistChannel() {
  const channelId = process.env.BANLIST_CHANNEL_ID;

  if (!channelId) {
    console.warn('⚠️ BANLIST_CHANNEL_ID fehlt in der .env');
    return null;
  }

  try {
    return await clientRef.channels.fetch(channelId);
  } catch (error) {
    console.error('❌ Sperrlisten-Kanal konnte nicht geladen werden:', error);
    return null;
  }
}

async function fetchMessage(channel, messageId) {
  if (!messageId) return null;

  try {
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDaysDateString(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatDateDE(dateString) {
  if (!dateString) return '—';

  const [year, month, day] = String(dateString).split('-');
  return `${day}.${month}.${year}`;
}

function cleanupExpiredBans(data) {
  const today = todayDateString();
  const before = data.bans.length;

  data.bans = data.bans.filter(ban => {
    return String(ban.bannedUntilDate) > today;
  });

  return before !== data.bans.length;
}

function formatUserMention(userId) {
  const id = String(userId || '').trim();
  return id ? `<@${id}>` : '';
}

function getTeamMentions(ban) {
  const ids = [
    ban.managerId,
    ...(Array.isArray(ban.coManagerIds) ? ban.coManagerIds : []),
  ].filter(Boolean);

  if (!ids.length) return '—';

  return ids.map(formatUserMention).join(' ');
}

function buildInfoEmbed() {
  return new EmbedBuilder()
    .setTitle('🚫 LOCO NIGHT CUP | SPERRLISTE')
    .setDescription(
      [
        '**Hier landen Teams, die den Turnierabend kaputt machen, nicht auftauchen oder den Ablauf unnötig bremsen.**',
        '',
        'Wer sich anmeldet oder eincheckt, übernimmt Verantwortung gegenüber allen anderen Teams.',
        'Wir wollen einen flüssigen, fairen und respektvollen Cup ohne unnötiges Chaos.',
      ].join('\n')
    )
    .addFields(
      {
        name: '⛔ Gründe für eine Sperre',
        value: [
          '• Eingecheckt, aber nicht erschienen',
          '• Während laufendem Turnierbetrieb rausgegangen',
          '• Gruppenphase oder K.O.-Phase ohne Abmeldung verlassen',
          '• Beleidigungen, Respektlosigkeit oder unsportliches Verhalten',
          '• Sonstige schwere Regelverstöße',
        ].join('\n'),
      },
      {
        name: '📌 Dauer & Ablauf',
        value: [
          'Die Standardsperre beträgt **14 Tage**.',
          'Abgelaufene Sperren werden automatisch entfernt.',
          'Die Liste wird täglich um **00:00 Uhr** geprüft.',
        ].join('\n'),
      }
    )
    .setColor(0xb00020)
    .setFooter({ text: 'Loco Night Cup • Fair bleiben oder Pause machen.' });
}

function buildBanBlock(ban, index) {
  return [
    `### ${index + 1}. ${ban.clubName}`,
    `**VM / Co-VM:** ${getTeamMentions(ban)}`,
    `**Grund:** ${ban.reason}`,
    `**Sperre ab:** ${formatDateDE(ban.bannedAtDate)}`,
    `**Sperre bis:** ${formatDateDE(ban.bannedUntilDate)}`,
    ban.bannedByUserId ? `**Gesperrt von:** ${formatUserMention(ban.bannedByUserId)}` : null,
  ].filter(Boolean).join('\n');
}

function buildBanlistTexts(data) {
  if (!data.bans.length) {
    return [[
      '## 🔴 Aktuell gesperrte Teams',
      '',
      '✅ Aktuell sind keine Teams gesperrt.',
    ].join('\n')];
  }

  const sortedBans = [...data.bans].sort((a, b) =>
    String(a.bannedUntilDate).localeCompare(String(b.bannedUntilDate))
  );

  const messages = [];
  let current = '## 🔴 Aktuell gesperrte Teams\n';

  sortedBans.forEach((ban, index) => {
    const block = buildBanBlock(ban, index);
    const candidate = `${current}\n${block}\n`;

    if (candidate.length > MAX_LIST_MESSAGE_LENGTH && current.trim()) {
      messages.push(current.trim());
      current = `## 🔴 Aktuell gesperrte Teams • Fortsetzung\n\n${block}\n`;
    } else {
      current = candidate;
    }
  });

  if (current.trim()) {
    messages.push(current.trim());
  }

  return messages;
}

async function syncBanlistMessages(channel, data) {
  const contents = buildBanlistTexts(data);
  const previousIds = Array.isArray(data.listMessageIds)
    ? data.listMessageIds.filter(Boolean).map(String)
    : [];

  if (!previousIds.length && data.listMessageId) {
    previousIds.push(String(data.listMessageId));
  }

  const nextIds = [];

  for (let index = 0; index < contents.length; index += 1) {
    const content = contents[index];
    const existingId = previousIds[index] || null;
    let message = await fetchMessage(channel, existingId);

    if (message) {
      await message.edit({
        content,
        allowedMentions: {
          parse: ['users'],
        },
      });
    } else {
      message = await channel.send({
        content,
        allowedMentions: {
          parse: ['users'],
        },
      });
    }

    nextIds.push(message.id);
  }

  for (const staleId of previousIds.slice(contents.length)) {
    const staleMessage = await fetchMessage(channel, staleId);

    if (staleMessage) {
      try {
        await staleMessage.delete();
      } catch (error) {
        console.warn(`⚠️ Alte Sperrlisten-Nachricht ${staleId} konnte nicht gelöscht werden:`, error);
      }
    }
  }

  data.listMessageIds = nextIds;
  data.listMessageId = nextIds[0] || null;
}

async function refreshBanlistMessage() {
  const channel = await fetchBanlistChannel();
  if (!channel) return;

  const data = loadBanlist();
  cleanupExpiredBans(data);

  let infoMessage = await fetchMessage(channel, data.infoMessageId);

  if (!infoMessage) {
    infoMessage = await channel.send({
      embeds: [buildInfoEmbed()],
    });

    data.infoMessageId = infoMessage.id;
  } else {
    await infoMessage.edit({
      embeds: [buildInfoEmbed()],
    });
  }

  await syncBanlistMessages(channel, data);
  saveBanlist(data);
}

function scheduleMidnightCleanup() {
  if (midnightTimeoutRef) clearTimeout(midnightTimeoutRef);
  if (dailyIntervalRef) clearInterval(dailyIntervalRef);

  const now = new Date();
  const nextMidnight = new Date(now);

  nextMidnight.setHours(24, 0, 0, 0);

  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  midnightTimeoutRef = setTimeout(async () => {
    await refreshBanlistMessage();

    dailyIntervalRef = setInterval(async () => {
      await refreshBanlistMessage();
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

async function addTeamBan(team, reason, bannedByUserId = null, durationDays = 14) {
  const data = loadBanlist();

  cleanupExpiredBans(data);

  const teamId = String(team.id || team.teamId);
  const bannedAtDate = todayDateString();
  const bannedUntilDate = addDaysDateString(durationDays);

  data.bans = data.bans.filter(ban => String(ban.teamId) !== teamId);

  data.bans.push({
    teamId,
    clubName: team.clubName,
    managerId: team.managerId || null,
    coManagerIds: Array.isArray(team.coManagerIds) ? team.coManagerIds : [],
    reason,
    bannedAtDate,
    bannedUntilDate,
    bannedByUserId,
    createdAt: new Date().toISOString(),
  });

  saveBanlist(data);

  await refreshBanlistMessage();

  return {
    teamName: team.clubName,
    bannedAtDate,
    bannedUntilDate,
    reason,
  };
}

function isTeamOrUserBanned(teamOrUser) {
  const data = loadBanlist();
  cleanupExpiredBans(data);

  const teamId = String(teamOrUser.teamId || teamOrUser.id || '');
  const userId = String(teamOrUser.userId || '');

  return data.bans.find(ban => {
    const bannedUsers = [
      ban.managerId,
      ...(Array.isArray(ban.coManagerIds) ? ban.coManagerIds : []),
    ].filter(Boolean).map(String);

    if (teamId && String(ban.teamId) === teamId) return true;
    if (userId && bannedUsers.includes(userId)) return true;

    return false;
  }) || null;
}

module.exports = {
  async init(client) {
    clientRef = client;

    ensureFile(BANLIST_FILE, {
      infoMessageId: null,
      listMessageId: null,
      listMessageIds: [],
      bans: [],
    });

    await refreshBanlistMessage();
    scheduleMidnightCleanup();
  },

  addTeamBan,
  refreshBanlistMessage,
  isTeamOrUserBanned,
};