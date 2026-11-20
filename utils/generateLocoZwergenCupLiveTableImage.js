'use strict';

const path = require('path');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { listVisibleTeams } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

const WIDTH = 1600;
const HEIGHT = 900;
const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'loco-zwerge-cup', 'live-table.jpeg');
const LAYOUT = Object.freeze({
  groupLabel: Object.freeze({ x: 800, y: 351, maxWidth: 580 }),
  qualification: Object.freeze({ x: 800, y: 405, maxWidth: 900 }),
  rowsY: Object.freeze([506, 549, 592, 636]),
  placeX: 123,
  logoX: 211,
  logoSize: 36,
  teamX: 241,
  teamMaxWidth: 355,
  playedX: 681,
  winsX: 802,
  drawsX: 951,
  lossesX: 1118,
  diffX: 1290,
  pointsX: 1453,
});

const GTA_TABLE_LAYOUT = Object.freeze({
  groupLabel: { x: 1006, y: 280, maxWidth: 78 },
  qualification: { x: 975, y: 848, maxWidth: 1110 },
  rowsY: [484, 563, 645, 731],
  placeX: 161,
  logoX: 276,
  logoSize: 54,
  teamX: 316,
  teamMaxWidth: 446,
  playedX: 853,
  winsX: 978,
  drawsX: 1099,
  lossesX: 1219,
  diffX: 1355,
  pointsX: 1512,
});
const GTA_BACKGROUND = path.resolve(__dirname, '..', 'assets', 'loco-gta-vi-cup', 'live-table.jpeg');

let canvasApi;
const backgrounds = new Map();
const logoCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function setFont(ctx, size, family = 'Oxanium', weight = '700') {
  setCanvasFont(ctx, size, family, weight);
}

function fitFont(ctx, text, maxWidth, maxSize, minSize, family = 'Oxanium', weight = '700') {
  for (let size = maxSize; size >= minSize; size -= 1) {
    setFont(ctx, size, family, weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  setFont(ctx, minSize, family, weight);
  return minSize;
}

function loadBackground(file) {
  if (!backgrounds.has(file)) {
    backgrounds.set(file, getCanvasApi().loadImage(file).catch(error => {
      backgrounds.delete(file);
      throw error;
    }));
  }
  return backgrounds.get(file);
}

function findTeam(row) {
  if (row?.teamId) return listVisibleTeams().find(team => String(team.id) === String(row.teamId)) || null;
  const name = String(row?.name || '').trim().toLocaleLowerCase('de');
  return listVisibleTeams().find(team => String(team.clubName || '').trim().toLocaleLowerCase('de') === name) || null;
}

async function loadLogo(row) {
  const team = findTeam(row);
  if (!team) return null;
  const key = String(team.id);
  if (logoCache.has(key)) return logoCache.get(key);
  const logoPath = resolveTeamLogoPath(team, { optional: true });
  if (!logoPath) return null;
  try {
    const image = await getCanvasApi().loadImage(logoPath);
    logoCache.set(key, image);
    return image;
  } catch {
    return null;
  }
}

function drawLogo(ctx, image, centerX, centerY, size) {
  if (!image) return;
  const scale = Math.min(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
}

function qualificationText(value) {
  return String(value || '').replace(/🏆/gu, '').trimStart().replace(/^Weiterkommen:\s*/i, '').trim();
}

function drawHeader(ctx, groupKey, qualification, layout, gta) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,35,70,0.8)';
  ctx.shadowBlur = 8;
  const letter = String(groupKey || '').toUpperCase();
  const group = gta ? letter : `GRUPPE ${letter}`;
  fitFont(ctx, group, layout.groupLabel.maxWidth, gta ? 64 : 44, 24);
  ctx.lineWidth = 3;
  ctx.strokeText(group, layout.groupLabel.x, layout.groupLabel.y);
  ctx.fillText(group, layout.groupLabel.x, layout.groupLabel.y);
  const detail = qualificationText(qualification);
  if (detail) {
    fitFont(ctx, detail, layout.qualification.maxWidth, gta ? 31 : 20, 12, 'Open Sans', '600');
    ctx.lineWidth = 2;
    ctx.strokeText(detail, layout.qualification.x, layout.qualification.y);
    ctx.fillText(detail, layout.qualification.x, layout.qualification.y);
  }
  ctx.shadowBlur = 0;
}

function goalDifference(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

async function drawRows(ctx, rows, layout, gta) {
  for (let index = 0; index < Math.min(4, rows?.length || 0); index += 1) {
    const row = rows[index];
    const y = layout.rowsY[index];
    const name = String(row.name || 'Team').trim();
    const logo = row.isBye ? null : await loadLogo(row);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3;
    setFont(ctx, gta ? 34 : 25);
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1), layout.placeX, y);
    drawLogo(ctx, logo, layout.logoX, y, layout.logoSize);
    fitFont(ctx, name, layout.teamMaxWidth, gta ? 34 : 25, 13, 'Open Sans', '700');
    ctx.textAlign = 'left';
    if (gta) ctx.fillText(name, layout.teamX, y, layout.teamMaxWidth);
    else ctx.fillText(name, layout.teamX, y);
    setFont(ctx, gta ? 38 : 27, 'Odibee Sans', '400');
    ctx.textAlign = 'center';
    for (const [x, value] of [
      [layout.playedX, row.played || 0], [layout.winsX, row.wins || 0],
      [layout.drawsX, row.draws || 0], [layout.lossesX, row.losses || 0],
      [layout.diffX, goalDifference(row.goalDifference)], [layout.pointsX, row.points || 0],
    ]) ctx.fillText(String(value), x, y);
  }
  ctx.shadowBlur = 0;
}

async function renderLiveTable({ groupKey, rows, qualificationText: qualification = '' }, gta) {
  const layout = gta ? GTA_TABLE_LAYOUT : LAYOUT;
  const background = await loadBackground(gta ? GTA_BACKGROUND : BACKGROUND);
  const canvas = getCanvasApi().createCanvas(gta ? background.width : WIDTH, gta ? background.height : HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  drawHeader(ctx, groupKey, qualification, layout, gta);
  await drawRows(ctx, rows, layout, gta);
  return canvas.toBuffer('image/png');
}

function generateLocoZwergenCupLiveTableImage(data) {
  return renderLiveTable(data, false);
}

function generateLocoGtaCupLiveTableImage(data) {
  return renderLiveTable(data, true);
}

module.exports = { LOCO_ZWERGEN_CUP_TABLE_LAYOUT: LAYOUT, generateLocoZwergenCupLiveTableImage, generateLocoGtaCupLiveTableImage };
