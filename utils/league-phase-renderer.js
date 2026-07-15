'use strict';

const fs = require('fs');
const path = require('path');
const canvasApi = require('canvas');
const { createCanvas, loadImage } = canvasApi;
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');
const { LEAGUE_PHASE_FORMATS } = require('../src/app/constants');

ensureCanvasFontsRegistered(canvasApi);
const ROOT = path.resolve(__dirname, '..');
const RENDER_LAYOUTS = {
  14: { table: { firstY: 328, rowStep: 39.0, rowHeight: 35, logoX: 191, logoWidth: 28, logoHeight: 28, nameX: 224, nameWidth: 365, fontSize: 20 }, schedule: { columns: [64, 458, 852, 1246], firstY: 429, rowStep: 58.2, logoLeft: 3, logoRight: 324, logoSize: 30, leftX: 38, leftWidth: 118, scoreX: 177, scoreWidth: 27, rightX: 209, rightWidth: 112 } },
  18: { table: { firstY: 320, rowStep: 31.0, rowHeight: 28, logoX: 192, logoWidth: 24, logoHeight: 24, nameX: 222, nameWidth: 367, fontSize: 18 }, schedule: { columns: [50, 446, 842, 1240], firstY: 420, rowStep: 44.7, logoLeft: 3, logoRight: 327, logoSize: 30, leftX: 38, leftWidth: 119, scoreX: 160, scoreWidth: 47, rightX: 210, rightWidth: 116 } },
  20: { table: { firstY: 318, rowStep: 28.35, rowHeight: 25, logoX: 202, logoWidth: 24, logoHeight: 22, nameX: 232, nameWidth: 400, fontSize: 19 }, schedule: { columns: [63, 462, 852, 1245], firstY: 411, rowStep: 45.2, logoLeft: 11, logoRight: 337, logoSize: 28, leftX: 48, leftWidth: 112, scoreX: 163, scoreWidth: 56, rightX: 222, rightWidth: 112 } },
};
function formatSize(phase) { return Number(phase?.formatSize || phase?.slots?.length); }
function template(name) {
  const candidates = [path.join(ROOT, 'assets', 'league-phase', name), path.join(ROOT, 'assets', 'leauge-phase', name)];
  const found = candidates.find(fs.existsSync);
  if (!found) throw new Error(`Ligaphasen-Vorlage fehlt: ${name}`);
  return found;
}
function fit(ctx, text, maxWidth, start, min = 12) {
  let size = start;
  while (size > min) {
    setCanvasFont(ctx, size, 'Oxanium', '700');
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  setCanvasFont(ctx, size, 'Oxanium', '700');
  return size;
}
function clippedText(ctx, text, { x, y, width, height, align = 'left', fontSize = 16, minFontSize = 8, padding = 4 }) {
  const value = String(text || '-');
  const innerWidth = Math.max(1, width - padding * 2);
  fit(ctx, value, innerWidth, fontSize, minFontSize);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y - height / 2, width, height);
  ctx.clip();
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const textX = align === 'right' ? x + width - padding : align === 'center' ? x + width / 2 : x + padding;
  ctx.fillText(value, textX, y);
  ctx.restore();
}
async function logoFor(participant) {
  if (participant?.type !== 'team') return null;
  const team = findTeamById(participant.teamId);
  const logo = resolveTeamLogoPath(team);
  return logo ? loadImage(logo).catch(() => null) : null;
}
function drawContain(ctx, image, x, y, width, height) {
  if (!image) return;
  const ratio = Math.min(width / image.width, height / image.height);
  const w = image.width * ratio; const h = image.height * ratio;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}
function drawLogo(ctx, image, participant, x, y, width, height) {
  if (image) return drawContain(ctx, image, x, y, width, height);
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; setCanvasFont(ctx, Math.max(9, Math.floor(height * 0.35)), 'Oxanium', '700');
  const initials = participant?.type === 'bye' ? 'F' : String(participant?.displayName || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); ctx.fillText(initials || '?', x + width / 2, y + height / 2); ctx.restore();
}
async function renderLeagueTable(phase) {
  const size = formatSize(phase); const config = LEAGUE_PHASE_FORMATS[size]; const layout = RENDER_LAYOUTS[size]?.table;
  if (!config || !layout) throw new Error(`Nicht unterstuetztes Ligaphasenformat: ${size}`);
  const base = await loadImage(template(`ligaphase_table_${size}.png`));
  const canvas = createCanvas(base.width, base.height); const ctx = canvas.getContext('2d'); ctx.drawImage(base, 0, 0);
  const rows = phase.standings || [];
  for (let i = 0; i < size; i += 1) {
    const row = rows[i]; if (!row) continue;
    const y = layout.firstY + i * layout.rowStep; const participant = phase.slots.find(slot => slot.participantKey === row.participantKey) || row;
    const logo = await logoFor(participant); drawLogo(ctx, logo, participant, layout.logoX, y - layout.logoHeight / 2, layout.logoWidth, layout.logoHeight);
    ctx.fillStyle = '#ffffff';
    clippedText(ctx, row.displayName || '-', { x: layout.nameX, y, width: layout.nameWidth, height: layout.rowHeight, fontSize: layout.fontSize, minFontSize: 9, padding: 6 });
    ctx.textAlign = 'center'; setCanvasFont(ctx, Math.min(18, layout.fontSize), 'Oxanium', '700');
    [row.played, row.wins, row.draws, row.losses, row.goalDifference, row.points].forEach((value, col) => ctx.fillText(String(value ?? 0), [676, 835, 1016, 1202, 1371, 1534][col], y));
  }
  return canvas.toBuffer('image/png');
}
async function renderLeagueSchedule(phase) {
  const size = formatSize(phase); const config = LEAGUE_PHASE_FORMATS[size]; const layout = RENDER_LAYOUTS[size]?.schedule;
  if (!config || !layout) throw new Error(`Nicht unterstuetztes Ligaphasenformat: ${size}`);
  const base = await loadImage(template(`ligaphase_schedule_${size}.png`));
  const canvas = createCanvas(base.width, base.height); const ctx = canvas.getContext('2d'); ctx.drawImage(base, 0, 0);
  const columns = layout.columns;
  for (let day = 0; day < config.matchdays; day += 1) for (let i = 0; i < config.matchesPerDay; i += 1) {
    const match = phase.matchdays?.[day]?.matches?.[i]; if (!match) continue;
    const x = columns[day]; const y = layout.firstY + i * layout.rowStep;
    drawLogo(ctx, await logoFor(match.home), match.home, x + layout.logoLeft, y - layout.logoSize / 2, layout.logoSize, layout.logoSize);
    drawLogo(ctx, await logoFor(match.away), match.away, x + layout.logoRight, y - layout.logoSize / 2, layout.logoSize, layout.logoSize);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    const left = match.home.displayName || (match.home.type === 'bye' ? 'Freilos' : '-'); const right = match.away.displayName || (match.away.type === 'bye' ? 'Freilos' : '-');
    clippedText(ctx, left, { x: x + layout.leftX, y, width: layout.leftWidth, height: layout.logoSize + 4, fontSize: 14, minFontSize: 7, padding: 4 });
    clippedText(ctx, right, { x: x + layout.rightX, y, width: layout.rightWidth, height: layout.logoSize + 4, align: 'right', fontSize: 14, minFontSize: 7, padding: 4 });
    if (match.status === 'confirmed' && match.result) {
      clippedText(ctx, `${match.result.homeGoals} : ${match.result.awayGoals}`, { x: x + layout.scoreX, y, width: layout.scoreWidth, height: layout.logoSize + 4, align: 'center', fontSize: 14, minFontSize: 9, padding: 2 });
    }
  }
  return canvas.toBuffer('image/png');
}
module.exports = { renderLeagueSchedule, renderLeagueTable };
