'use strict';

const path = require('path');
const fs = require('fs');

const CANVAS_SIZE = Object.freeze({ width: 1600, height: 900 });
const TEMPLATE_SIZE = Object.freeze({ width: 1672, height: 941 });
const scaleX = value => value * CANVAS_SIZE.width / TEMPLATE_SIZE.width;
const scaleY = value => value * CANVAS_SIZE.height / TEMPLATE_SIZE.height;

// Pixelvermessung der Originalvorlage (1672 x 941):
// Spaltengrenzen X: 194, 668, 794, 918, 1116, 1282, 1458, 1594
// Zeilengrenzen Y: 441, 538, 636, 733, 830
const TABLE_LAYOUT = Object.freeze({
  width: CANVAS_SIZE.width,
  height: CANVAS_SIZE.height,
  titleX: scaleX(TEMPLATE_SIZE.width / 2),
  titleY: scaleY((300 + 379) / 2),
  teamX: scaleX(220),
  teamMaxWidth: scaleX(642 - 220),
  playedX: scaleX((668 + 794) / 2),
  winsX: scaleX((794 + 918) / 2),
  drawsX: scaleX((918 + 1116) / 2),
  lossesX: scaleX((1116 + 1282) / 2),
  goalDifferenceX: scaleX((1282 + 1458) / 2),
  pointsX: scaleX((1458 + 1594) / 2),
  rowY: Object.freeze([
    scaleY((441 + 538) / 2),
    scaleY((538 + 636) / 2),
    scaleY((636 + 733) / 2),
    scaleY((733 + 830) / 2),
  ]),
  qualification: Object.freeze({
    x: scaleX(100),
    y: scaleY(345),
    maxWidth: scaleX(620 - 100),
    maxFontSize: 24,
    minFontSize: 14,
  }),
});

const ASSETS = Object.freeze({
  background: path.resolve(__dirname, '..', 'assets', 'tables', 'live-table.png'),
  oxanium: path.resolve(__dirname, '..', 'assets', 'fonts', 'Oxanium-VariableFont_wght.ttf'),
  odibee: path.resolve(__dirname, '..', 'assets', 'fonts', 'OdibeeSans-Regular.ttf'),
  openSans: path.resolve(__dirname, '..', 'assets', 'fonts', 'OpenSans-VariableFont_wdth,wght.ttf'),
});

let canvasApi = null;
let fontsRegistered = false;
let backgroundPromise = null;

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  return canvasApi;
}

function ensureFontsRegistered() {
  if (fontsRegistered) return;
  const { registerFont } = getCanvasApi();
  const fonts = [
    [ASSETS.oxanium, { family: 'Oxanium', weight: '700' }],
    [ASSETS.odibee, { family: 'Odibee Sans', weight: '400' }],
    [ASSETS.openSans, { family: 'Open Sans', weight: '600' }],
  ];
  for (const [file, definition] of fonts) {
    if (!fs.existsSync(file)) {
      console.error(`[live-table] Fontdatei fehlt: ${file}`);
      throw new Error(`Live-Table-Font fehlt: ${path.basename(file)}`);
    }
    try {
      registerFont(file, definition);
    } catch (error) {
      console.error(`[live-table] Font konnte nicht registriert werden: ${file}`, error);
      throw error;
    }
  }
  fontsRegistered = true;
}

function loadBackgroundCached() {
  if (!backgroundPromise) {
    const { loadImage } = getCanvasApi();
    backgroundPromise = loadImage(ASSETS.background).catch(error => {
      backgroundPromise = null;
      throw error;
    });
  }
  return backgroundPromise;
}

function setFont(ctx, size, family, weight = '400') {
  ctx.font = `${weight} ${size}px "${family}"`;
}

function fitSingleLineFont(ctx, text, { family, weight, maxSize, minSize, maxWidth }) {
  let size = maxSize;
  while (size > minSize) {
    setFont(ctx, size, family, weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  setFont(ctx, minSize, family, weight);
  return minSize;
}

function formatGoalDifference(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function normalizeQualificationText(value) {
  const qualification = String(value || '')
    .replace(/^\s*\u{1f3c6}\s*/u, '')
    .replace(/^Weiterkommen:\s*/i, '')
    .replace(/Platz 1\s*&\s*2/i, 'Platz 1-2')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00e2\u20ac[\u201c\u201d]/g, '-')
    .replace(/\s+qualifizieren\s+sich\.?\s*$/i, '')
    .toUpperCase();
  return qualification ? `${qualification} QUALIFIZIEREN SICH` : '';
}

function wrapWords(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fitQualification(ctx, text) {
  const layout = TABLE_LAYOUT.qualification;
  for (let size = layout.maxFontSize; size >= layout.minFontSize; size -= 1) {
    setFont(ctx, size, 'Open Sans', '600');
    if (ctx.measureText(text).width <= layout.maxWidth) return { size, lines: [text] };
  }
  for (let size = layout.maxFontSize; size >= layout.minFontSize; size -= 1) {
    setFont(ctx, size, 'Open Sans', '600');
    const lines = wrapWords(ctx, text, layout.maxWidth);
    if (lines.length <= 2) return { size, lines };
  }
  setFont(ctx, layout.minFontSize, 'Open Sans', '600');
  return { size: layout.minFontSize, lines: wrapWords(ctx, text, layout.maxWidth) };
}

function drawGroupTitle(ctx, groupKey) {
  const text = `GRUPPE ${String(groupKey || '').toUpperCase()}`;
  setFont(ctx, 72, 'Oxanium', '700');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowColor = 'rgba(255, 30, 122, 0.85)';
  ctx.shadowBlur = 22;
  ctx.strokeText(text, TABLE_LAYOUT.titleX, TABLE_LAYOUT.titleY);
  const gradient = ctx.createLinearGradient(
    TABLE_LAYOUT.titleX - 250,
    TABLE_LAYOUT.titleY,
    TABLE_LAYOUT.titleX + 250,
    TABLE_LAYOUT.titleY
  );
  gradient.addColorStop(0, '#ff202e');
  gradient.addColorStop(0.5, '#ff2ca8');
  gradient.addColorStop(1, '#8f3cff');
  ctx.fillStyle = gradient;
  ctx.fillText(text, TABLE_LAYOUT.titleX, TABLE_LAYOUT.titleY);
  ctx.shadowBlur = 0;
}

function drawStandings(ctx, rows) {
  const visibleRows = (rows || []).slice(0, TABLE_LAYOUT.rowY.length);
  visibleRows.forEach((row, index) => {
    const y = TABLE_LAYOUT.rowY[index];
    const name = String(row.name || 'Team').trim();
    fitSingleLineFont(ctx, name, {
      family: 'Odibee Sans',
      weight: '400',
      maxSize: 50,
      minSize: 1,
      maxWidth: TABLE_LAYOUT.teamMaxWidth,
    });
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.35)';
    ctx.shadowBlur = 6;
    ctx.fillText(name, TABLE_LAYOUT.teamX, y);

    setFont(ctx, 52, 'Odibee Sans', '400');
    ctx.textAlign = 'center';
    const values = [
      [TABLE_LAYOUT.playedX, Number(row.played || 0)],
      [TABLE_LAYOUT.winsX, Number(row.wins || 0)],
      [TABLE_LAYOUT.drawsX, Number(row.draws || 0)],
      [TABLE_LAYOUT.lossesX, Number(row.losses || 0)],
      [TABLE_LAYOUT.goalDifferenceX, formatGoalDifference(row.goalDifference)],
      [TABLE_LAYOUT.pointsX, Number(row.points || 0)],
    ];
    for (const [x, value] of values) ctx.fillText(String(value), x, y);
  });
  ctx.shadowBlur = 0;
}

function drawQualification(ctx, qualificationText) {
  const text = normalizeQualificationText(qualificationText);
  if (!text) return;
  const layout = TABLE_LAYOUT.qualification;
  const { size, lines } = fitQualification(ctx, text);
  setFont(ctx, size, 'Open Sans', '600');
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 3;
  const lineHeight = size * 1.18;
  const firstY = layout.y - ((lines.length - 1) * lineHeight / 2);
  lines.forEach((line, index) => {
    ctx.fillText(line, layout.x, firstY + index * lineHeight);
  });
  ctx.shadowBlur = 0;
}

async function generateLiveTableImage({ groupKey, rows, qualificationText }) {
  ensureFontsRegistered();
  const { createCanvas } = getCanvasApi();
  const background = await loadBackgroundCached();
  const canvas = createCanvas(CANVAS_SIZE.width, CANVAS_SIZE.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
  drawGroupTitle(ctx, groupKey);
  drawStandings(ctx, rows);
  drawQualification(ctx, qualificationText);
  return canvas.toBuffer('image/png');
}

module.exports = {
  TABLE_LAYOUT,
  generateLiveTableImage,
};
