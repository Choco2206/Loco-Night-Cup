const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');

let clientRef = null;
let intervalRef = null;

// =========================
// FILE HELPERS
// =========================

function ensureCheckinsFile() {
  const dir = path.dirname(CHECKINS_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(CHECKINS_FILE)) {
    fs.writeFileSync(
      CHECKINS_FILE,
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

function loadCheckins() {
  ensureCheckinsFile();

  try {
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

function saveCheckins(data) {
  try {
    fs.writeFileSync(CHECKINS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Fehler beim Schreiben von checkins.json:', error);
  }
}

function loadTeams() {
  try {
    if (!fs.existsSync(TEAMS_FILE)) return [];
    const raw = fs.readFileSync(TEAMS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('❌ Fehler beim Lesen von teams.json:', error);
    return [];
  }
}

// =========================
// TEAM HELPERS
// =========================

function getUserTeam(userId) {
  const teams = loadTeams();

  return teams.find(team => {
    const isManager = team.managerId === userId;
    const isCoManager =
      Array.isArray(team.coManagerIds) && team.coManagerIds.includes(userId);
    return isManager || isCoManager;
  });
}

function normalizeTeamForCheckin(team) {
  return {
    teamId: team.id,
    clubName: team.clubName,
    managerId: team.managerId,
    coManagerIds: Array.isArray(team.coManagerIds) ? team.coManagerIds : [],
    joinedAt: Date.now(),
  };
}

function isUserAllowedForTeam(userId, team) {
  if (!team) return false;
  if (team.managerId === userId) return true;
  return Array.isArray(team.coManagerIds) && team.coManagerIds.includes(userId);
}

// =========================
// DATE / TIME HELPERS
// =========================

function formatDateGerman(date) {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatTimeGerman(date) {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCountdown(targetTimestamp) {
  const diff = targetTimestamp - Date.now();

  if (diff <= 0) return 'abgelaufen';

  const totalMinutes = Math.floor(diff / 1000 / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getNextBoundary(dayOfWeek, hour) {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);

  while (true) {
    if (
      next.getDay() === dayOfWeek &&
      next.getHours() === hour &&
      next.getMinutes() === 0 &&
      next.getTime() > now.getTime()
    ) {
      return next;
    }

    next.setMinutes(next.getMinutes() + 1);
  }
}

function getCycleConfig(type) {
  if (type === 'friday') {
    const resetAt = getNextBoundary(6, 7);
    const deadline = new Date(resetAt.getTime() - 8 * 60 * 60 * 1000);
    const start = new Date(deadline.getTime() + 60 * 60 * 1000);

    return {
      key: `friday-${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`,
      type: 'friday',
      label: 'Freitag',
      channelId: process.env.FRIDAY_CHECKIN_CHANNEL_ID,
      deadlineAt: deadline.getTime(),
      startAt: start.getTime(),
      resetAt: resetAt.getTime(),
      displayDate: formatDateGerman(deadline),
      startLine: '🌙 Nacht von Freitag auf Samstag',
    };
  }

  const resetAt = getNextBoundary(0, 7);
  const deadline = new Date(resetAt.getTime() - 8 * 60 * 60 * 1000);
  const start = new Date(deadline.getTime() + 60 * 60 * 1000);

  return {
    key: `saturday-${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`,
    type: 'saturday',
    label: 'Samstag',
    channelId: process.env.SATURDAY_CHECKIN_CHANNEL_ID,
    deadlineAt: deadline.getTime(),
    startAt: start.getTime(),
    resetAt: resetAt.getTime(),
    displayDate: formatDateGerman(deadline),
    startLine: '🌙 Nacht von Samstag auf Sonntag',
  };
}

// =========================
// FORMAT LOGIC
// =========================

function getActualFormat(teamCount) {
  if (teamCount < 8) return 0;
  if (teamCount < 16) return 8;
  if (teamCount < 24) return 16;
  if (teamCount < 32) return 24;
  return 32;
}

function getDisplaySlots(teamCount) {
  if (teamCount >= 28) return 32;
  if (teamCount >= 20) return 24;
  if (teamCount >= 6) return 16;
  return 8;
}

function getFormatExplanation(format) {
  if (format === 8) {
    return [
      '• 2 Gruppen à 4 Teams',
      '• Die Top 2 jeder Gruppe kommen weiter',
      '• K.O.-Phase startet ab dem Halbfinale',
    ].join('\n');
  }

  if (format === 16) {
    return [
      '• 4 Gruppen à 4 Teams',
      '• Die Top 2 jeder Gruppe kommen weiter',
      '• K.O.-Phase startet ab dem Viertelfinale',
    ].join('\n');
  }

  if (format === 24) {
    return [
      '• 6 Gruppen à 4 Teams',
      '• Die Top 2 jeder Gruppe kommen weiter',
      '• Plus die 4 besten Gruppendritten',
      '• K.O.-Phase startet ab dem Achtelfinale',
    ].join('\n');
  }

  if (format === 32) {
    return [
      '• 8 Gruppen à 4 Teams',
      '• Die Top 2 jeder Gruppe kommen weiter',
      '• K.O.-Phase startet ab dem Achtelfinale',
    ].join('\n');
  }

  return '• Minimum 8 Teams erforderlich';
}

function getParticipatingTeams(event) {
  const actualFormat = getActualFormat(event.teams.length);
  if (actualFormat === 0) return [];
  return event.teams.slice(0, actualFormat);
}

function getBackupTeams(event) {
  const actualFormat = getActualFormat(event.teams.length);
  if (actualFormat === 0) return [];
  return event.teams.slice(actualFormat);
}

function buildSlotsList(event) {
  const teamCount = event.teams.length;
  const slots = getDisplaySlots(teamCount);
  const actualFormat = getActualFormat(teamCount);

  const lines = [];

  for (let i = 0; i < slots; i++) {
    const slotNumber = i + 1;
    const team = event.teams[i];

    let suffix = '';

    if (team && actualFormat > 0 && slotNumber > actualFormat) {
      suffix = ' (WL)';
    }

    if (team) {
      lines.push(`${slotNumber}. ${team.clubName}${suffix}`);
    } else {
      lines.push(`${slotNumber}. —`);
    }

    if ([8, 16, 24].includes(slotNumber) && slotNumber < slots) {
      lines.push('');
      lines.push(`════ ⬆️ ${slotNumber}er Turnier ⬆️ ════`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function buildBackupShortSection(event) {
  const backups = getBackupTeams(event);
  if (backups.length === 0) return null;

  return [
    '⚠️ **Backups (aktuell nicht teilnahmeberechtigt)**',
    backups.map((team, index) => `${index + 1}. ${team.clubName}`).join('\n'),
  ].join('\n');
}

function buildSummaryContent(event) {
  const actualFormat = getActualFormat(event.teams.length);

  if (actualFormat === 0) {
    return [
      '❌ **NightCup findet nicht statt**',
      '',
      'Es wurden nicht genug Teams registriert.',
      'Minimum sind **8 Teams**.',
    ].join('\n');
  }

  return [
    '✅ **NightCup findet statt**',
    '',
    `Format: **${actualFormat}er Turnier**`,
    'Gruppenauslosung findet um **23:15 Uhr** statt.',
    'Manager und Co-VMs werden automatisch in der jeweiligen Gruppe markiert.',
  ].join('\n');
}

function getMentionLine(team) {
  const ids = [team.managerId, ...(team.coManagerIds || [])].filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.map(id => `<@${id}>`).join(' ');
}

function buildBackupContent(event) {
  const backups = getBackupTeams(event);
  if (backups.length === 0) return null;

  const lines = backups.map((team, index) => {
    const decision = event.backupDecisions?.[team.teamId] || 'open';

    let status = '⏳ Offen';
    if (decision === 'yes') status = '✅ Bereit';
    if (decision === 'no') status = '❌ Nicht bereit';

    return [
      `**${index + 1}. ${team.clubName}**`,
      getMentionLine(team),
      `Status: ${status}`,
    ].join('\n');
  });

  return [
    '⚠️ **Backups**',
    '',
    'Die folgenden Teams sind aktuell nicht teilnahmeberechtigt.',
    'Bitte bestätigt, ob ihr als Backup bereitsteht:',
    '',
    lines.join('\n\n'),
  ].join('\n');
}

// =========================
// MESSAGE BUILDERS
// =========================

function buildMainEmbed(event) {
  const actualFormat = getActualFormat(event.teams.length);
  const displaySlots = getDisplaySlots(event.teams.length);

  const guild = clientRef.guilds.cache.get(process.env.GUILD_ID);

  const serverLogo = guild?.iconURL({
    extension: 'png',
    size: 1024,
  });

  let statusLine = '🟢 Check-in geöffnet';
  if (event.finalized && event.status === 'confirmed') {
    statusLine = '✅ NightCup findet statt';
  }
  if (event.finalized && event.status === 'cancelled') {
    statusLine = '❌ NightCup findet nicht statt';
  }

  const descriptionParts = [
    `**${statusLine}**`,
    `📅 **Datum:** ${event.displayDate}`,
    '',
    `⏰ **Anmeldeschluss:** 23:00 Uhr`,
    `⌛ **Noch offen:** ${formatCountdown(event.deadlineAt)}`,
    '',
    `🚀 **Turnierstart:** 00:00 Uhr`,
    `${event.startLine}`,
    `🕛 **Start in:** ${formatCountdown(event.startAt)}`,
    '',
    `📜 **Regeln:** <#${process.env.RULES_CHANNEL_ID}>`,
    '',
    '━━━━━━━━━━━━━━',
    '',
    `🏆 **Turnierformat:** ${actualFormat === 0 ? 'Noch kein gültiges Turnierformat' : `${actualFormat}er Turnier`}`,
    getFormatExplanation(actualFormat),
    '',
    '━━━━━━━━━━━━━━',
    '',
    `👥 **Teilnehmende Teams (${displaySlots})**`,
    buildSlotsList(event),
  ];

  const backupSection = buildBackupShortSection(event);
  if (backupSection) {
    descriptionParts.push('', '━━━━━━━━━━━━━━', '', backupSection);
  }

  if (event.finalized && event.status === 'cancelled') {
    descriptionParts.push(
      '',
      '━━━━━━━━━━━━━━',
      '',
      '❌ **NightCup findet nicht statt**',
      'Minimum sind **8 Teams**.'
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(`🌙 Loco NightCup ${event.label}`)
    .setDescription(descriptionParts.join('\n'))
    .setColor(0xff0000);

  if (serverLogo) {
    embed.setThumbnail(serverLogo);
  }

  return embed;
}

function buildMainButtons(event) {
  const disabled = event.finalized || Date.now() >= event.deadlineAt;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`checkin_join:${event.type}`)
      .setLabel('⬆️ Anmelden')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`checkin_leave:${event.type}`)
      .setLabel('⬇️ Abmelden')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildBackupButtons(event) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`backup_yes:${event.type}`)
      .setLabel('✅ Backup bestätigen')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`backup_no:${event.type}`)
      .setLabel('❌ Backup ablehnen')
      .setStyle(ButtonStyle.Secondary)
  );
}

// =========================
// CHANNEL / MESSAGE HELPERS
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

async function findExistingMainMessage(channel, eventLabel) {
  try {
    const messages = await channel.messages.fetch({ limit: 30 });
    const ownMessage = messages.find(msg => {
      if (!msg.author || msg.author.id !== clientRef.user.id) return false;
      if (!msg.embeds || msg.embeds.length === 0) return false;
      const title = msg.embeds[0]?.title || '';
      return title.includes(`Loco NightCup ${eventLabel}`);
    });

    return ownMessage || null;
  } catch (error) {
    return null;
  }
}

// =========================
// EVENT STATE
// =========================

function createNewEventState(type, previousState = null) {
  const cfg = getCycleConfig(type);

  return {
    cycleKey: cfg.key,
    type: cfg.type,
    label: cfg.label,
    channelId: cfg.channelId,
    deadlineAt: cfg.deadlineAt,
    startAt: cfg.startAt,
    resetAt: cfg.resetAt,
    displayDate: cfg.displayDate,
    startLine: cfg.startLine,

    messageId: previousState?.messageId || null,
    summaryMessageId: null,
    backupMessageId: null,

    teams: [],
    backupDecisions: {},

    finalized: false,
    status: 'open',
    lastRenderMinute: null,
  };
}

function findEventByType(data, type) {
  if (type === 'friday') return data.friday;
  if (type === 'saturday') return data.saturday;
  return null;
}

// =========================
// RENDER / UPDATE
// =========================

async function ensureMainMessage(event) {
  const channel = await fetchChannel(event.channelId);
  if (!channel) return event;

  let message = null;

  if (event.messageId) {
    message = await fetchMessage(channel, event.messageId);
  }

  if (!message) {
    message = await findExistingMainMessage(channel, event.label);
    if (message) {
      event.messageId = message.id;
    }
  }

  if (!message) {
    const created = await channel.send({
      embeds: [buildMainEmbed(event)],
      components: [buildMainButtons(event)],
    });

    event.messageId = created.id;
    return event;
  }

  await message.edit({
    embeds: [buildMainEmbed(event)],
    components: [buildMainButtons(event)],
  });

  return event;
}

async function ensureSummaryMessage(event) {
  if (!event.finalized) return event;

  const channel = await fetchChannel(event.channelId);
  if (!channel) return event;

  const content = buildSummaryContent(event);
  let message = null;

  if (event.summaryMessageId) {
    message = await fetchMessage(channel, event.summaryMessageId);
  }

  if (!message) {
    const created = await channel.send({ content });
    event.summaryMessageId = created.id;
    return event;
  }

  await message.edit({ content });
  return event;
}

async function ensureBackupMessage(event) {
  const channel = await fetchChannel(event.channelId);
  if (!channel) return event;

  const backupContent = buildBackupContent(event);

  if (!backupContent) {
    if (event.backupMessageId) {
      await deleteMessageIfExists(event.channelId, event.backupMessageId);
      event.backupMessageId = null;
    }
    return event;
  }

  let message = null;

  if (event.backupMessageId) {
    message = await fetchMessage(channel, event.backupMessageId);
  }

  if (!message) {
    const created = await channel.send({
      content: backupContent,
      components: [buildBackupButtons(event)],
    });
    event.backupMessageId = created.id;
    return event;
  }

  await message.edit({
    content: backupContent,
    components: [buildBackupButtons(event)],
  });

  return event;
}

async function finalizeEvent(event) {
  if (event.finalized) return event;

  event.finalized = true;
  event.status = getActualFormat(event.teams.length) === 0 ? 'cancelled' : 'confirmed';

  event = await ensureMainMessage(event);
  event = await ensureSummaryMessage(event);
  event = await ensureBackupMessage(event);

  return event;
}

async function resetEvent(oldEvent, type) {
  if (oldEvent?.summaryMessageId) {
    await deleteMessageIfExists(oldEvent.channelId, oldEvent.summaryMessageId);
  }

  if (oldEvent?.backupMessageId) {
    await deleteMessageIfExists(oldEvent.channelId, oldEvent.backupMessageId);
  }

  const fresh = createNewEventState(type, oldEvent || null);
  return ensureMainMessage(fresh);
}

async function reconcileEvent(type, data) {
  const current = data[type];
  const cfg = getCycleConfig(type);

  if (!current) {
    const created = createNewEventState(type, null);
    data[type] = await ensureMainMessage(created);
    return;
  }

  if (current.cycleKey !== cfg.key) {
    data[type] = await resetEvent(current, type);
    return;
  }

  current.deadlineAt = cfg.deadlineAt;
  current.startAt = cfg.startAt;
  current.resetAt = cfg.resetAt;
  current.displayDate = cfg.displayDate;
  current.startLine = cfg.startLine;
  current.channelId = cfg.channelId;

  if (!current.finalized && Date.now() >= current.deadlineAt) {
    data[type] = await finalizeEvent(current);
    return;
  }

  const now = new Date();
  const renderMinute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

  if (current.lastRenderMinute !== renderMinute) {
    current.lastRenderMinute = renderMinute;
    data[type] = await ensureMainMessage(current);

    if (current.finalized) {
      data[type] = await ensureSummaryMessage(current);
      data[type] = await ensureBackupMessage(current);
    }
  }
}

async function reconcileAll() {
  if (!clientRef) return;

  const data = loadCheckins();

  await reconcileEvent('friday', data);
  await reconcileEvent('saturday', data);

  saveCheckins(data);
}

// =========================
// BUTTON HANDLERS
// =========================

async function handleJoin(interaction, type) {
  const data = loadCheckins();
  const event = findEventByType(data, type);

  if (!event) {
    await interaction.reply({
      content: '❌ Check-in wurde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (event.finalized || Date.now() >= event.deadlineAt) {
    await interaction.reply({
      content: '❌ Die Anmeldung ist bereits geschlossen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const team = getUserTeam(interaction.user.id);

  if (!team) {
    await interaction.reply({
      content: '❌ Du bist keinem registrierten Team als Vereinsmanager oder Co-VM zugeordnet.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const alreadyIn = event.teams.find(entry => entry.teamId === team.id);
  if (alreadyIn) {
    await interaction.reply({
      content: '⚠️ Dein Team ist bereits angemeldet.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  event.teams.push(normalizeTeamForCheckin(team));
  event.teams.sort((a, b) => a.joinedAt - b.joinedAt);

  data[type] = await ensureMainMessage(event);
  saveCheckins(data);

  await interaction.reply({
    content: `✅ **${team.clubName}** wurde angemeldet.`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleLeave(interaction, type) {
  const data = loadCheckins();
  const event = findEventByType(data, type);

  if (!event) {
    await interaction.reply({
      content: '❌ Check-in wurde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (event.finalized || Date.now() >= event.deadlineAt) {
    await interaction.reply({
      content: '❌ Die Anmeldung ist bereits geschlossen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const team = getUserTeam(interaction.user.id);

  if (!team) {
    await interaction.reply({
      content: '❌ Du bist keinem registrierten Team als Vereinsmanager oder Co-VM zugeordnet.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const before = event.teams.length;
  event.teams = event.teams.filter(entry => entry.teamId !== team.id);

  if (before === event.teams.length) {
    await interaction.reply({
      content: '⚠️ Dein Team war nicht angemeldet.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  data[type] = await ensureMainMessage(event);
  saveCheckins(data);

  await interaction.reply({
    content: `⬇️ **${team.clubName}** wurde abgemeldet.`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleBackupDecision(interaction, type, decision) {
  const data = loadCheckins();
  const event = findEventByType(data, type);

  if (!event || !event.finalized) {
    await interaction.reply({
      content: '❌ Es wurde kein passender Backup-Check gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const userTeam = getUserTeam(interaction.user.id);

  if (!userTeam) {
    await interaction.reply({
      content: '❌ Du bist keinem registrierten Team als Vereinsmanager oder Co-VM zugeordnet.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const backups = getBackupTeams(event);
  const backupTeam = backups.find(team => team.teamId === userTeam.id);

  if (!backupTeam) {
    await interaction.reply({
      content: '❌ Nur Teams, die aktuell als Backup geführt werden, dürfen diese Buttons benutzen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (
    !isUserAllowedForTeam(interaction.user.id, {
      managerId: backupTeam.managerId,
      coManagerIds: backupTeam.coManagerIds,
    })
  ) {
    await interaction.reply({
      content: '❌ Du darfst diese Backup-Aktion nicht ausführen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!event.backupDecisions) {
    event.backupDecisions = {};
  }

  event.backupDecisions[backupTeam.teamId] = decision;

  data[type] = await ensureBackupMessage(event);
  saveCheckins(data);

  await interaction.reply({
    content:
      decision === 'yes'
        ? `✅ **${backupTeam.clubName}** ist jetzt als Backup bestätigt.`
        : `❌ **${backupTeam.clubName}** wurde als Backup abgelehnt.`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

// =========================
// EXPORTS
// =========================

module.exports = {
  async init(client) {
    clientRef = client;
    ensureCheckinsFile();

    await reconcileAll();

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await reconcileAll();
        } catch (error) {
          console.error('❌ Fehler im Check-in-Intervall:', error);
        }
      }, 60 * 1000);
    }
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton()) return false;

    if (interaction.customId.startsWith('checkin_join:')) {
      const [, type] = interaction.customId.split(':');
      return handleJoin(interaction, type);
    }

    if (interaction.customId.startsWith('checkin_leave:')) {
      const [, type] = interaction.customId.split(':');
      return handleLeave(interaction, type);
    }

    if (interaction.customId.startsWith('backup_yes:')) {
      const [, type] = interaction.customId.split(':');
      return handleBackupDecision(interaction, type, 'yes');
    }

    if (interaction.customId.startsWith('backup_no:')) {
      const [, type] = interaction.customId.split(':');
      return handleBackupDecision(interaction, type, 'no');
    }

    return false;
  },

  async handleMessage() {
    return false;
  },
};