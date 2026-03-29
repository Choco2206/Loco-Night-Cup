const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

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
    friday: { ceremonyPosted: false },
    saturday: { ceremonyPosted: false },
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
  return loadTeams().find(team => team.id === teamId) || null;
}

function buildMentions(team) {
  if (!team) return '';

  const ids = [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ].filter(Boolean);

  if (!ids.length) return '';

  return ids.map(id => `<@${id}>`).join(' ');
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

  return {
    label: event.label || eventKey,
    first: findTeamById(firstTeamId),
    second: findTeamById(secondTeamId),
    third: findTeamById(thirdTeamId),
  };
}

function hasCeremonyAlreadyPosted(eventKey) {
  const state = loadAnnouncementState();
  return !!state?.[eventKey]?.ceremonyPosted;
}

function markCeremonyPosted(eventKey) {
  const state = loadAnnouncementState();

  if (!state[eventKey]) {
    state[eventKey] = {};
  }

  state[eventKey].ceremonyPosted = true;
  state[eventKey].postedAt = new Date().toISOString();

  saveAnnouncementState(state);
}

function resetCeremonyPosted(eventKey) {
  const state = loadAnnouncementState();

  if (!state[eventKey]) {
    state[eventKey] = {};
  }

  state[eventKey].ceremonyPosted = false;
  delete state[eventKey].postedAt;

  saveAnnouncementState(state);
}

// =========================
// EMBEDS
// =========================

function buildHeaderEmbed(eventLabel, first, second, third) {
  return new EmbedBuilder()
    .setTitle(`🏆 Siegerehrung • ${safeText(eventLabel)}`)
    .setDescription(
      [
        'Der Cup ist beendet und hier ist die offizielle Top 3:',
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
    .setTitle('❤️ Danke an alle Teilnehmer')
    .setDescription(
      [
        'Danke an alle Teams fürs Mitmachen.',
        'Wir hoffen, der Cup hat euch Spaß gemacht.',
        '',
        'Wenn euch das Turnier gefallen hat, erzählt es gern weiter und macht andere Teams auf den Cup aufmerksam.',
      ].join('\n')
    )
    .setColor(0xff0000);
}

async function sendPlacementMessage(channel, { place, emoji, team, text, color, useLogo }) {
  if (!channel || !team) return;

  const embed = buildPlacementEmbed({
    place,
    emoji,
    team,
    text,
    color,
  });

  const mentions = buildMentions(team);
  const payload = {
    content: mentions || undefined,
    embeds: [embed],
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

  if (hasCeremonyAlreadyPosted(eventKey)) {
    return false;
  }

  const placementData = getPlacementData(eventKey);
  if (!placementData) {
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.error('❌ Ankündigungskanal konnte nicht geladen werden.');
    return false;
  }

  await channel.send({
    embeds: [
      buildHeaderEmbed(
        placementData.label,
        placementData.first,
        placementData.second,
        placementData.third
      ),
    ],
  });

  await sendPlacementMessage(channel, {
    place: 1,
    emoji: '🥇',
    team: placementData.first,
    text: 'Herzlichen Glückwunsch an',
    color: 0xf1c40f,
    useLogo: true,
  });

  await sendPlacementMessage(channel, {
    place: 2,
    emoji: '🥈',
    team: placementData.second,
    text: 'Starker Auftritt von',
    color: 0xc0c0c0,
    useLogo: true,
  });

  await sendPlacementMessage(channel, {
    place: 3,
    emoji: '🥉',
    team: placementData.third,
    text: 'Glückwunsch auch an',
    color: 0xcd7f32,
    useLogo: true,
  });

  await channel.send({
    embeds: [buildThanksEmbed()],
  });

  markCeremonyPosted(eventKey);
  return true;
}

module.exports = {
  sendTournamentCeremonyIfReady,
  resetCeremonyPosted,
  hasCeremonyAlreadyPosted,
};
