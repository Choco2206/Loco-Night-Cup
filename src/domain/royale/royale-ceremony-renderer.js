'use strict';

const path = require('path');
const sharp = require('sharp');
const { ROOT_DIR } = require('../../storage');
const { resolveTeamLogoPath } = require('../teams/team-logos');

const TEMPLATE_PATH = path.join(ROOT_DIR, 'assets', 'knockout-royale', 'royale-ceremony.png');
const REFERENCE = Object.freeze({ width: 1123, height: 1404 });
const LOGO_BOX = Object.freeze({ centerX: 562, centerY: 792, width: 500, height: 430 });
const NUMBER_BOX = Object.freeze({ x: 852, y: 68, width: 205, height: 82 });

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[character]));
}

function scaledBox(box, scaleX, scaleY) {
  return {
    left: Math.round((box.centerX - box.width / 2) * scaleX),
    top: Math.round((box.centerY - box.height / 2) * scaleY),
    width: Math.round(box.width * scaleX),
    height: Math.round(box.height * scaleY),
  };
}

function fallbackLogoSvg(team, width, height) {
  const initials = String(team?.clubName || 'LKR').split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0]).join('').toUpperCase();
  const fontSize = Math.round(Math.min(width * 0.42, height * 0.42));
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="glow"><feGaussianBlur stdDeviation="9" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#e9ddff" stroke="#541a85" stroke-width="5" filter="url(#glow)">${escapeXml(initials)}</text>
  </svg>`);
}

function winnerNumberSvg(winnerNumber, width, height) {
  const text = `#${winnerNumber}`;
  const fontSize = Math.round(Math.min(height * 0.68, width / Math.max(2.2, text.length * 0.62)));
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#f3e8ff" stroke="#3b145f" stroke-width="2" paint-order="stroke" filter="url(#glow)">${escapeXml(text)}</text>
  </svg>`);
}

async function renderRoyaleCeremony({ team, winnerNumber }) {
  const metadata = await sharp(TEMPLATE_PATH).metadata();
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const scaleX = width / REFERENCE.width;
  const scaleY = height / REFERENCE.height;
  const logoBox = scaledBox(LOGO_BOX, scaleX, scaleY);
  const numberBox = {
    left: Math.round(NUMBER_BOX.x * scaleX),
    top: Math.round(NUMBER_BOX.y * scaleY),
    width: Math.round(NUMBER_BOX.width * scaleX),
    height: Math.round(NUMBER_BOX.height * scaleY),
  };

  const logoPath = resolveTeamLogoPath(team, { optional: true });
  const logo = logoPath
    ? await sharp(logoPath).resize(logoBox.width, logoBox.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    : fallbackLogoSvg(team, logoBox.width, logoBox.height);

  const buffer = await sharp(TEMPLATE_PATH)
    .composite([
      { input: logo, left: logoBox.left, top: logoBox.top },
      { input: winnerNumberSvg(winnerNumber, numberBox.width, numberBox.height), left: numberBox.left, top: numberBox.top },
    ])
    .png()
    .toBuffer();

  return {
    buffer,
    fileName: `loco-knockout-royale-sieger-${winnerNumber}.png`,
    width,
    height,
  };
}

module.exports = {
  LOGO_BOX,
  NUMBER_BOX,
  REFERENCE,
  renderRoyaleCeremony,
};
