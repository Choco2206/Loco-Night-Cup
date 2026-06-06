const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { generateCeremonyImage } = require('./ceremony-image');

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');
const KO_FILE = path.join(process.cwd(), 'data', 'ko.json');
const ANNOUNCEMENT_STATE_FILE = path.join(process.cwd(), 'data', 'announcement-state.json');

// =========================
// FILE HELPERS
// =========================

function ensureFile(filePath, fallback) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  ensureFile(filePath, fallback);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`❌ Fehler beim Lesen von ${filePath}:`, error);
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben von ${filePath}:`, error);
  }
}

function loadTeams() {
  return readJson(TEAMS_FILE, []);
}

function loadKo() {
  return readJson(KO_FILE, { friday: null, saturday: null });
}

function loadAnnouncementState() {
  return readJson(ANNOUNCEMENT_STATE_FILE, {
    friday: {
      ceremonyPosted: false,
      cycleKey: null,
      postedAt: null,
    },
    saturday: {
      ceremonyPosted: false,
      cycleKey: null,
      postedAt: null,
    },
  });
}

function saveAnnouncementState(data) {
  writeJson(ANNOUNCEMENT_STATE_FILE, data);
}

// =========================
// HELPERS
// =========================

function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

function findTeamById(teamId) {
  return (
    loadTeams().find(
      team =>
        String(team.id) === String(teamId) ||
        String(team.teamId) === String(teamId)
    ) || null
  );
}

function buildMentions(team) {
  if (!team) return '';

  const ids = [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ]
    .filter(Boolean)
    .map(id => String(id));

  if (!ids.length) return '';

  return [...new Set(ids)].map(id => `<@${id}>`).join(' ');
}

function getLogoPath(logoFile) {
  if (!logoFile) return null;

  const possiblePaths = [
    path.join(process.cwd(), 'uploads', logoFile),
    path.join(process.cwd(), 'data', 'logos', logoFile),
    path.join(process.cwd(), 'assets', 'logos', logoFile),
    path.join(process.cwd(), logoFile),
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function getKoEvent(eventKey) {
  const ko = loadKo();
  return ko[eventKey] || null;
}

function getCurrentCycleKey(eventKey) {
  const event = getKoEvent(eventKey);
  return event?.cycleKey || null;
}

function hasCeremonyAlreadyPosted(eventKey) {
  const state = loadAnnouncementState();
  const currentCycleKey = getCurrentCycleKey(eventKey);

  if (!currentCycleKey) return false;

  return (
    state?.[eventKey]?.ceremonyPosted === true &&
    state?.[eventKey]?.cycleKey === currentCycleKey
  );
}

function markCeremonyPosted(eventKey) {
  const state = loadAnnouncementState();
  const currentCycleKey = getCurrentCycleKey(eventKey);

  if (!state[eventKey]) {
    state[eventKey] = {
      ceremonyPosted: false,
      cycleKey: null,
      postedAt: null,
    };
  }

  state[eventKey].ceremonyPosted = true;
  state[eventKey].cycleKey = currentCycleKey;
  state[eventKey].postedAt = new Date().toISOString();

  saveAnnouncementState(state);
}

function resetCeremonyPosted(eventKey) {
  const state = loadAnnouncementState();

  if (!state[eventKey]) {
    state[eventKey] = {
      ceremonyPosted: false,
      cycleKey: null,
      postedAt: null,
    };
  }

  state[eventKey].ceremonyPosted = false;
  state[eventKey].cycleKey = null;
  state[eventKey].postedAt = null;

  saveAnnouncementState(state);
}

function getPlacementData(eventKey) {
  const ko = loadKo();
  const event = ko[eventKey];

  if (!event?.rounds) return null;

  const finalMatch = event.rounds.final?.matches?.[0];
  const thirdPlaceMatch = event.rounds.thirdPlace?.matches?.[0];

  if (!finalMatch || !thirdPlaceMatch) return null;
  if (finalMatch.status !== 'confirmed') return null;
  if (thirdPlaceMatch.status !== 'confirmed') return null;

  const firstTeamId = finalMatch.winnerTeamId;
  const secondTeamId = finalMatch.loserTeamId;
  const thirdTeamId = thirdPlaceMatch.winnerTeamId;

  if (!firstTeamId || !secondTeamId || !thirdTeamId) return null;

  const first = findTeamById(firstTeamId);
  const second = findTeamById(secondTeamId);
  const third = findTeamById(thirdTeamId);

  if (!first || !second || !third) return null;

  return {
    label: event.label || eventKey,
    cycleKey: event.cycleKey || null,
    first,
    second,
    third,
  };
}

// =========================
// EMBED BUILDERS
// =========================

function buildHeaderEmbed(eventLabel, first, second, third) {
  return new EmbedBuilder()
    .setTitle(`🏆 Siegerehrung • ${safeText(eventLabel)}`)
    .setDescription(
      [
        'Der Cup ist beendet. Hier ist die offizielle Top 3:',
        '',
        `🥇 **1. Platz:** ${safeText(first?.clubName)}`,
        `🥈 **2. Platz:** ${safeText(second?.clubName)}`,
        `🥉 **3. Platz:** ${safeText(third?.clubName)}`,
      ].join('\n')
    )
    .setColor(0xff0000)
    .setTimestamp();
}

function buildPlacementEmbed({ place, emoji, team, text, color }) {
  return new EmbedBuilder()
    .setTitle(`${emoji} ${place}. Platz`)
    .setDescription(
      [
        `${text} **${safeText(team?.clubName)}**`,
        '',
        `**Manager / Co-Manager:** ${buildMentions(team) || '—'}`,
      ].join('\n')
    )
    .setColor(color)
    .setTimestamp();
}

function buildThanksEmbed() {
  return new EmbedBuilder()
    .setTitle('❤️ Danke für diesen Cup')
    .setDescription(
      [
        '**Danke an alle Teams, Manager und Spieler fürs Mitmachen.**',
        '',
        'Der Loco Night Cup ist gespielt und genau so soll es weitergehen.',
        '',
        'Wenn euch das Turnier gefallen hat, erzählt es gerne weiter und bringt beim nächsten Mal wieder Teams mit.',
        '',
        'GG an alle. Bis zum nächsten Cup. 🏆',
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildCeremonyText(eventLabel, first, second, third) {
  return [
    `🏆 **SIEGEREHRUNG • ${safeText(eventLabel).toUpperCase()}**`,
    '',
    'Der Loco Night Cup ist beendet. Hier ist die offizielle Top 3:',
    '',
    `🥇 **1. Platz:** ${safeText(first?.clubName)}`,
    `👑 Manager / Co-Manager:`,
    `${buildMentions(first) || '—'}`,
    '',
    'Verdient den Titel geholt und über das gesamte Turnier hinweg überzeugt. Herzlichen Glückwunsch zum Turniersieg! 🏆',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥈 **2. Platz:** ${safeText(second?.clubName)}`,
    `👑 Manager / Co-Manager:`,
    `${buildMentions(second) || '—'}`,
    '',
    'Starke Leistungen gezeigt und völlig verdient auf dem Podium gelandet. 👏',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥉 **3. Platz:** ${safeText(third?.clubName)}`,
    `👑 Manager / Co-Manager:`,
    `${buildMentions(third) || '—'}`,
    '',
    'Ebenfalls ein starkes Turnier gespielt und sich den Platz auf dem Treppchen verdient gesichert. 👏',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '❤️ **Danke an alle Teilnehmer**',
    '',
    'Vielen Dank an alle Teams für die Teilnahme am heutigen Cup.',
    '',
    'Wir hoffen, ihr hattet Spaß und seid auch beim nächsten Loco Night Cup wieder dabei.',
    '',
    'Bis zum nächsten Mal! 🏆🐺',
  ].join('\n');
}

// =========================
// SEND HELPERS
// =========================

async function sendPlacementMessage(channel, { place, emoji, team, text, color, useLogo }) {
  if (!channel || !team) return;

  const embed = buildPlacementEmbed({
    place,
    emoji,
    team,
    text,
    color,
  });

  const payload = {
    embeds: [embed],
    allowedMentions: { parse: ['users'] },
  };

  if (useLogo) {
    const logoPath = getLogoPath(team.logoFile);

    if (logoPath) {
      const fileName = path.basename(logoPath);
      const attachment = new AttachmentBuilder(logoPath, { name: fileName });

      embed.setThumbnail(`attachment://${fileName}`);
      payload.files = [attachment];
    }
  }

  await channel.send(payload);
}

// =========================
// MAIN
// =========================

async function sendTournamentCeremonyIfReady(client, eventKey) {
  const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;

  if (!channelId) {
    console.error('❌ ANNOUNCEMENT_CHANNEL_ID fehlt in der .env');
    return false;
  }

  const placementData = getPlacementData(eventKey);
  if (!placementData) {
    return false;
  }

  if (hasCeremonyAlreadyPosted(eventKey)) {
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.error('❌ Ankündigungskanal konnte nicht geladen werden.');
    return false;
  }

  const ceremonyImagePath = await generateCeremonyImage({
    eventKey,
    eventLabel: placementData.label,
    first: placementData.first,
    second: placementData.second,
    third: placementData.third,
    firstLogoPath: getLogoPath(placementData.first.logoFile),
    secondLogoPath: getLogoPath(placementData.second.logoFile),
    thirdLogoPath: getLogoPath(placementData.third.logoFile),
  });

  const ceremonyAttachment = new AttachmentBuilder(ceremonyImagePath, {
    name: 'loco-night-cup-siegerehrung.png',
  });

  await channel.send({
  content: '@everyone',
  files: [ceremonyAttachment],
  allowedMentions: {
    parse: ['everyone'],
  },
});

await channel.send({
  content: buildCeremonyText(
    placementData.label,
    placementData.first,
    placementData.second,
    placementData.third
  ),
  allowedMentions: { parse: ['users'] },
});

  markCeremonyPosted(eventKey);
  return true;
}

module.exports = {
  sendTournamentCeremonyIfReady,
  hasCeremonyAlreadyPosted,
  resetCeremonyPosted,
};