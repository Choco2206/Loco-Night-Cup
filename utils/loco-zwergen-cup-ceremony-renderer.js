'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const layout = require('../config/loco-zwergen-cup-ceremony-layout');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../src/storage');

function resolveLogo(team) {
  if (!team?.logo?.fileName) return null;
  const fileName = path.basename(team.logo.fileName);
  return [
    team.logo.path && !String(team.logo.path).includes('://') ? path.resolve(ROOT_DIR, team.logo.path) : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean).find(candidate => fs.existsSync(candidate)) || null;
}

async function overlay(team, slot, scaleX, scaleY) {
  const source = resolveLogo(team);
  if (!source) return null;
  const width = Math.round(slot.width * scaleX);
  const height = Math.round(slot.height * scaleY);
  const buffer = await sharp(source).resize(width, height, {
    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true,
  }).png().toBuffer();
  const metadata = await sharp(buffer).metadata();
  return { input: buffer, left: Math.round(slot.centerX * scaleX - metadata.width / 2), top: Math.round(slot.centerY * scaleY - metadata.height / 2) };
}

async function renderLocoZwergenCupCeremonyImage({ teams }) {
  const template = path.resolve(ROOT_DIR, layout.template);
  const metadata = await sharp(template).metadata();
  const width = Number(metadata.width || layout.reference.width);
  const height = Number(metadata.height || layout.reference.height);
  const scaleX = width / layout.reference.width;
  const scaleY = height / layout.reference.height;
  const overlays = (await Promise.all([
    overlay(teams.first, layout.placements.first, scaleX, scaleY),
    overlay(teams.second, layout.placements.second, scaleX, scaleY),
    overlay(teams.third, layout.placements.third, scaleX, scaleY),
  ])).filter(Boolean);
  return { buffer: await sharp(template).composite(overlays).png().toBuffer(), width, height, slots: layout.placements };
}

module.exports = { renderLocoZwergenCupCeremonyImage };
