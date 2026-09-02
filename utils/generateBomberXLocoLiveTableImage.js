'use strict';

const path = require('path');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { listVisibleTeams } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

const WIDTH = 1536;
const HEIGHT = 864;
const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'bomber-x-loco', 'live-table.png');

// Individually measured against the current 1536x864 Bomber X Loco live-table template.
// Header strip: qualification on the left/centre, group label on the right.
// Data is centered inside the six printed table rows.
const LAYOUT = Object.freeze({
  groupLabel: { x: 1060, y: 346, maxWidth: 245 },
  qualification: { x: 435, y: 346, maxWidth: 515 },
  rowsY: [444, 496, 547, 599, 650, 702],
  placeX: 207,
  logoX: 290,
  logoSize: 38,
  teamX: 320,
  teamMaxWidth: 275,
  playedX: 669,
  winsX: 776,
  drawsX: 907,
  lossesX: 1054,
  diffX: 1194,
  pointsX: 1325,
});

let canvasApi = null;
let backgroundPromise = null;
const logoCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  return canvasApi;
}

function ensureFonts() { ensureCanvasFontsRegistered(getCanvasApi()); }
function setFont(ctx, size, family, weight = '400') { setCanvasFont(ctx, size, family, weight); }

async function loadBackground() {
  if (!backgroundPromise) {
    backgroundPromise = getCanvasApi().loadImage(BACKGROUND).catch(error => {
      backgroundPromise = null;
      throw error;
    });
  }
  return backgroundPromise;
}

function findTeamForRow(row) {
  if (row?.teamId) return listVisibleTeams().find(team => String(team.id) === String(row.teamId)) || null;
  const target = String(row?.name || '').trim().toLocaleLowerCase('de');
  if (!target) return null;
  return listVisibleTeams().find(team => String(team.clubName || '').trim().toLocaleLowerCase('de') === target) || null;
}

async function loadTeamLogo(row) {
  const team = findTeamForRow(row);
  if (!team) return null;
  const key = String(team.id);
  if (logoCache.has(key)) return logoCache.get(key);
  const logoPath = resolveTeamLogoPath(team, { optional: true });
  if (!logoPath) { logoCache.set(key, null); return null; }
  try {
    const image = await getCanvasApi().loadImage(logoPath);
    logoCache.set(key, image);
    return image;
  } catch {
    logoCache.set(key, null);
    return null;
  }
}

function fitFont(ctx, text, maxWidth, maxSize = 30, minSize = 16) {
  for (let size = maxSize; size >= minSize; size -= 1) {
    setFont(ctx, size, 'Odibee Sans', '400');
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  setFont(ctx, minSize, 'Odibee Sans', '400');
  return minSize;
}

function fitOxanium(ctx, text, maxWidth, maxSize = 26, minSize = 14, weight = '700') {
  for (let size = maxSize; size >= minSize; size -= 1) {
    setFont(ctx, size, 'Oxanium', weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  setFont(ctx, minSize, 'Oxanium', weight);
  return minSize;
}

function cleanQualificationText(value) {
  const raw = String(value || '').replace(/🏆/gu, '').trim();
  const stripped = raw.replace(/^Weiterkommen:\s*/i, '').trim();
  return stripped ? `K.O.-Phase erreicht: ${stripped}` : '';
}

function drawTopLabels(ctx, groupKey, qualificationText) {
  const groupText = `GRUPPE ${String(groupKey || '').toUpperCase()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,140,30,0.55)';
  ctx.shadowBlur = 6;

  fitOxanium(ctx, groupText, LAYOUT.groupLabel.maxWidth, 25, 16, '700');
  ctx.lineWidth = 2;
  ctx.strokeText(groupText, LAYOUT.groupLabel.x, LAYOUT.groupLabel.y);
  ctx.fillText(groupText, LAYOUT.groupLabel.x, LAYOUT.groupLabel.y);

  const qualification = cleanQualificationText(qualificationText);
  if (qualification) {
    fitOxanium(ctx, qualification, LAYOUT.qualification.maxWidth, 20, 12, '600');
    ctx.lineWidth = 2;
    ctx.strokeText(qualification, LAYOUT.qualification.x, LAYOUT.qualification.y);
    ctx.fillText(qualification, LAYOUT.qualification.x, LAYOUT.qualification.y);
  }
  ctx.shadowBlur = 0;
}

function drawLogo(ctx, image, centerX, centerY, size) {
  if (!image) return;
  const scale = Math.min(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
}

function formatDiff(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

async function drawRows(ctx, rows) {
  const visible = (rows || []).slice(0, 6);
  for (let index = 0; index < visible.length; index += 1) {
    const row = visible[index];
    const y = LAYOUT.rowsY[index];
    const teamName = String(row.name || 'Team').trim();
    const logo = row.isBye ? null : await loadTeamLogo(row);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 3;
    ctx.textBaseline = 'middle';

    setFont(ctx, 29, 'Oxanium', '700');
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1), LAYOUT.placeX, y);

    drawLogo(ctx, logo, LAYOUT.logoX, y, LAYOUT.logoSize);

    fitFont(ctx, teamName, LAYOUT.teamMaxWidth, 29, 15);
    ctx.textAlign = 'left';
    ctx.fillText(teamName, LAYOUT.teamX, y);

    setFont(ctx, 31, 'Odibee Sans', '400');
    ctx.textAlign = 'center';
    const values = [
      [LAYOUT.playedX, Number(row.played || 0)],
      [LAYOUT.winsX, Number(row.wins || 0)],
      [LAYOUT.drawsX, Number(row.draws || 0)],
      [LAYOUT.lossesX, Number(row.losses || 0)],
      [LAYOUT.diffX, formatDiff(row.goalDifference)],
      [LAYOUT.pointsX, Number(row.points || 0)],
    ];
    for (const [x, value] of values) ctx.fillText(String(value), x, y);
  }
  ctx.shadowBlur = 0;
}

async function generateBomberXLocoLiveTableImage({ groupKey, rows, qualificationText = '' }) {
  ensureFonts();
  const { createCanvas } = getCanvasApi();
  const background = await loadBackground();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, WIDTH, HEIGHT);
  drawTopLabels(ctx, groupKey, qualificationText);
  await drawRows(ctx, rows);
  return canvas.toBuffer('image/png');
}

module.exports = { BOMBER_X_LOCO_TABLE_LAYOUT: LAYOUT, generateBomberXLocoLiveTableImage };
