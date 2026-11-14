'use strict';

const path = require('path');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { listVisibleTeams } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

const { HALLOWEEN_EVENT_KEY, SEASONAL_CUP } = require('../src/domain/events/bomber-x-loco-config');

const WIDTH = 1536;
const HEIGHT = 864;
const BACKGROUNDS = Object.freeze({
  regular: path.resolve(__dirname, '..', 'assets', 'bomber-x-loco', 'live-table.png'),
  christmas: path.resolve(__dirname, '..', 'assets', 'bomber-x-loco-christmas', 'live-table.jpeg'),
  halloween: path.resolve(__dirname, '..', 'assets', 'bomber-x-loco-halloween', 'live-table-v2.jpeg'),
});

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

// Independently measured on the 1672 x 941 Halloween table.
const HALLOWEEN_LAYOUT = Object.freeze({
  groupLabel: { x: 1200, y: 378, maxWidth: 430 },
  qualification: { x: 525, y: 378, maxWidth: 690 },
  rowsY: [487, 543, 598, 653, 709, 764],
  placeX: 215, logoX: 302, logoSize: 38,
  teamX: 332, teamMaxWidth: 318,
  playedX: 728, winsX: 844, drawsX: 988,
  lossesX: 1148, diffX: 1300, pointsX: 1445,
});

// Cell centers measured on the native 1672 × 941 artwork, between the printed rules.
const CHRISTMAS_LAYOUT = Object.freeze({
  groupLabel: { x: 998, y: 244, maxWidth: 62 },
  qualification: { x: 836, y: 902, maxWidth: 940 },
  rowsY: [442, 513, 584, 655, 727, 799],
  placeX: 280, logoX: 371, logoSize: 50,
  teamX: 411, teamMaxWidth: 350,
  playedX: 839, winsX: 944, drawsX: 1043,
  lossesX: 1139, diffX: 1254, pointsX: 1383,
});

let canvasApi = null;
const backgroundPromises = new Map();
const logoCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  return canvasApi;
}

function ensureFonts() { ensureCanvasFontsRegistered(getCanvasApi()); }
function setFont(ctx, size, family, weight = '400') { setCanvasFont(ctx, size, family, weight); }

async function loadBackground(variant) {
  if (!backgroundPromises.has(variant)) {
    const promise = getCanvasApi().loadImage(BACKGROUNDS[variant]).catch(error => {
      backgroundPromises.delete(variant);
      throw error;
    });
    backgroundPromises.set(variant, promise);
  }
  return backgroundPromises.get(variant);
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

function drawTopLabels(ctx, groupKey, qualificationText, layout) {
  const group = String(groupKey || '').toUpperCase();
  const christmas = layout === CHRISTMAS_LAYOUT;
  const groupText = christmas ? group : `GRUPPE ${group}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,140,30,0.55)';
  ctx.shadowBlur = 6;

  fitOxanium(ctx, groupText, layout.groupLabel.maxWidth, christmas ? 42 : 25, 16, '700');
  ctx.lineWidth = 2;
  ctx.strokeText(groupText, layout.groupLabel.x, layout.groupLabel.y);
  ctx.fillText(groupText, layout.groupLabel.x, layout.groupLabel.y);

  const qualification = cleanQualificationText(qualificationText);
  if (qualification) {
    fitOxanium(ctx, qualification, layout.qualification.maxWidth, 20, 12, '600');
    if (christmas) {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(3, 12, 26, 0.9)';
      const width = Math.min(ctx.measureText(qualification).width + 32, 972);
      ctx.fillRect(layout.qualification.x - width / 2, layout.qualification.y - 15, width, 30);
      ctx.restore();
    }
    ctx.lineWidth = 2;
    ctx.strokeText(qualification, layout.qualification.x, layout.qualification.y);
    ctx.fillText(qualification, layout.qualification.x, layout.qualification.y);
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

async function drawRows(ctx, rows, layout) {
  const visible = (rows || []).slice(0, 6);
  for (let index = 0; index < visible.length; index += 1) {
    const row = visible[index];
    const y = layout.rowsY[index];
    const teamName = String(row.name || 'Team').trim();
    const logo = row.isBye ? null : await loadTeamLogo(row);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 3;
    ctx.textBaseline = 'middle';

    setFont(ctx, 29, 'Oxanium', '700');
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1), layout.placeX, y);

    drawLogo(ctx, logo, layout.logoX, y, layout.logoSize);

    fitFont(ctx, teamName, layout.teamMaxWidth, 29, 15);
    ctx.textAlign = 'left';
    ctx.fillText(teamName, layout.teamX, y, layout.teamMaxWidth);

    setFont(ctx, 31, 'Odibee Sans', '400');
    ctx.textAlign = 'center';
    const values = [
      [layout.playedX, Number(row.played || 0)],
      [layout.winsX, Number(row.wins || 0)],
      [layout.drawsX, Number(row.draws || 0)],
      [layout.lossesX, Number(row.losses || 0)],
      [layout.diffX, formatDiff(row.goalDifference)],
      [layout.pointsX, Number(row.points || 0)],
    ];
    for (const [x, value] of values) ctx.fillText(String(value), x, y);
  }
  ctx.shadowBlur = 0;
}

async function generateBomberXLocoLiveTableImage({ groupKey, rows, qualificationText = '', eventKey = '', eventDate }) {
  ensureFonts();
  const { createCanvas } = getCanvasApi();
  const variant = eventKey !== HALLOWEEN_EVENT_KEY ? 'regular'
    : eventDate === SEASONAL_CUP.date ? SEASONAL_CUP.theme : 'halloween';
  const background = await loadBackground(variant);
  const layout = variant === 'christmas' ? CHRISTMAS_LAYOUT : variant === 'halloween' ? HALLOWEEN_LAYOUT : LAYOUT;
  const width = variant === 'regular' ? WIDTH : 1672;
  const height = variant === 'regular' ? HEIGHT : 941;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, width, height);
  drawTopLabels(ctx, groupKey, qualificationText, layout);
  await drawRows(ctx, rows, layout);
  return canvas.toBuffer('image/png');
}

module.exports = { BOMBER_X_LOCO_TABLE_LAYOUT: LAYOUT, BOMBER_X_LOCO_HALLOWEEN_TABLE_LAYOUT: HALLOWEEN_LAYOUT, generateBomberXLocoLiveTableImage };
