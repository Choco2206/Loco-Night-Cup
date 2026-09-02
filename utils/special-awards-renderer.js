'use strict';

const fs = require('fs');
const path = require('path');
const DEFAULT_LAYOUT = require('../config/special-awards-layout');
const BOMBER_X_LOCO_LAYOUT = require('../config/bomber-x-loco-special-awards-layout');
const { ROOT_DIR } = require('../src/storage');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');

let canvasApi;
const templatePromises = new Map();

function getCanvas() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function fittedFont(ctx, text, maxWidth, maxSize, minSize = 12) {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `700 ${size}px Oxanium`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

function drawCenteredText(ctx, text, box, maxSize, minSize = 12, textColor = '#f3c66d') {
  const value = String(text || '—');
  fittedFont(ctx, value, box.width - 14, maxSize, minSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = textColor;
  ctx.strokeStyle = 'rgba(15, 3, 3, 0.95)';
  ctx.lineWidth = Math.max(2, maxSize * 0.09);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  ctx.strokeText(value, x, y, box.width - 10);
  ctx.fillText(value, x, y, box.width - 10);
}

function polygonBounds(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function clipPolygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.clip();
}

async function drawTeamLogo(ctx, player, polygon, textColor) {
  const team = player ? findTeamById(player.teamId) : null;
  const logoPath = resolveTeamLogoPath(team);
  const bounds = polygonBounds(polygon);
  ctx.save();
  clipPolygon(ctx, polygon);
  if (logoPath && fs.existsSync(logoPath)) {
    const image = await getCanvas().loadImage(logoPath);
    const scale = Math.min((bounds.width * 0.92) / image.width, (bounds.height * 0.92) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, bounds.x + (bounds.width - width) / 2, bounds.y + (bounds.height - height) / 2, width, height);
  } else if (player) {
    const initials = String(team?.clubName || 'LNC').split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase();
    drawCenteredText(ctx, initials, bounds, 30, 18, textColor);
  }
  ctx.restore();
}

function awardValue(player, field) {
  if (!player) return '—';
  if (field === 'averageRating') return Number(player.averageRating).toFixed(2).replace('.', ',');
  return String(Number(player[field]) || 0);
}

async function loadTemplate(layout) {
  if (!templatePromises.has(layout.template)) {
    templatePromises.set(layout.template, getCanvas().loadImage(path.resolve(ROOT_DIR, layout.template)));
  }
  return templatePromises.get(layout.template);
}

async function renderSpecialAwards({ awards, serialNumber, variant = 'default' }) {
  const layout = variant === 'bomber_x_loco' ? BOMBER_X_LOCO_LAYOUT : DEFAULT_LAYOUT;
  const template = await loadTemplate(layout);
  const canvas = getCanvas().createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, template.width, template.height);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;

  for (const slot of layout.awards) {
    const player = awards?.[slot.key] || null;
    await drawTeamLogo(ctx, player, slot.logo, layout.textColor);
    drawCenteredText(ctx, player?.playerName || 'Nicht vergeben', slot.name, 24, 12, layout.textColor);
    drawCenteredText(ctx, player ? `${awardValue(player, slot.key)} ${slot.suffix}` : '—', slot.stat, 19, 11, layout.textColor);
  }

  if (layout.serial) drawCenteredText(ctx, `#${serialNumber}`, layout.serial, layout.serial.maxFontSize, 24, layout.textColor);
  const prefix = variant === 'bomber_x_loco' ? 'bomber-x-loco-special-awards' : 'special-awards';
  return { buffer: canvas.toBuffer('image/png'), fileName: `${prefix}${layout.serial ? `-${serialNumber}` : ''}.png` };
}

module.exports = { awardValue, renderSpecialAwards };
