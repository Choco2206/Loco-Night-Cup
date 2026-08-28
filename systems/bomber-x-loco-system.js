const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const banlistSystem = require('./banlist-system');

const STATE_FILE = path.join(process.cwd(), 'data', 'bomber-x-loco.json');
const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');
const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');

const SPECIAL_CHANNEL_ID = '1542823464434671676';
const SPECIAL_DATE = '2026-09-19';

const EVENT_CONFIG = Object.freeze({
  id: 'bomber-x-loco-2026',
  name: 'Bomber X Loco Cup',
  date: SPECIAL_DATE,
  channelId: SPECIAL_CHANNEL_ID,
  maxTeams: 48,
  groupSize: 6,
  deadlineAt: Date.parse('2026-09-19T20:30:00+02:00'),
  lateDeadlineAt: Date.parse('2026-09-19T20:45:00+02:00'),
  drawAt: Date.parse('2026-09-19T20:50:00+02:00'),
  startAt: Date.parse('2026-09-19T21:00:00+02:00'),
  resetAt: Date.parse('2026-09-20T07:00:00+02:00'),
  deadlineText: '20:30',
  lateDeadlineText: '20:45',
  drawText: '20:50',
  startText: '21:00',
});

const FORMAT_CONFIGS = Object.freeze({
  6:  { groups: 1, koTeams: 4,  firstRound: 'semiFinal' },
  12: { groups: 2, koTeams: 8,  firstRound: 'quarterFinal' },
  18: { groups: 3, koTeams: 8,  firstRound: 'quarterFinal' },
  24: { groups: 4, koTeams: 16, firstRound: 'roundOf16' },
  30: { groups: 5, koTeams: 16, firstRound: 'roundOf16' },
  36: { groups: 6, koTeams: 16, firstRound: 'roundOf16' },
  42: { groups: 7, koTeams: 32, firstRound: 'roundOf32' },
  48: { groups: 8, koTeams: 32, firstRound: 'roundOf32' },
});

let clientRef = null;
let intervalRef = null;

function ensureStateFile() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(createInitialState(), null, 2), 'utf8');
  }
}

function createInitialState() {
  return {
    eventId: EVENT_CONFIG.id,
    eventName: EVENT_CONFIG.name,
    eventDate: EVENT_CONFIG.date,
    messageId: null,
    teams: [],
    finalized: false,
    format: 0,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function loadState() {
  ensureStateFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8') || '{}');
    return { ...createInitialState(), ...parsed, teams: Array.isArray(parsed.teams) ? parsed.teams : [] };
  } catch (error) {
    console.error('❌ Bomber X Loco State konnte nicht gelesen werden:', error);
    return createInitialState();
  }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function loadTeams() {
  try {
    if (!fs.existsSync(TEAMS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('❌ teams.json konnte für Bomber X Loco nicht gelesen werden:', error);
    return [];
  }
}

function getUserTeam(userId) {
  return loadTeams().find(team =>
    String(team.managerId) === String(userId) ||
    (Array.isArray(team.coManagerIds) && team.coManagerIds.map(String).includes(String(userId)))
  );
}

function normalizeTeam(team) {
  return {
    teamId: team.id,
    clubName: team.clubName,
    managerId: team.managerId || null,
    coManagerIds: Array.isArray(team.coManagerIds) ? team.coManagerIds : [],
    joinedAt: Date.now(),
  };
}

function getTeamBan(team, userId) {
  if (!team) return null;
  return (
    banlistSystem.isTeamOrUserBanned({ teamId: team.id || team.teamId }) ||
    banlistSystem.isTeamOrUserBanned({ userId: team.managerId }) ||
    (Array.isArray(team.coManagerIds)
      ? team.coManagerIds.map(id => banlistSystem.isTeamOrUserBanned({ userId: id })).find(Boolean)
      : null) ||
    banlistSystem.isTeamOrUserBanned({ userId }) ||
    null
  );
}

function getActualFormat(teamCount) {
  const formats = Object.keys(FORMAT_CONFIGS).map(Number).sort((a, b) => a - b);
  let result = 0;
  for (const format of formats) {
    if (teamCount >= format) result = format;
  }
  return result;
}

function getFormatConfig(teamCountOrFormat) {
  const format = FORMAT_CONFIGS[teamCountOrFormat]
    ? Number(teamCountOrFormat)
    : getActualFormat(Number(teamCountOrFormat));
  return format ? { format, ...FORMAT_CONFIGS[format] } : null;
}

function getQualificationPlan(teamCountOrFormat) {
  const cfg = getFormatConfig(teamCountOrFormat);
  if (!cfg) return null;

  const directPlacesPerGroup = Math.floor(cfg.koTeams / cfg.groups);
  const directTeams = directPlacesPerGroup * cfg.groups;
  const wildcardCount = cfg.koTeams - directTeams;

  return {
    ...cfg,
    directPlacesPerGroup,
    wildcardPlace: wildcardCount > 0 ? directPlacesPerGroup + 1 : null,
    wildcardCount,
  };
}

function compareRows(a, b) {
  if (Number(b.points || 0) !== Number(a.points || 0)) return Number(b.points || 0) - Number(a.points || 0);
  if (Number(b.diff || 0) !== Number(a.diff || 0)) return Number(b.diff || 0) - Number(a.diff || 0);
  return String(a.clubName || '').localeCompare(String(b.clubName || ''), 'de');
}

function selectQualifiedTeams(groupPlacements, teamCountOrFormat) {
  const plan = getQualificationPlan(teamCountOrFormat);
  if (!plan) return [];

  const letters = Object.keys(groupPlacements || {}).sort();
  const qualified = [];

  for (const letter of letters) {
    const rows = [...(groupPlacements[letter] || [])].sort(compareRows);
    qualified.push(...rows.slice(0, plan.directPlacesPerGroup));
  }

  if (plan.wildcardCount > 0 && plan.wildcardPlace) {
    const wildcardRows = letters
      .map(letter => [...(groupPlacements[letter] || [])].sort(compareRows)[plan.wildcardPlace - 1])
      .filter(Boolean)
      .sort(compareRows)
      .slice(0, plan.wildcardCount);

    qualified.push(...wildcardRows);
  }

  return qualified.slice(0, plan.koTeams);
}

function isSpecialSaturdayEvent(event) {
  if (!event) return false;
  const value = event.deadlineAt || event.startAt;
  if (!value) return false;
  const d = new Date(Number(value));
  const berlinDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return berlinDate === SPECIAL_DATE;
}

function isNowSpecialDate() {
  const berlinDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return berlinDate === SPECIAL_DATE;
}

function formatCountdown(timestamp) {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'abgelaufen';
  const minutes = Math.floor(diff / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function buildTeamList(state) {
  const lines = [];
  for (let i = 0; i < EVENT_CONFIG.maxTeams; i++) {
    const team = state.teams[i];
    lines.push(`${i + 1}. ${team ? team.clubName : '—'}`);
  }
  return lines.join('\n');
}

function getFormatDescription(state) {
  const format = getActualFormat(state.teams.length);
  if (!format) return 'Noch kein gültiges 6er-Gruppen-Format erreicht.';
  const plan = getQualificationPlan(format);
  const wildcard = plan.wildcardCount > 0
    ? ` + ${plan.wildcardCount} beste(r) Platz-${plan.wildcardPlace}-Team(s) gruppenübergreifend`
    : '';
  return `${format} Teams • ${plan.groups} Gruppe(n) à 6 • ${plan.koTeams} Teams in der K.O.-Phase${wildcard}`;
}

function buildEmbed(state) {
  const status = state.finalized ? '🔒 Check-in geschlossen' : '🟢 Check-in geöffnet';
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('💣🐺 Bomber X Loco Cup • Check-in')
    .setDescription([
      `**${status}**`,
      '📅 **Samstag, 19.09.2026**',
      '',
      `⏰ **Offizieller Anmeldeschluss:** ${EVENT_CONFIG.deadlineText} Uhr`,
      `⌛ **Late Check-in bis:** ${EVENT_CONFIG.lateDeadlineText} Uhr`,
      `🎲 **Gruppenauslosung:** ${EVENT_CONFIG.drawText} Uhr`,
      `🚀 **Turnierstart:** ${EVENT_CONFIG.startText} Uhr`,
      `🕛 **Start in:** ${formatCountdown(EVENT_CONFIG.startAt)}`,
      '',
      '━━━━━━━━━━━━━━',
      '',
      `🏆 **Format:** ${getFormatDescription(state)}`,
      '👥 **Maximal 48 Teams**',
      '',
      `**Teilnehmende Teams (${state.teams.length}/48)**`,
      buildTeamList(state),
    ].join('\n'));
}

function buildButtons(state) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bomber_loco_join')
      .setLabel('✅ Anmelden')
      .setStyle(ButtonStyle.Success)
      .setDisabled(state.finalized || Date.now() >= EVENT_CONFIG.lateDeadlineAt),
    new ButtonBuilder()
      .setCustomId('bomber_loco_leave')
      .setLabel('⬇️ Abmelden')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.finalized || Date.now() >= EVENT_CONFIG.lateDeadlineAt)
  );
}

async function ensureMainMessage() {
  if (!clientRef) return;
  const channel = await clientRef.channels.fetch(SPECIAL_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error(`❌ Bomber X Loco Check-in-Kanal nicht gefunden: ${SPECIAL_CHANNEL_ID}`);
    return;
  }

  const state = loadState();
  if (Date.now() >= EVENT_CONFIG.lateDeadlineAt) {
    state.finalized = true;
    state.format = getActualFormat(state.teams.length);
    state.status = state.format ? 'confirmed' : 'cancelled';
  }

  let message = state.messageId
    ? await channel.messages.fetch(state.messageId).catch(() => null)
    : null;

  const payload = { embeds: [buildEmbed(state)], components: [buildButtons(state)] };
  if (!message) {
    message = await channel.send(payload);
    state.messageId = message.id;
  } else {
    await message.edit(payload);
  }

  saveState(state);
}

async function handleJoin(interaction) {
  const state = loadState();
  if (state.finalized || Date.now() >= EVENT_CONFIG.lateDeadlineAt) {
    await interaction.reply({ content: '❌ Die Anmeldung ist bereits geschlossen.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const team = getUserTeam(interaction.user.id);
  if (!team) {
    await interaction.reply({ content: '❌ Du bist keinem registrierten Team als VM oder Co-VM zugeordnet.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const ban = getTeamBan(team, interaction.user.id);
  if (ban) {
    await interaction.reply({ content: `🚫 **${team.clubName}** ist aktuell gesperrt und kann nicht teilnehmen.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (state.teams.some(t => String(t.teamId) === String(team.id))) {
    await interaction.reply({ content: '⚠️ Dein Team ist bereits angemeldet.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (state.teams.length >= EVENT_CONFIG.maxTeams) {
    await interaction.reply({ content: '❌ Der Bomber X Loco Cup ist mit 48 Teams voll.', flags: MessageFlags.Ephemeral });
    return true;
  }

  state.teams.push(normalizeTeam(team));
  state.teams.sort((a, b) => a.joinedAt - b.joinedAt);
  state.format = getActualFormat(state.teams.length);
  saveState(state);
  await ensureMainMessage();

  await interaction.reply({ content: `✅ **${team.clubName}** wurde für den Bomber X Loco Cup angemeldet.`, flags: MessageFlags.Ephemeral });
  return true;
}

async function handleLeave(interaction) {
  const state = loadState();
  if (state.finalized || Date.now() >= EVENT_CONFIG.lateDeadlineAt) {
    await interaction.reply({ content: '❌ Die Anmeldung ist bereits geschlossen.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const team = getUserTeam(interaction.user.id);
  if (!team) {
    await interaction.reply({ content: '❌ Du bist keinem registrierten Team als VM oder Co-VM zugeordnet.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const before = state.teams.length;
  state.teams = state.teams.filter(t => String(t.teamId) !== String(team.id));
  if (before === state.teams.length) {
    await interaction.reply({ content: '⚠️ Dein Team ist nicht angemeldet.', flags: MessageFlags.Ephemeral });
    return true;
  }

  state.format = getActualFormat(state.teams.length);
  saveState(state);
  await ensureMainMessage();

  await interaction.reply({ content: `⬇️ **${team.clubName}** wurde abgemeldet.`, flags: MessageFlags.Ephemeral });
  return true;
}

async function blockNormalSaturday(interaction) {
  const channelMention = `<#${SPECIAL_CHANNEL_ID}>`;
  await interaction.reply({
    content: [
      '💣🐺 **An diesem Samstag findet kein regulärer Loco Night Cup statt.**',
      '',
      'Am **19.09.2026** läuft stattdessen der **Bomber X Loco Cup**.',
      `Wenn ihr teilnehmen wollt, meldet euch hier an: ${channelMention}`,
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

module.exports = {
  EVENT_CONFIG,
  FORMAT_CONFIGS,
  getActualFormat,
  getFormatConfig,
  getQualificationPlan,
  selectQualifiedTeams,
  isSpecialSaturdayEvent,

  async init(client) {
    clientRef = client;
    ensureStateFile();
    await ensureMainMessage();

    if (!intervalRef) {
      intervalRef = setInterval(() => {
        ensureMainMessage().catch(error => console.error('❌ Bomber X Loco Update fehlgeschlagen:', error));
      }, 60 * 1000);
    }
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton()) return false;
    if (interaction.customId === 'bomber_loco_join') return handleJoin(interaction);
    if (interaction.customId === 'bomber_loco_leave') return handleLeave(interaction);

    if (
      isNowSpecialDate() &&
      (interaction.customId === 'checkin_join:saturday' || interaction.customId === 'checkin_leave:saturday')
    ) {
      return blockNormalSaturday(interaction);
    }

    return false;
  },
};
