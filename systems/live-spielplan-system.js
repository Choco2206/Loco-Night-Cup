const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const LIVE_FILE = path.join(process.cwd(), 'data', 'live-spielplan.json');
const GROUPS_FILE = path.join(process.cwd(), 'data', 'groups.json');
const RESULTS_FILE = path.join(process.cwd(), 'data', 'results.json');
const KO_FILE = path.join(process.cwd(), 'data', 'ko.json');

const LIVE_CHANNEL_ID = process.env.LIVE_SPIELPLAN_CHANNEL_ID;

let clientRef = null;
let intervalRef = null;

// =========================
// FILE HELPERS
// =========================

function ensureLiveFile() {
  const dir = path.dirname(LIVE_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(LIVE_FILE)) {
    fs.writeFileSync(
      LIVE_FILE,
      JSON.stringify({ friday: null, saturday: null }, null, 2),
      'utf8'
    );
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`❌ Fehler beim Lesen von ${file}:`, error);
    return fallback;
  }
}

function loadLive() {
  ensureLiveFile();
  const parsed = readJson(LIVE_FILE, {});
  return {
    friday: parsed.friday || null,
    saturday: parsed.saturday || null,
  };
}

function saveLive(data) {
  ensureLiveFile();
  fs.writeFileSync(LIVE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadGroups() {
  const parsed = readJson(GROUPS_FILE, {});
  return {
    friday: parsed.friday || null,
    saturday: parsed.saturday || null,
  };
}

function loadResults() {
  const parsed = readJson(RESULTS_FILE, {});
  return {
    friday: parsed.friday || null,
    saturday: parsed.saturday || null,
  };
}

function loadKo() {
  const parsed = readJson(KO_FILE, {});
  return {
    friday: parsed.friday || null,
    saturday: parsed.saturday || null,
  };
}

// =========================
// BASIC HELPERS
// =========================

function nowIso() {
  return new Date().toISOString();
}

function isExpired(event) {
  if (!event?.resetAt) return false;
  return Date.now() >= Number(event.resetAt);
}

function getFormatText(format) {
  if (Number(format) === 24) {
    return '24er Cup • Platz 1 & 2 kommen weiter + die 4 besten Drittplatzierten';
  }

  if (Number(format) === 18) {
    return '18er Cup • Platz 1 kommt weiter';
  }

  if (Number(format) === 16) {
    return '16er Cup • Platz 1 & 2 kommen weiter';
  }

  if (Number(format) === 8) {
    return '8er Cup • Platz 1 & 2 kommen weiter';
  }

  if (Number(format) === 32) {
    return '32er Cup • Platz 1 & 2 kommen weiter';
  }

  return format ? `${format}er Cup` : 'Turnierformat noch offen';
}

function getRoundLabel(roundKey) {
  if (roundKey === 'roundOf16') return 'Achtelfinale';
  if (roundKey === 'quarterFinal') return 'Viertelfinale';
  if (roundKey === 'semiFinal') return 'Halbfinale';
  if (roundKey === 'thirdPlace') return 'Spiel um Platz 3';
  if (roundKey === 'final') return 'Finale';
  return 'K.O.-Runde';
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.clubName.localeCompare(b.clubName, 'de');
  });
}

function matchStatus(match) {
  if (match.status === 'confirmed' && match.reportedScore) {
    return `✅ ${match.reportedScore.home}:${match.reportedScore.away}`;
  }

  if (match.status === 'awaiting' && match.waitingForClubName) {
    return `⏳ wartet auf ${match.waitingForClubName}`;
  }

  if (match.status === 'disputed') {
    return '🚨 Admin-Klärung';
  }

  return '⏳ offen';
}

function roundIsComplete(round) {
  return round?.matches?.length && round.matches.every(match => match.status === 'confirmed');
}

// =========================
// DISCORD HELPERS
// =========================

async function fetchLiveChannel() {
  if (!LIVE_CHANNEL_ID) {
    console.error('❌ LIVE_SPIELPLAN_CHANNEL_ID fehlt.');
    return null;
  }

  try {
    return await clientRef.channels.fetch(LIVE_CHANNEL_ID);
  } catch (error) {
    console.error('❌ Live-Spielplan-Kanal konnte nicht geladen werden:', error);
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

async function upsertMessage(channel, messageId, payload) {
  const existing = await fetchMessage(channel, messageId);

  if (existing) {
    await existing.edit(payload);
    return existing.id;
  }

  const created = await channel.send(payload);
  return created.id;
}

async function deleteLiveMessage(channel, messageId) {
  const message = await fetchMessage(channel, messageId);
  if (!message) return;

  await message.delete().catch(() => {});
}

async function clearLiveChannel() {
  const channel = await fetchLiveChannel();
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
    console.error('❌ Live-Spielplan konnte nicht geleert werden:', error);
  }
}

// =========================
// EMBEDS
// =========================

function buildHeaderEmbed(event, phase) {
  return new EmbedBuilder()
    .setTitle(`📊 ${event.label} • Live-Spielplan`)
    .setDescription(
      [
        `🏆 **Turnierformat:** ${getFormatText(event.format)}`,
        '',
        phase === 'groups'
          ? 'Aktuelle Gruppenphase mit Live-Tabelle und Spielplan.'
          : 'Aktuelle K.O.-Phase mit Live-Spielplan.',
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildGroupEmbed(groupLetter, groupMeta, resultGroup) {
  const rows = sortRows(groupMeta.rows || []);

  const tableText = rows.length
    ? rows
        .map((row, index) => {
          const diff = Number(row.diff) > 0 ? `+${row.diff}` : row.diff;
          return `**${index + 1}. ${row.clubName}** • S ${row.s} • U ${row.u} • N ${row.n} • Diff ${diff} • P ${row.points}`;
        })
        .join('\n')
    : 'Noch keine Tabelle vorhanden.';

  const matches = resultGroup?.matches || [];

  const matchText = matches.length
    ? matches
        .map(match => {
          return `**${match.matchNumber}.** ${match.homeClubName} vs ${match.awayClubName} • ${matchStatus(match)}`;
        })
        .join('\n')
    : 'Noch kein Spielplan vorhanden.';

  return new EmbedBuilder()
    .setTitle(`📋 Gruppe ${groupLetter}`)
    .setDescription(
      [
        '**Live-Tabelle**',
        tableText,
        '',
        '**Spielplan**',
        matchText,
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildKoRoundEmbed(roundKey, round) {
  const matches = round?.matches || [];

  const text = matches.length
    ? matches
        .map(match => {
          return `**${match.matchNumber}.** ${match.homeClubName} vs ${match.awayClubName} • ${matchStatus(match)}`;
        })
        .join('\n')
    : 'Noch keine Begegnungen vorhanden.';

  return new EmbedBuilder()
    .setTitle(`🏆 ${getRoundLabel(roundKey)}`)
    .setDescription(text)
    .setColor(0xff0000);
}

// =========================
// SYNC LOGIC
// =========================

async function syncGroups(eventKey, groupEvent, resultEvent) {
  const channel = await fetchLiveChannel();
  if (!channel) return;

  const liveData = loadLive();
  let state = liveData[eventKey];

  if (!state || state.cycleKey !== groupEvent.cycleKey || state.phase !== 'groups') {
    await clearLiveChannel();

    state = {
      cycleKey: groupEvent.cycleKey,
      phase: 'groups',
      resetAt: groupEvent.resetAt || null,
      headerMessageId: null,
      groupMessageIds: {},
      koMessageIds: {},
      cleanedAt: null,
    };
  }

  state.headerMessageId = await upsertMessage(channel, state.headerMessageId, {
    embeds: [buildHeaderEmbed(groupEvent, 'groups')],
  });

  const groupLetters = Object.keys(groupEvent.groups || {}).sort();

  for (const groupLetter of groupLetters) {
    const groupMeta = groupEvent.groups[groupLetter];
    const resultGroup = resultEvent?.groups?.[groupLetter];

    state.groupMessageIds[groupLetter] = await upsertMessage(
      channel,
      state.groupMessageIds[groupLetter],
      {
        embeds: [buildGroupEmbed(groupLetter, groupMeta, resultGroup)],
      }
    );
  }

  liveData[eventKey] = state;
  saveLive(liveData);
}

function getVisibleKoRounds(rounds) {
  const order = ['roundOf16', 'quarterFinal', 'semiFinal', 'thirdPlace', 'final'];

  const existing = order.filter(roundKey => rounds[roundKey]);

  if (rounds.final || rounds.thirdPlace) {
    return existing.filter(roundKey => roundKey === 'final' || roundKey === 'thirdPlace');
  }

  const openRounds = existing.filter(roundKey => !roundIsComplete(rounds[roundKey]));
  if (openRounds.length) return openRounds;

  return existing.slice(-1);
}

async function syncKo(eventKey, koEvent) {
  const channel = await fetchLiveChannel();
  if (!channel) return;

  const liveData = loadLive();
  let state = liveData[eventKey];

  if (!state || state.cycleKey !== koEvent.cycleKey || state.phase !== 'ko') {
    await clearLiveChannel();

    state = {
      cycleKey: koEvent.cycleKey,
      phase: 'ko',
      resetAt: koEvent.resetAt || null,
      headerMessageId: null,
      groupMessageIds: {},
      koMessageIds: {},
      cleanedAt: null,
    };
  }

  state.headerMessageId = await upsertMessage(channel, state.headerMessageId, {
    embeds: [buildHeaderEmbed(koEvent, 'ko')],
  });

  const visibleRounds = getVisibleKoRounds(koEvent.rounds || {});

// alte K.O.-Runden aus dem Live-Spielplan löschen
for (const oldRoundKey of Object.keys(state.koMessageIds || {})) {
  if (!visibleRounds.includes(oldRoundKey)) {
    await deleteLiveMessage(channel, state.koMessageIds[oldRoundKey]);
    delete state.koMessageIds[oldRoundKey];
  }
}

for (const roundKey of visibleRounds) {
    state.koMessageIds[roundKey] = await upsertMessage(
      channel,
      state.koMessageIds[roundKey],
      {
        embeds: [buildKoRoundEmbed(roundKey, koEvent.rounds[roundKey])],
      }
    );
  }

  liveData[eventKey] = state;
  saveLive(liveData);
}

async function cleanupIfExpired(eventKey) {
  const liveData = loadLive();
  const state = liveData[eventKey];

  if (!state || state.cleanedAt || !state.resetAt) return;
  if (Date.now() < Number(state.resetAt)) return;

  await clearLiveChannel();

  state.cleanedAt = nowIso();
  liveData[eventKey] = state;
  saveLive(liveData);
}

async function sync(eventKey) {
  const groupsData = loadGroups();
  const resultsData = loadResults();
  const koData = loadKo();

  const groupEvent = groupsData[eventKey];
  const resultEvent = resultsData[eventKey];
  const koEvent = koData[eventKey];

  if (koEvent && koEvent.rounds && !isExpired(koEvent)) {
    await syncKo(eventKey, koEvent);
    return;
  }

  if (groupEvent && groupEvent.groups && !isExpired(groupEvent)) {
    await syncGroups(eventKey, groupEvent, resultEvent);
    return;
  }

  await cleanupIfExpired(eventKey);
}

async function syncAll() {
  await sync('friday');
  await sync('saturday');

  await cleanupIfExpired('friday');
  await cleanupIfExpired('saturday');
}

// =========================
// EXPORTS
// =========================

module.exports = {
  sync,
  syncAll,

  async init(client) {
    clientRef = client;
    ensureLiveFile();

    await syncAll();

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await syncAll();
        } catch (error) {
          console.error('❌ Fehler im Live-Spielplan-Intervall:', error);
        }
      }, 60 * 1000);
    }
  },
};