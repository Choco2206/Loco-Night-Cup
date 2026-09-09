'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AttachmentBuilder, ChannelType } = require('discord.js');
const { FILES, ROOT_DIR, TEAM_LOGOS_DIR, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { getAutoCleanupScheduledAt, scheduleAutoCleanupForEvent } = require('../events/event-cleanup-service');
const { findTeamById } = require('../teams/team-service');
const {
  applyTeamAchievementsForEvent,
  refreshTeamAchievementsRankingMessage,
} = require('../teams/team-achievements');
const { applyTeamStatsForEvent } = require('../teams/team-statistics');
const { syncChampionRolesForTeam } = require('../teams/team-champion-roles');
const { isLocoZwergenCupEvent } = require('../events/loco-zwergen-cup-config');
const { renderLocoZwergenCupCeremonyImage } = require('../../../utils/loco-zwergen-cup-ceremony-renderer');
const { renderFc27CeremonyImage } = require('../../../utils/fc27-ceremony-renderer');
const {
  renderKoProgression4,
  renderKoProgression8,
  renderKoProgression16,
} = require('../../../utils/ko-progression-renderer');
const { getGraphicsVariant } = require('../graphics/graphics-profile');
const { reserveSerial } = require('../team-of-the-tournament/team-of-the-tournament-post');

const HALL_OF_FAME_CHANNEL_NAME = '👑-hall-of-fame';
const HALL_OF_FAME_TEST_CHANNEL_ID = '1525035287971889173';
const CEREMONY_LOGO_SCALE = 1.75;
const CEREMONY_LOGO_Y_OFFSET = -50;
const CEREMONY_BANNER_DIR = path.join(ROOT_DIR, 'assets', 'ceremony');

const CEREMONY_DAY_LABELS = {
  monday: 'Montag',
  tuesday: 'Dienstag',
  wednesday: 'Mittwoch',
  thursday: 'Donnerstag',
  friday: 'Freitag',
  saturday: 'Samstag',
  sunday: 'Sonntag',
};

const CEREMONY_BANNERS = {
  monday: 'montag-banner.png',
  tuesday: 'dienstag-banner.png',
  wednesday: 'mittwoch-banner.png',
  thursday: 'donnerstag-banner.png',
  friday: 'freitag-banner.png',
  saturday: 'samstag-banner.png',
  sunday: 'sonntag-banner.png',
};

const DEFAULT_LOGO_POSITIONS = {
  first: { x: 728, y: 778, width: 216, height: 82 },
  second: { x: 286, y: 792, width: 214, height: 66 },
  third: { x: 1178, y: 792, width: 214, height: 66 },
};

function createDefaultLogoPositions() {
  return {
    first: { ...DEFAULT_LOGO_POSITIONS.first },
    second: { ...DEFAULT_LOGO_POSITIONS.second },
    third: { ...DEFAULT_LOGO_POSITIONS.third },
  };
}

const CEREMONY_LOGO_POSITIONS = {
  monday: {
    first: { x: 663, y: 752, width: 356, height: 136 },
    second: { x: 305, y: 761, width: 317, height: 99 },
    third: { x: 1046, y: 776, width: 317, height: 99 },
  },
  tuesday: {
    first: { x: 658, y: 801, width: 356, height: 136 },
    second: { x: 275, y: 816, width: 317, height: 99 },
    third: { x: 1087, y: 806, width: 317, height: 99 },
  },
  wednesday: {
    first: { x: 653, y: 797, width: 356, height: 136 },
    second: { x: 235, y: 810, width: 317, height: 99 },
    third: { x: 1077, y: 820, width: 317, height: 99 },
  },
  thursday: {
    first: { x: 658, y: 783, width: 356, height: 136 },
    second: { x: 275, y: 810, width: 317, height: 99 },
    third: { x: 1077, y: 810, width: 317, height: 99 },
  },
  friday: {
    first: { x: 648, y: 783, width: 356, height: 136 },
    second: { x: 255, y: 808, width: 317, height: 99 },
    third: { x: 1097, y: 798, width: 317, height: 99 },
  },
  saturday: {
    first: { x: 658, y: 813, width: 356, height: 136 },
    second: { x: 275, y: 828, width: 317, height: 99 },
    third: { x: 1082, y: 838, width: 317, height: 99 },
  },
  sunday: {
    first: { x: 658, y: 809, width: 356, height: 136 },
    second: { x: 285, y: 824, width: 317, height: 99 },
    third: { x: 1067, y: 824, width: 317, height: 99 },
  },
};

function assertDay(dayKey) {
  if (!CEREMONY_BANNERS[dayKey]) throw new Error('Dieser Wochentag ist nicht bekannt.');
}

function resolveBannerPath(dayKey) {
  assertDay(dayKey);
  const bannerPath = path.join(CEREMONY_BANNER_DIR, CEREMONY_BANNERS[dayKey]);
  if (!fs.existsSync(bannerPath)) throw new Error(`Banner nicht gefunden: ${CEREMONY_BANNERS[dayKey]}`);
  return bannerPath;
}

function resolveTeamLogoPath(team, { optional = false } = {}) {
  if (!team?.logo?.fileName) {
    if (optional) return null;
    throw new Error(`Team ${team?.clubName || team?.id || '-'} hat kein Logo.`);
  }
  const fileName = path.basename(team.logo.fileName);
  const candidates = [
    team.logo.path && !String(team.logo.path).includes('://')
      ? path.resolve(ROOT_DIR, team.logo.path)
      : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean);

  const logoPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!logoPath && optional) return null;
  if (!logoPath) throw new Error(`Logo-Datei für ${team.clubName} nicht gefunden: ${fileName}`);
  return logoPath;
}

function scaleLogoSlot(slot) {
  const width = Math.round(slot.width * CEREMONY_LOGO_SCALE);
  const height = Math.round(slot.height * CEREMONY_LOGO_SCALE);
  return {
    x: Math.round(slot.x - (width - slot.width) / 2),
    y: Math.round(slot.y - (height - slot.height) / 2 + CEREMONY_LOGO_Y_OFFSET),
    width,
    height,
  };
}

async function buildLogoOverlay(team, slot, { optionalLogo = false } = {}) {
  const logoPath = resolveTeamLogoPath(team, { optional: optionalLogo });
  if (!logoPath) return null;
  const scaledSlot = scaleLogoSlot(slot);
  const resized = await sharp(logoPath)
    .resize(scaledSlot.width, scaledSlot.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();

  return {
    input: resized,
    left: Math.round(scaledSlot.x + (scaledSlot.width - metadata.width) / 2),
    top: Math.round(scaledSlot.y + (scaledSlot.height - metadata.height) / 2),
  };
}

function getSelectedTeams({ firstTeamId, secondTeamId, thirdTeamId }) {
  const teams = {
    first: findTeamById(firstTeamId),
    second: findTeamById(secondTeamId),
    third: findTeamById(thirdTeamId),
  };

  for (const [placement, team] of Object.entries(teams)) {
    if (!team || team.status === 'deleted') throw new Error(`Team für ${placement} wurde nicht gefunden.`);
  }

  return teams;
}

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function saveHallOfFameChannelId(channelId) {
  if (!channelId) return;
  updateJson(FILES.settings, createSettingsDefault(), settings => {
    settings.channels = settings.channels || {};
    settings.channels.hallOfFameChannelId = String(channelId);
    settings.meta = { ...(settings.meta || {}), updatedAt: new Date().toISOString() };
    return settings;
  });
}

async function renderHallOfFameTestImage({ dayKey, firstTeamId, secondTeamId, thirdTeamId }) {
  const bannerPath = resolveBannerPath(dayKey);
  const teams = getSelectedTeams({ firstTeamId, secondTeamId, thirdTeamId });
  const positions = CEREMONY_LOGO_POSITIONS[dayKey];
  const overlays = await Promise.all([
    buildLogoOverlay(teams.first, positions.first),
    buildLogoOverlay(teams.second, positions.second),
    buildLogoOverlay(teams.third, positions.third),
  ]);

  const buffer = await sharp(bannerPath)
    .composite(overlays)
    .png()
    .toBuffer();

  return { buffer, teams, positions, bannerPath };
}

async function renderHallOfFameCeremonyImage({ dayKey, teams }) {
  const bannerPath = resolveBannerPath(dayKey);
  const positions = CEREMONY_LOGO_POSITIONS[dayKey] || createDefaultLogoPositions();
  const overlays = (await Promise.all([
    buildLogoOverlay(teams.first, positions.first, { optionalLogo: true }),
    buildLogoOverlay(teams.second, positions.second, { optionalLogo: true }),
    buildLogoOverlay(teams.third, positions.third, { optionalLogo: true }),
  ])).filter(Boolean);

  const buffer = await sharp(bannerPath)
    .composite(overlays)
    .png()
    .toBuffer();

  return { buffer, positions, bannerPath };
}

async function ensureHallOfFameChannel(guild) {
  const settings = readSettings();
  const configuredId = settings.channels?.hallOfFameChannelId || null;
  const configured = configuredId ? await guild.channels.fetch(configuredId).catch(() => null) : null;
  if (configured?.type === ChannelType.GuildText) return configured;

  const existing = guild.channels.cache.find(channel => (
    channel.name === HALL_OF_FAME_CHANNEL_NAME && channel.type === ChannelType.GuildText
  ));
  if (existing) {
    saveHallOfFameChannelId(existing.id);
    return existing;
  }

  const channel = await guild.channels.create({
    name: HALL_OF_FAME_CHANNEL_NAME,
    type: ChannelType.GuildText,
    reason: 'Loco Night Cup Hall of Fame',
  });
  saveHallOfFameChannelId(channel.id);
  return channel;
}

async function getHallOfFameTestChannel(guild) {
  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`Hall-of-Fame-Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);
  }
  return channel;
}

function getEventDayKey(eventKey, event) {
  const key = String(event?.eventKey || eventKey || '').toLowerCase();
  assertDay(key);
  return key;
}

function getTeamOrNull(teamId) {
  if (!teamId) return null;
  const team = findTeamById(teamId);
  if (!team || team.status === 'deleted') return null;
  return team;
}

function getCeremonyTeams(event) {
  const placements = event?.ceremony?.placements || event?.knockout?.placements || {};
  const teams = {
    first: getTeamOrNull(placements.firstTeamId),
    second: getTeamOrNull(placements.secondTeamId),
    third: getTeamOrNull(placements.thirdTeamId),
  };

  for (const [placement, team] of Object.entries(teams)) {
    if (!team) throw new Error(`Team für ${placement} wurde nicht gefunden.`);
  }

  return teams;
}

function isConfirmed(match) {
  return match?.status === 'confirmed';
}

function isCeremonyReady(event) {
  const finalMatch = event?.knockout?.rounds?.final?.matches?.[0];
  const thirdPlaceMatch = event?.knockout?.rounds?.third_place?.matches?.[0];
  return event?.ceremony?.status === 'ready'
    && isConfirmed(finalMatch)
    && (!thirdPlaceMatch || isConfirmed(thirdPlaceMatch));
}

function getTeamPings(team) {
  const userIds = [
    team?.manager?.userId,
    ...(Array.isArray(team?.coManagers) ? team.coManagers.map(coManager => coManager?.userId) : []),
  ].filter(Boolean).map(String);
  const uniqueUserIds = [...new Set(userIds)];
  return uniqueUserIds.length ? uniqueUserIds.map(userId => `<@${userId}>`).join('\n') : '-';
}

function buildPromotionBlock(promotion) {
  if (!promotion?.name) return [];
  return [
    '',
    '🔥 **Aufstieg freigeschaltet!**',
    `${promotion.teamName || 'Das Siegerteam'} erreicht den Rang: **${promotion.name}**`,
  ];
}

function buildCeremonyText({ dayKey, teams, promotion = null }) {
  const dayLabel = (CEREMONY_DAY_LABELS[dayKey] || dayKey).toUpperCase();
  return [
    `🏆 SIEGEREHRUNG • ${dayLabel}`,
    '',
    'Der Loco Night Cup ist beendet. Hier ist die offizielle Top 3:',
    '',
    `🥇 1. Platz: ${teams.first.clubName}`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.first),
    ...buildPromotionBlock(promotion),
    '',
    'Verdient den Titel geholt und über das gesamte Turnier hinweg überzeugt. Herzlichen Glückwunsch zum Turniersieg! 🏆',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥈 2. Platz: ${teams.second.clubName}`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.second),
    '',
    'Starke Leistungen gezeigt und völlig verdient auf dem Podium gelandet. 👏',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥉 3. Platz: ${teams.third.clubName}`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.third),
    '',
    'Ebenfalls ein starkes Turnier gespielt und sich den Platz auf dem Treppchen verdient gesichert. 👏',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '❤️ Danke an alle Teilnehmer',
    '',
    'Vielen Dank an alle Teams für die Teilnahme am heutigen Cup.',
    '',
    'Wir hoffen, ihr hattet Spass und seid auch beim nächsten Loco Night Cup wieder dabei.',
    '',
    'Bis zum nächsten Mal! 🏆🐺',
  ].join('\n');
}

function buildLocoZwergenCupCeremonyText({ teams, promotion = null }) {
  return [
    '🏆 **SIEGEREHRUNG • LOCO ZWERGEN CUP**',
    '',
    'Zum Abschluss der FC-26-Zeit wollten wir uns noch ein kleines Gimmick gönnen. Kleine Männer, große Träume und ein Cup, bei dem heute trotzdem niemand etwas verschenkt hat. 🍄🐺',
    '',
    `🥇 **1. Platz • ${teams.first.clubName}**`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.first),
    ...buildPromotionBlock(promotion),
    '',
    'Ganz oben auf dem Zwergen-Thron. Verdient den Titel geholt und damit offiziell die größten Kleinen des Abends. 🏆',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥈 **2. Platz • ${teams.second.clubName}**`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.second),
    '',
    'Bis ins Finale durchgezogen und nur ganz knapp am goldenen Zwergenpokal vorbeigeschrammt. Starke Leistung! 👏',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥉 **3. Platz • ${teams.third.clubName}**`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.third),
    '',
    'Auch auf dem Treppchen gelandet und sich den bronzenen Zwerg mehr als verdient. 💪',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '❤️ **Danke an alle Teilnehmer**',
    '',
    'Danke an alle Teams, die diesen kleinen Spaß-Cup zum Abschluss von FC 26 mit uns gespielt haben. Die Grafik war zwergig, der Ehrgeiz ganz sicher nicht.',
    '',
    'Gemeinsam immer loco. 🐺🍄',
  ].join('\n');
}

function getStoredChampionPromotion(event, teams) {
  const promotion = event?.ceremony?.teamAchievements?.championPromotion || null;
  if (!promotion?.name) return null;
  return {
    ...promotion,
    teamName: teams.first?.clubName || promotion.teamName || null,
  };
}

function getKoProgressionRenderer(firstRoundKey) {
  return {
    round_of_16: renderKoProgression16,
    quarter_final: renderKoProgression8,
    semi_final: renderKoProgression4,
  }[firstRoundKey] || null;
}

async function renderFc27KoProgression({ event, eventKey, serialNumber }) {
  const renderer = getKoProgressionRenderer(event?.knockout?.firstRoundKey);
  if (!renderer) return null;
  return renderer({
    rounds: event?.knockout?.rounds || {},
    serialNumber,
    eventId: event?.cycle?.cycleKey || eventKey,
    version: Date.now(),
  });
}

function updateCeremonyMessageRefs(eventKey, {
  event, channelId, imageMessageId, textMessageId, progressionMessageId = null, timestamp,
}) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    messages.ceremony = messages.ceremony || {};
    messages.ceremony[eventKey] = messages.ceremony[eventKey] || {
      cycleKey: null,
      channelId: null,
      imageMessageId: null,
      textMessageId: null,
      testMessageIds: [],
      postedAt: null,
      updatedAt: null,
    };
    messages.ceremony[eventKey].cycleKey = event?.cycle?.cycleKey || null;
    messages.ceremony[eventKey].channelId = channelId;
    messages.ceremony[eventKey].imageMessageId = imageMessageId;
    messages.ceremony[eventKey].textMessageId = textMessageId;
    messages.ceremony[eventKey].progressionMessageId = progressionMessageId;
    messages.ceremony[eventKey].postedAt = timestamp;
    messages.ceremony[eventKey].updatedAt = timestamp;
    messages.liveSchedule = messages.liveSchedule || {};
    messages.liveSchedule.phase = 'ceremony';
    messages.liveSchedule.currentEventKey = eventKey;
    messages.liveSchedule.updatedAt = timestamp;
    return messages;
  });
}

async function postHallOfFameCeremony({ guild, eventKey }) {
  if (!guild) throw new Error('Siegerehrung ist nur auf dem Server nutzbar.');
  const event = readEventData(eventKey);
  if (event?.ceremony?.status === 'posted') {
    throw new Error('Siegerehrung wurde bereits gepostet.');
  }
  if (!isCeremonyReady(event)) {
    throw new Error('Siegerehrung ist noch nicht bereit. Finale und Spiel um Platz 3 müssen bestätigt sein.');
  }

  const dayKey = getEventDayKey(eventKey, event);
  const teams = getCeremonyTeams(event);
  const stats = applyTeamStatsForEvent(eventKey);
  if (stats.applied) {
    console.log(`[team-stats] ${eventKey}: ${stats.appliedTeams.length} Teams final aktualisiert.`);
  }
  const achievements = applyTeamAchievementsForEvent(eventKey);
  const eventWithAchievements = readEventData(eventKey);
  const promotion = getStoredChampionPromotion(eventWithAchievements, teams);
  const graphicsVariant = getGraphicsVariant(readSettings());
  const locoZwergenCup = isLocoZwergenCupEvent(event);
  const ceremonyRender = locoZwergenCup
    ? await renderLocoZwergenCupCeremonyImage({ teams })
    : graphicsVariant === 'fc27'
    ? await renderFc27CeremonyImage({ dayKey, teams })
    : await renderHallOfFameCeremonyImage({ dayKey, teams });
  const progressionRenderer = graphicsVariant === 'fc27' && !locoZwergenCup
    ? getKoProgressionRenderer(event?.knockout?.firstRoundKey)
    : null;
  const progressionSerialNumber = progressionRenderer
    ? reserveSerial(eventKey, event?.cycle?.cycleKey || event?.cycle?.eventDate || null)
    : null;
  const progressionRender = progressionSerialNumber === null
    ? null
    : await renderFc27KoProgression({ event, eventKey, serialNumber: progressionSerialNumber });
  const { buffer } = ceremonyRender;
  const channel = await ensureHallOfFameChannel(guild);
  const timestamp = new Date().toISOString();
  const attachment = new AttachmentBuilder(buffer, {
    name: `hall-of-fame-${dayKey}-${Date.now()}.png`,
  });

  const imageMessage = await channel.send({
    content: '@everyone',
    files: [attachment],
    allowedMentions: { parse: ['everyone'] },
  });
  const textMessage = await channel.send({
    content: locoZwergenCup
      ? buildLocoZwergenCupCeremonyText({ teams, promotion })
      : buildCeremonyText({ dayKey, teams, promotion }),
    allowedMentions: { parse: ['users'] },
  });
  const progressionMessage = progressionRender
    ? await channel.send({
      files: [new AttachmentBuilder(progressionRender.buffer, { name: progressionRender.fileName })],
      allowedMentions: { parse: [] },
    })
    : null;

  let updatedEvent;
  updateEventData(eventKey, storedEvent => {
    if (storedEvent.ceremony?.status === 'posted') throw new Error('Siegerehrung wurde bereits gepostet.');
    storedEvent.ceremony = storedEvent.ceremony || {};
    storedEvent.ceremony.status = 'posted';
    storedEvent.ceremony.postedAt = timestamp;
    storedEvent.ceremony.channelId = channel.id;
    storedEvent.ceremony.imageMessageId = imageMessage.id;
    storedEvent.ceremony.textMessageId = textMessage.id;
    storedEvent.ceremony.progressionMessageId = progressionMessage?.id || null;
    storedEvent.ceremony.progressionSerialNumber = progressionSerialNumber;
    storedEvent.ceremony.postedMessageIds = [imageMessage.id, textMessage.id, progressionMessage?.id].filter(Boolean);
    storedEvent.ceremony.cleanupStatus = 'scheduled';
    storedEvent.ceremony.cleanupScheduledAt = getAutoCleanupScheduledAt(timestamp);
    storedEvent.ceremony.cleanupCompletedAt = null;
    storedEvent.meta = { ...(storedEvent.meta || {}), updatedAt: timestamp };
    updatedEvent = storedEvent;
    return storedEvent;
  });
  updateCeremonyMessageRefs(eventKey, {
    event: updatedEvent,
    channelId: channel.id,
    imageMessageId: imageMessage.id,
    textMessageId: textMessage.id,
    progressionMessageId: progressionMessage?.id || null,
    timestamp,
  });
  if (achievements.applied) {
    await refreshTeamAchievementsRankingMessage({ client: guild.client, guild, force: true }).catch(error => {
      console.warn(`[team-achievements] Ranking konnte nicht aktualisiert werden: ${error.message}`);
    });
    await syncChampionRolesForTeam(guild, achievements.placementTeamIds.gold).catch(error => {
      console.warn(`[champion-roles] Gewinnerteam konnte nicht synchronisiert werden: ${error.message}`);
    });
  }
  scheduleAutoCleanupForEvent({
    eventKey,
    guild,
    scheduledAt: updatedEvent.ceremony.cleanupScheduledAt,
    client: guild.client,
  });

  return {
    channelId: channel.id,
    imageMessageId: imageMessage.id,
    textMessageId: textMessage.id,
    progressionMessageId: progressionMessage?.id || null,
    teams,
    dayKey,
    dayLabel: CEREMONY_DAY_LABELS[dayKey],
  };
}

async function maybePostHallOfFameCeremony({ guild, eventKey }) {
  if (!guild) return { posted: false, reason: 'missing_guild' };
  const event = readEventData(eventKey);
  if (event?.ceremony?.status === 'posted') return { posted: false, reason: 'already_posted' };
  if (!isCeremonyReady(event)) return { posted: false, reason: 'not_ready' };
  const result = await postHallOfFameCeremony({ guild, eventKey });
  return { posted: true, result };
}

async function postHallOfFameTest({ guild, dayKey, firstTeamId, secondTeamId, thirdTeamId }) {
  if (!guild) throw new Error('Hall-of-Fame-Test ist nur auf dem Server nutzbar.');
  const { buffer, teams } = await renderHallOfFameTestImage({ dayKey, firstTeamId, secondTeamId, thirdTeamId });
  const channel = await getHallOfFameTestChannel(guild);
  const fileName = `hall-of-fame-test-${dayKey}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(buffer, { name: fileName });

  const imageMessage = await channel.send({
    content: '@everyone',
    files: [attachment],
    allowedMentions: { parse: ['everyone'] },
  });
  const textMessage = await channel.send({
    content: buildCeremonyText({ dayKey, teams }),
    allowedMentions: { parse: ['users'] },
  });

  return {
    channelId: channel.id,
    imageMessageId: imageMessage.id,
    textMessageId: textMessage.id,
    dayKey,
    dayLabel: CEREMONY_DAY_LABELS[dayKey],
    teams,
  };
}

module.exports = {
  buildLocoZwergenCupCeremonyText,
  CEREMONY_BANNERS,
  CEREMONY_DAY_LABELS,
  CEREMONY_LOGO_POSITIONS,
  HALL_OF_FAME_CHANNEL_NAME,
  HALL_OF_FAME_TEST_CHANNEL_ID,
  CEREMONY_LOGO_SCALE,
  CEREMONY_LOGO_Y_OFFSET,
  buildCeremonyText,
  getKoProgressionRenderer,
  isCeremonyReady,
  maybePostHallOfFameCeremony,
  postHallOfFameCeremony,
  postHallOfFameTest,
  renderHallOfFameCeremonyImage,
  renderHallOfFameTestImage,
  renderFc27KoProgression,
};
