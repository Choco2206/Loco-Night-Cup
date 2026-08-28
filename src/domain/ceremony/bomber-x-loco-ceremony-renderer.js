'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../../storage');
const layout = require('../../../config/bomber-x-loco-ceremony-layout');

function resolveTeamLogoPath(team) {
  if (!team?.logo?.fileName) return null;
  const fileName = path.basename(team.logo.fileName);
  const candidates = [
    team.logo.path && !String(team.logo.path).includes('://')
      ? path.resolve(ROOT_DIR, team.logo.path)
      : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

async function buildLogoOverlay(team, slot) {
  const logoPath = resolveTeamLogoPath(team);
  if (!logoPath) return null;

  const buffer = await sharp(logoPath)
    .resize(slot.width, slot.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  return {
    input: buffer,
    left: slot.left,
    top: slot.top,
  };
}

async function renderBomberXLocoCeremonyImage({ teams }) {
  const templatePath = path.resolve(ROOT_DIR, layout.template);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Bomber X Loco Siegerehrungsbild nicht gefunden: ${templatePath}`);
  }

  const positions = layout.placements;
  const overlays = (await Promise.all([
    buildLogoOverlay(teams.first, positions.first),
    buildLogoOverlay(teams.second, positions.second),
    buildLogoOverlay(teams.third, positions.third),
  ])).filter(Boolean);

  const buffer = await sharp(templatePath)
    .resize(layout.reference.width, layout.reference.height)
    .composite(overlays)
    .png()
    .toBuffer();

  return {
    buffer,
    positions,
    bannerPath: templatePath,
  };
}

module.exports = {
  renderBomberXLocoCeremonyImage,
};
