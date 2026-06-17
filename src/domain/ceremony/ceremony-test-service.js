'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AttachmentBuilder, ChannelType } = require('discord.js');
const { FILES, ROOT_DIR, TEAM_LOGOS_DIR, updateJson } = require('../../storage');
const { createMessagesDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById } = require('../teams/team-service');

const HALL_OF_FAME_CHANNEL_ID = '1516915002957758616';
const HALL_OF_FAME_CHANNEL_NAME = '👑-hall-of-fame';
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
    first: { x: 716, y: 773, width: 240, height: 92 },
    second: { x: 266, y: 792, width: 214, height: 66 },
    third: { ...DEFAULT_LOGO_POSITIONS.third },
  },
  tuesday: {
    first: { x: 728, y: 798, width: 216, height: 82 },
    second: { x: 306, y: 812, width: 214, height: 66 },
    third: { x: 1148, y: 812, width: 214, height: 66 },
  },
  wednesday: {
    first: { x: 703, y: 824, width: 216, height: 82 },
    second: { x: 256, y: 836, width: 214, height: 66 },
    third: { x: 1128, y: 836, width: 214, height: 66 },
  },
  thursday: {
    first: { x: 728, y: 790, width: 216, height: 82 },
    second: { x: 326, y: 806, width: 214, height: 66 },
    third: { x: 1128, y: 806, width: 214, height: 66 },
  },
  friday: {
    first: { x: 718, y: 810, width: 216, height: 82 },
    second: { x: 306, y: 814, width: 214, height: 66 },
    third: { x: 1148, y: 814, width: 214, height: 66 },
  },
  saturday: {
    first: { x: 728, y: 810, width: 216, height: 82 },
    second: { x: 286, y: 824, width: 214, height: 66 },
    third: { x: 1158, y: 824, width: 214, height: 66 },
  },
  sunday: {
    first: { x: 728, y: 836, width: 216, height: 82 },
    second: { x: 336, y: 840, width: 214, height: 66 },
    third: { x: 1118, y: 840, width: 214, height: 66 },
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
  if (!logoPath) throw new Error(`Logo-Datei fuer ${team.clubName} nicht gefunden: ${fileName}`);
  return logoPath;
}

async function buildLogoOverlay(team, slot, { optionalLogo = false } = {}) {
  const logoPath = resolveTeamLogoPath(team, { optional: optionalLogo });
  if (!logoPath) return null;
  const resized = await sharp(logoPath)
    .resize(slot.width, slot.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();

  return {
    input: resized,
    left: Math.round(slot.x + (slot.width - metadata.width) / 2),
    top: Math.round(slot.y + (slot.height - metadata.height) / 2),
  };
}

function getSelectedTeams({ firstTeamId, secondTeamId, thirdTeamId }) {
  const teams = {
    first: findTeamById(firstTeamId),
    second: findTeamById(secondTeamId),
    third: findTeamById(thirdTeamId),
  };

  for (const [placement, team] of Object.entries(teams)) {
    if (!team || team.status === 'deleted') throw new Error(`Team fuer ${placement} wurde nicht gefunden.`);
  }

  return teams;
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
  const configured = await guild.channels.fetch(HALL_OF_FAME_CHANNEL_ID).catch(() => null);
  if (configured?.type === ChannelType.GuildText) return configured;

  const existing = guild.channels.cache.find(channel => (
    channel.name === HALL_OF_FAME_CHANNEL_NAME && channel.type === ChannelType.GuildText
  ));
  if (existing) return existing;

  return guild.channels.create({
    name: HALL_OF_FAME_CHANNEL_NAME,
    type: ChannelType.GuildText,
    reason: 'Loco Night Cup Hall of Fame',
  });
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
    if (!team) throw new Error(`Team fuer ${placement} wurde nicht gefunden.`);
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

function buildCeremonyText({ dayKey, teams }) {
  const dayLabel = (CEREMONY_DAY_LABELS[dayKey] || dayKey).toUpperCase();
  return [
    `🏆 SIEGEREHRUNG • ${dayLabel}`,
    '',
    'Der Loco Night Cup ist beendet. Hier ist die offizielle Top 3:',
    '',
    `🥇 1. Platz: ${teams.first.clubName}`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.first),
    '',
    'Verdient den Titel geholt und ueber das gesamte Turnier hinweg ueberzeugt. Herzlichen Glueckwunsch zum Turniersieg! 🏆',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥈 2. Platz: ${teams.second.clubName}`,
    '👑 Manager / Co-Manager:',
    getTeamPings(teams.second),
    '',
    'Starke Leistungen gezeigt und voellig verdient auf dem Podium gelandet. 👏',
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
    'Vielen Dank an alle Teams fuer die Teilnahme am heutigen Cup.',
    '',
    'Wir hoffen, ihr hattet Spass und seid auch beim naechsten Loco Night Cup wieder dabei.',
    '',
    'Bis zum naechsten Mal! 🏆🐺',
  ].join('\n');
}

function updateCeremonyMessageRefs(eventKey, { event, channelId, imageMessageId, textMessageId, timestamp }) {
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
    throw new Error('Siegerehrung ist noch nicht bereit. Finale und Spiel um Platz 3 muessen bestaetigt sein.');
  }

  const dayKey = getEventDayKey(eventKey, event);
  const teams = getCeremonyTeams(event);
  const { buffer } = await renderHallOfFameCeremonyImage({ dayKey, teams });
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
    content: buildCeremonyText({ dayKey, teams }),
    allowedMentions: { parse: ['users'] },
  });

  let updatedEvent;
  updateEventData(eventKey, storedEvent => {
    if (storedEvent.ceremony?.status === 'posted') throw new Error('Siegerehrung wurde bereits gepostet.');
    storedEvent.ceremony = storedEvent.ceremony || {};
    storedEvent.ceremony.status = 'posted';
    storedEvent.ceremony.postedAt = timestamp;
    storedEvent.ceremony.channelId = channel.id;
    storedEvent.ceremony.imageMessageId = imageMessage.id;
    storedEvent.ceremony.textMessageId = textMessage.id;
    storedEvent.ceremony.postedMessageIds = [imageMessage.id, textMessage.id];
    storedEvent.meta = { ...(storedEvent.meta || {}), updatedAt: timestamp };
    updatedEvent = storedEvent;
    return storedEvent;
  });
  updateCeremonyMessageRefs(eventKey, {
    event: updatedEvent,
    channelId: channel.id,
    imageMessageId: imageMessage.id,
    textMessageId: textMessage.id,
    timestamp,
  });

  return {
    channelId: channel.id,
    imageMessageId: imageMessage.id,
    textMessageId: textMessage.id,
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
  const channel = await ensureHallOfFameChannel(guild);
  const fileName = `hall-of-fame-test-${dayKey}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(buffer, { name: fileName });

  await channel.send({
    content: [
      'Hall of Fame Test',
      '',
      `🥇 ${teams.first.clubName}`,
      `🥈 ${teams.second.clubName}`,
      `🥉 ${teams.third.clubName}`,
    ].join('\n'),
    files: [attachment],
    allowedMentions: { parse: [] },
  });

  return {
    channelId: channel.id,
    dayKey,
    dayLabel: CEREMONY_DAY_LABELS[dayKey],
    teams,
  };
}

module.exports = {
  CEREMONY_BANNERS,
  CEREMONY_DAY_LABELS,
  CEREMONY_LOGO_POSITIONS,
  HALL_OF_FAME_CHANNEL_NAME,
  buildCeremonyText,
  isCeremonyReady,
  maybePostHallOfFameCeremony,
  postHallOfFameCeremony,
  postHallOfFameTest,
  renderHallOfFameCeremonyImage,
  renderHallOfFameTestImage,
};