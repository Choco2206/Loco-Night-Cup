'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AttachmentBuilder, ChannelType } = require('discord.js');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../../storage');
const { findTeamById } = require('../teams/team-service');

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

function resolveTeamLogoPath(team) {
  if (!team?.logo?.fileName) throw new Error(`Team ${team?.clubName || team?.id || '-'} hat kein Logo.`);
  const fileName = path.basename(team.logo.fileName);
  const candidates = [
    team.logo.path && !String(team.logo.path).includes('://')
      ? path.resolve(ROOT_DIR, team.logo.path)
      : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean);

  const logoPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!logoPath) throw new Error(`Logo-Datei fuer ${team.clubName} nicht gefunden: ${fileName}`);
  return logoPath;
}

async function buildLogoOverlay(team, slot) {
  const logoPath = resolveTeamLogoPath(team);
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

async function ensureHallOfFameChannel(guild) {
  const existing = guild.channels.cache.find(channel => (
    channel.name === HALL_OF_FAME_CHANNEL_NAME && channel.type === ChannelType.GuildText
  ));
  if (existing) return existing;

  return guild.channels.create({
    name: HALL_OF_FAME_CHANNEL_NAME,
    type: ChannelType.GuildText,
    reason: 'Loco Night Cup Hall of Fame Koordinaten-Test',
  });
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
  postHallOfFameTest,
  renderHallOfFameTestImage,
};
