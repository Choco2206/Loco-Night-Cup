'use strict';

const path = require('path');
const LAYOUT = require('../config/live-table-fc27-layout');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { loadCanvasImage } = require('./canvas-image-loader');

const TEMPLATE_PATH = path.resolve(__dirname, '..', LAYOUT.template);
let canvasApi = null;
let templatePromise = null;

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function loadTemplate() {
  if (!templatePromise) {
    templatePromise = loadCanvasImage(getCanvasApi(), TEMPLATE_PATH).catch(error => {
      templatePromise = null;
      throw error;
    });
  }
  return templatePromise;
}

function fitText(ctx, text, maxWidth, maximum, minimum, family = 'Open Sans', weight = '700') {
  for (let size = maximum; size >= minimum; size -= 1) {
    setCanvasFont(ctx, size, family, weight);
    if (ctx.measureText(String(text)).width <= maxWidth) return size;
  }
  return minimum;
}

function formatGoalDifference(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function normalizeQualificationText(value) {
  const text = String(value || '')
    .replace(/^\s*\u{1f3c6}\s*/u, '')
    .replace(/^Weiterkommen:\s*/i, '')
    .replace(/[\u2013\u2014]/g, '-')
    .trim();
  return text;
}

function drawCentered(ctx, text, field, scaleX, scaleY, { family = 'Open Sans', weight = '700' } = {}) {
  const size = fitText(
    ctx,
    text,
    field.maxWidth * scaleX,
    field.maxFontSize * scaleY,
    field.minFontSize * scaleY,
    family,
    weight,
  );
  setCanvasFont(ctx, size, family, weight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(text), field.x * scaleX, field.y * scaleY);
}

async function generateFc27LiveTableImage({ groupKey, rows, qualificationText }) {
  const template = await loadTemplate();
  const width = template.naturalWidth || template.width;
  const height = template.naturalHeight || template.height;
  const scaleX = width / LAYOUT.reference.width;
  const scaleY = height / LAYOUT.reference.height;
  const canvas = getCanvasApi().createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, width, height);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 5 * scaleY;
  drawCentered(ctx, `GRUPPE ${String(groupKey || '').toUpperCase()}`, LAYOUT.groupName, scaleX, scaleY, { family: 'Oxanium' });
  drawCentered(ctx, normalizeQualificationText(qualificationText), LAYOUT.qualification, scaleX, scaleY);

  const visibleRows = (rows || []).slice(0, LAYOUT.rowY.length);
  visibleRows.forEach((row, index) => {
    const y = LAYOUT.rowY[index] * scaleY;
    const name = String(row.name || 'Team').trim();
    const nameSize = fitText(ctx, name, LAYOUT.columns.teamMaxWidth * scaleX, 43 * scaleY, 17 * scaleY, 'Odibee Sans', '400');
    setCanvasFont(ctx, nameSize, 'Odibee Sans', '400');
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, LAYOUT.columns.teamX * scaleX, y);

    setCanvasFont(ctx, 42 * scaleY, 'Odibee Sans', '400');
    ctx.textAlign = 'center';
    const values = [
      [LAYOUT.columns.position, index + 1],
      [LAYOUT.columns.played, Number(row.played || 0)],
      [LAYOUT.columns.wins, Number(row.wins || 0)],
      [LAYOUT.columns.draws, Number(row.draws || 0)],
      [LAYOUT.columns.losses, Number(row.losses || 0)],
      [LAYOUT.columns.goalDifference, formatGoalDifference(row.goalDifference)],
      [LAYOUT.columns.points, Number(row.points || 0)],
    ];
    values.forEach(([x, value]) => ctx.fillText(String(value), x * scaleX, y));
  });
  ctx.shadowBlur = 0;
  return canvas.toBuffer('image/png');
}

module.exports = { FC27_LIVE_TABLE_LAYOUT: LAYOUT, generateFc27LiveTableImage };
