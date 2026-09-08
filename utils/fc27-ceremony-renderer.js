'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const layout = require('../config/fc27-ceremony-layout');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../src/storage');

function resolveFc27TeamLogoPath(team) {
  if (!team?.logo?.fileName) return null;
  const fileName = path.basename(team.logo.fileName);
  return [
    team.logo.path && !String(team.logo.path).includes('://')
      ? path.resolve(ROOT_DIR, team.logo.path)
      : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean).find(candidate => fs.existsSync(candidate)) || null;
}

function dayLayout(dayKey) {
  const selected = layout.days[dayKey];
  if (!selected) throw new Error(`FC-27-Siegerehrung kennt den Wochentag ${dayKey} nicht.`);
  return selected;
}

async function buildOverlay(team, slot, scaleX, scaleY) {
  const source = resolveFc27TeamLogoPath(team);
  if (!source) return null;
  const width = Math.max(1, Math.round(slot.width * scaleX));
  const height = Math.max(1, Math.round(slot.height * scaleY));
  const buffer = await sharp(source).resize(width, height, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    withoutEnlargement: false,
  }).png().toBuffer();

  return {
    input: buffer,
    left: Math.round(slot.centerX * scaleX - width / 2),
    top: Math.round(slot.centerY * scaleY - height / 2),
  };
}

async function renderFc27CeremonyImage({ dayKey, teams }) {
  const selected = dayLayout(dayKey);
  const template = path.resolve(ROOT_DIR, selected.template);
  if (!fs.existsSync(template)) throw new Error(`FC-27-Siegerehrungsbild fehlt: ${selected.template}`);
  const metadata = await sharp(template).metadata();
  const width = Number(metadata.width || layout.reference.width);
  const height = Number(metadata.height || layout.reference.height);
  const scaleX = width / layout.reference.width;
  const scaleY = height / layout.reference.height;
  const overlays = (await Promise.all([
    buildOverlay(teams.first, selected.placements.first, scaleX, scaleY),
    buildOverlay(teams.second, selected.placements.second, scaleX, scaleY),
    buildOverlay(teams.third, selected.placements.third, scaleX, scaleY),
  ])).filter(Boolean);

  return {
    buffer: await sharp(template).composite(overlays).png().toBuffer(),
    width,
    height,
    slots: selected.placements,
    template,
  };
}

module.exports = { dayLayout, renderFc27CeremonyImage, resolveFc27TeamLogoPath };
