'use strict';

const fs = require('fs');
const path = require('path');
const DEFAULT_LAYOUT = require('../config/team-of-the-tournament-layout');
const BOMBER_X_LOCO_LAYOUT = require('../config/bomber-x-loco-tott-layout');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../src/storage');
const { findTeamById } = require('../src/domain/teams/team-service');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');

let canvasApi;
const templatePromises = new Map();

function getCanvas() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function fittedFont(ctx, text, maxWidth, maxSize, minSize = 18) {
  let size = maxSize;
  do {
    ctx.font = `700 ${size}px Oxanium`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  } while (size > minSize);
  return minSize;
}

function drawCenteredText(ctx, text, box, maxSize, minSize = 18) {
  const value = String(text || '—');
  fittedFont(ctx, value, box.width, maxSize, minSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  ctx.lineWidth = Math.max(3, maxSize * 0.1);
  ctx.strokeText(value, box.x + box.width / 2, box.y + box.height / 2, box.width);
  ctx.fillText(value, box.x + box.width / 2, box.y + box.height / 2, box.width);
}

async function loadTemplate(layout) {
  if (!templatePromises.has(layout.template)) {
    templatePromises.set(layout.template, getCanvas().loadImage(path.resolve(ROOT_DIR, layout.template)));
  }
  return templatePromises.get(layout.template);
}

async function drawLogo(ctx, player, circle) {
  const team = findTeamById(player?.teamId);
  const logoPath = team?.logo?.fileName ? path.join(TEAM_LOGOS_DIR, path.basename(team.logo.fileName)) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(circle.centerX, circle.centerY, circle.radius, 0, Math.PI * 2);
  ctx.clip();
  if (logoPath && fs.existsSync(logoPath)) {
    const image = await getCanvas().loadImage(logoPath);
    const scale = Math.min((circle.radius * 1.7) / image.width, (circle.radius * 1.7) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, circle.centerX - width / 2, circle.centerY - height / 2, width, height);
  } else {
    const initials = String(team?.clubName || 'LNC').split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase();
    ctx.fillStyle = '#12051e';
    ctx.fillRect(circle.centerX - circle.radius, circle.centerY - circle.radius, circle.radius * 2, circle.radius * 2);
    drawCenteredText(ctx, initials, { x: circle.centerX - circle.radius, y: circle.centerY - 25, width: circle.radius * 2, height: 50 }, 42, 22);
  }
  ctx.restore();
}

function orderedPlayers(selection) {
  return {
    forward: selection?.forward || [], midfielder: selection?.midfielder || [],
    defender: selection?.defender || [], goalkeeper: selection?.goalkeeper || [],
  };
}

async function renderTeamOfTheTournament({ selection, serialNumber, variant = 'default' }) {
  const layout = variant === 'bomber_x_loco' ? BOMBER_X_LOCO_LAYOUT : DEFAULT_LAYOUT;
  const template = await loadTemplate(layout);
  const canvas = getCanvas().createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, template.width, template.height);
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 5;
  const players = orderedPlayers(selection);
  for (const [position, slots] of Object.entries(layout.slots)) {
    for (let index = 0; index < slots.length; index += 1) {
      const player = players[position][index];
      if (!player) continue;
      const slot = slots[index];
      await drawLogo(ctx, player, slot.logo);
      drawCenteredText(ctx, player.playerName, slot.name, 27, 15);
      drawCenteredText(ctx, Number(player.averageRating).toFixed(1).replace('.', ','), {
        x: slot.rating.centerX - slot.rating.radius, y: slot.rating.centerY - slot.rating.radius,
        width: slot.rating.radius * 2, height: slot.rating.radius * 2,
      }, slot.rating.radius >= 38 ? 32 : 27, 18);
    }
  }
  if (layout.serial) {
    drawCenteredText(ctx, `#${serialNumber}`, {
      x: layout.serial.centerX - layout.serial.width / 2,
      y: layout.serial.centerY - layout.serial.height / 2,
      width: layout.serial.width, height: layout.serial.height,
    }, layout.serial.maxFontSize, 32);
  }
  const prefix = variant === 'bomber_x_loco' ? 'bomber-x-loco-team-of-the-tournament' : 'team-of-the-tournament';
  return { buffer: canvas.toBuffer('image/png'), fileName: `${prefix}${layout.serial ? `-${serialNumber}` : ''}.png` };
}

module.exports = { orderedPlayers, renderTeamOfTheTournament };

