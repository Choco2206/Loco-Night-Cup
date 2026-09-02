'use strict';

const fs = require('fs');
const path = require('path');
const LAYOUT = require('../config/special-awards-layout');
const { ROOT_DIR } = require('../src/storage');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');

let canvasApi;
let templatePromise;

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

function drawCenteredText(ctx, text, box, maxSize, minSize = 12) {
  const value = String(text || '—');
  fittedFont(ctx, value, box.width - 14, maxSize, minSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = LAYOUT.textColor;
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

async function drawTeamLogo(ctx, player, polygon) {
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
    drawCenteredText(ctx, initials, bounds, 30, 18);
  }
  ctx.restore();
}

function awardValue(player, field) {
  if (!player) return '—';
  if (field === 'averageRating') return Number(player.averageRating).toFixed(2).replace('.', ',');
  return String(Number(player[field]) || 0);
}

async function loadTemplate() {
  if (!templatePromise) templatePromise = getCanvas().loadImage(path.resolve(ROOT_DIR, LAYOUT.template));
  return templatePromise;
}

async function renderSpecialAwards({ awards, serialNumber }) {
  const template = await loadTemplate();
  const canvas = getCanvas().createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, template.width, template.height);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;

  for (const slot of LAYOUT.awards) {
    const player = awards?.[slot.key] || null;
    await drawTeamLogo(ctx, player, slot.logo);
    drawCenteredText(ctx, player?.playerName || 'Nicht vergeben', slot.name, 24, 12);
    drawCenteredText(ctx, player ? `${awardValue(player, slot.key)} ${slot.suffix}` : '—', slot.stat, 19, 11);
  }

  drawCenteredText(ctx, `#${serialNumber}`, LAYOUT.serial, LAYOUT.serial.maxFontSize, 24);
  return { buffer: canvas.toBuffer('image/png'), fileName: `special-awards-${serialNumber}.png` };
}

module.exports = { awardValue, renderSpecialAwards };
