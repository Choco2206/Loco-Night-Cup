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

let canvasApi;
let backgroundPromise;
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

function loadBackground() {
  if (!backgroundPromise) backgroundPromise = getCanvasApi().loadImage(BACKGROUND).catch(error => {
    backgroundPromise = null;
    throw error;
  });
  return backgroundPromise;
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
  return String(value || '').replace(/🏆/gu, '').replace(/^Weiterkommen:\s*/i, '').trim();
}

function drawHeader(ctx, groupKey, qualification) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,35,70,0.8)';
  ctx.shadowBlur = 8;
  const group = `GRUPPE ${String(groupKey || '').toUpperCase()}`;
  fitFont(ctx, group, LAYOUT.groupLabel.maxWidth, 44, 24);
  ctx.lineWidth = 3;
  ctx.strokeText(group, LAYOUT.groupLabel.x, LAYOUT.groupLabel.y);
  ctx.fillText(group, LAYOUT.groupLabel.x, LAYOUT.groupLabel.y);
  const detail = qualificationText(qualification);
  if (detail) {
    fitFont(ctx, detail, LAYOUT.qualification.maxWidth, 20, 12, 'Open Sans', '600');
    ctx.lineWidth = 2;
    ctx.strokeText(detail, LAYOUT.qualification.x, LAYOUT.qualification.y);
    ctx.fillText(detail, LAYOUT.qualification.x, LAYOUT.qualification.y);
  }
  ctx.shadowBlur = 0;
}

function goalDifference(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

async function drawRows(ctx, rows) {
  for (let index = 0; index < Math.min(4, rows?.length || 0); index += 1) {
    const row = rows[index];
    const y = LAYOUT.rowsY[index];
    const name = String(row.name || 'Team').trim();
    const logo = row.isBye ? null : await loadLogo(row);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3;
    setFont(ctx, 25);
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1), LAYOUT.placeX, y);
    drawLogo(ctx, logo, LAYOUT.logoX, y, LAYOUT.logoSize);
    fitFont(ctx, name, LAYOUT.teamMaxWidth, 25, 13, 'Open Sans', '700');
    ctx.textAlign = 'left';
    ctx.fillText(name, LAYOUT.teamX, y);
    setFont(ctx, 27, 'Odibee Sans', '400');
    ctx.textAlign = 'center';
    for (const [x, value] of [
      [LAYOUT.playedX, row.played || 0], [LAYOUT.winsX, row.wins || 0],
      [LAYOUT.drawsX, row.draws || 0], [LAYOUT.lossesX, row.losses || 0],
      [LAYOUT.diffX, goalDifference(row.goalDifference)], [LAYOUT.pointsX, row.points || 0],
    ]) ctx.fillText(String(value), x, y);
  }
  ctx.shadowBlur = 0;
}

async function generateLocoZwergenCupLiveTableImage({ groupKey, rows, qualificationText: qualification = '' }) {
  const background = await loadBackground();
  const canvas = getCanvasApi().createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, WIDTH, HEIGHT);
  drawHeader(ctx, groupKey, qualification);
  await drawRows(ctx, rows);
  return canvas.toBuffer('image/png');
}

module.exports = { LOCO_ZWERGEN_CUP_TABLE_LAYOUT: LAYOUT, generateLocoZwergenCupLiveTableImage };
