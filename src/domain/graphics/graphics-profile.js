'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { FILES, ROOT_DIR, readJson, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');

const GRAPHICS_PROFILES = Object.freeze({
  default: Object.freeze({
    key: 'default',
    label: 'Bisherige Grafiken',
    variant: 'default',
    checkinBannerPath: null,
    requiredAssets: Object.freeze([
      ['config/assets/check-in.png', 1983, 793],
      ['assets/tables/live-table.png', 1672, 941],
      ['assets/templates/group-schedule.png', 1024, 1536],
      ['assets/ko-phase/ko-phase-4.png', 1536, 1024],
      ['assets/ko-phase/ko-phase-8.png', 1536, 1024],
      ['assets/ko-phase/ko-phase-16.png', 1536, 1024],
      ['assets/ko-phase/achtelfinale.png', 1024, 1535],
      ['assets/ko-phase/viertelfinale.png', 1024, 1535],
      ['assets/ko-phase/halbfinale.png', 1086, 1448],
      ['assets/ko-phase/platz-3.png', 1086, 1448],
      ['assets/ko-phase/finale.png', 1086, 1448],
      ['assets/team-of-the-tournament/team-of-the-tournament.png', 1024, 1536],
      ['assets/special-awards/special-awards.jpg', 1536, 1024],
      ['assets/power-ranking/power-ranking-champion.png', 1254, 1254],
      ['assets/ceremony/montag-banner.png', 1672, 941],
      ['assets/ceremony/dienstag-banner.png', 1672, 941],
      ['assets/ceremony/mittwoch-banner.png', 1672, 941],
      ['assets/ceremony/donnerstag-banner.png', 1672, 941],
      ['assets/ceremony/freitag-banner.png', 1672, 940],
      ['assets/ceremony/samstag-banner.png', 1672, 941],
      ['assets/ceremony/sonntag-banner.png', 1672, 940],
    ]),
  }),
  fc27: Object.freeze({
    key: 'fc27',
    label: 'FC 27',
    variant: 'fc27',
    checkinBannerPath: 'assets/banners/check-in-fc27.jpeg',
    requiredAssets: Object.freeze([
      ['assets/banners/check-in-fc27.jpeg', 1536, 640],
      ['assets/tables/live-table-fc27.jpeg', 1672, 941],
      ['assets/templates/group-schedule-fc27.jpeg', 1024, 1536],
      ['assets/ko-phase/ko-phase-4-fc27.jpeg', 1536, 1024],
      ['assets/ko-phase/ko-phase-8-fc27.jpeg', 1536, 1024],
      ['assets/ko-phase/ko-phase-16-fc27.jpeg', 1536, 1024],
      ['assets/ko-phase/achtelfinale-fc27.jpeg', 1024, 1536],
      ['assets/ko-phase/viertelfinale-fc27.jpeg', 1024, 1536],
      ['assets/ko-phase/halbfinale-fc27.jpeg', 1024, 1536],
      ['assets/ko-phase/platz-3-fc27.jpeg', 1024, 1536],
      ['assets/ko-phase/finale-fc27.jpeg', 1024, 1536],
      ['assets/ko-phase/ko-verlauf-16-fc27.jpeg', 1792, 1344],
      ['assets/team-of-the-tournament/team-of-the-tournament-fc27.jpeg', 1024, 1536],
      ['assets/special-awards/special-awards-fc27.jpeg', 1536, 1024],
      ['assets/power-ranking/power-ranking-champion-fc27.jpeg', 1254, 1254],
      ['assets/ceremony/monday-fc27.jpeg', 1536, 864],
      ['assets/ceremony/tuesday-fc27.jpeg', 1536, 864],
      ['assets/ceremony/wednesday-fc27.jpeg', 1536, 864],
      ['assets/ceremony/thursday-fc27.jpeg', 1536, 864],
      ['assets/ceremony/friday-fc27.jpeg', 1536, 864],
      ['assets/ceremony/saturday-fc27.jpeg', 1536, 864],
      ['assets/ceremony/sunday-fc27.jpeg', 1536, 864],
    ]),
  }),
});

function normalizeGraphicsProfileKey(value) {
  return Object.prototype.hasOwnProperty.call(GRAPHICS_PROFILES, value) ? value : 'default';
}

function getGraphicsProfile(settings) {
  return GRAPHICS_PROFILES[normalizeGraphicsProfileKey(settings?.graphics?.activeProfile)];
}

function readGraphicsProfile() {
  return getGraphicsProfile(readJson(FILES.settings, createSettingsDefault()));
}

function getGraphicsVariant(settings = null) {
  return (settings ? getGraphicsProfile(settings) : readGraphicsProfile()).variant;
}

function listGraphicsProfiles() {
  return Object.values(GRAPHICS_PROFILES);
}

async function validateGraphicsProfileAssets(profileKey) {
  const key = normalizeGraphicsProfileKey(profileKey);
  if (key !== profileKey) throw new Error(`Unbekanntes Grafikprofil: ${profileKey}`);
  const profile = GRAPHICS_PROFILES[key];
  const problems = [];

  for (const [relativePath, expectedWidth, expectedHeight] of profile.requiredAssets) {
    const absolutePath = path.resolve(ROOT_DIR, relativePath);
    if (!fs.existsSync(absolutePath)) {
      problems.push(`${relativePath} fehlt`);
      continue;
    }
    try {
      const metadata = await sharp(absolutePath).metadata();
      if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
        problems.push(`${relativePath} hat ${metadata.width}x${metadata.height} statt ${expectedWidth}x${expectedHeight}`);
        continue;
      }
      await sharp(absolutePath, { failOn: 'warning' }).raw().toBuffer();
    } catch (error) {
      problems.push(`${relativePath} ist nicht lesbar (${error.message})`);
    }
  }

  if (problems.length) {
    throw new Error(`Grafikprofil ${profile.label} ist nicht vollständig:\n${problems.join('\n')}`);
  }
  return { profile, checkedAssets: profile.requiredAssets.length };
}

async function activateGraphicsProfile(profileKey, activatedBy = null) {
  const validation = await validateGraphicsProfileAssets(profileKey);
  const timestamp = new Date().toISOString();
  updateJson(FILES.settings, createSettingsDefault(), settings => {
    settings.graphics = {
      ...(settings.graphics || {}),
      activeProfile: validation.profile.key,
      activatedAt: timestamp,
      activatedBy: activatedBy ? String(activatedBy) : null,
    };
    settings.meta = { ...(settings.meta || {}), updatedAt: timestamp };
    return settings;
  });
  return validation;
}

module.exports = {
  GRAPHICS_PROFILES,
  activateGraphicsProfile,
  getGraphicsProfile,
  getGraphicsVariant,
  listGraphicsProfiles,
  normalizeGraphicsProfileKey,
  readGraphicsProfile,
  validateGraphicsProfileAssets,
};
