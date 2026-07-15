'use strict';

const fs = require('fs');
const path = require('path');
const canvasApi = require('canvas');
const { createCanvas, loadImage } = canvasApi;
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

ensureCanvasFontsRegistered(canvasApi);
const ROOT = path.resolve(__dirname, '..');
function template(name) {
  const candidates = [path.join(ROOT, 'assets', 'league-phase', name), path.join(ROOT, 'assets', 'leauge-phase', name)];
  const found = candidates.find(fs.existsSync);
  if (!found) throw new Error(`Ligaphasen-Vorlage fehlt: ${name}`);
  return found;
}
function fit(ctx, text, maxWidth, start, min = 12) {
  let size = start;
  while (size > min) { setCanvasFont(ctx, size, 'Oxanium', '700'); if (ctx.measureText(text).width <= maxWidth) break; size -= 1; }
  return size;
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
  const base = await loadImage(template('ligaphase_table_20.png'));
  const canvas = createCanvas(base.width, base.height); const ctx = canvas.getContext('2d'); ctx.drawImage(base, 0, 0);
  const rows = phase.standings || [];
  for (let i = 0; i < 20; i += 1) {
    const row = rows[i]; if (!row) continue;
    const y = 318 + i * 28.35; const participant = phase.slots.find(slot => slot.participantKey === row.participantKey) || row;
    const logo = await logoFor(participant); drawLogo(ctx, logo, participant, 201, y - 12, 28, 24);
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; fit(ctx, row.displayName || '-', 350, 20, 11); ctx.fillText(row.displayName || '-', 238, y);
    ctx.textAlign = 'center'; setCanvasFont(ctx, 18, 'Oxanium', '700');
    [row.played, row.wins, row.draws, row.losses, row.goalDifference, row.points].forEach((value, col) => ctx.fillText(String(value ?? 0), [710, 855, 1025, 1205, 1370, 1530][col], y));
  }
  return canvas.toBuffer('image/png');
}
async function renderLeagueSchedule(phase) {
  const base = await loadImage(template('ligaphase_schedule_20.png'));
  const canvas = createCanvas(base.width, base.height); const ctx = canvas.getContext('2d'); ctx.drawImage(base, 0, 0);
  const columns = [63, 462, 852, 1245];
  for (let day = 0; day < 4; day += 1) for (let i = 0; i < 10; i += 1) {
    const match = phase.matchdays?.[day]?.matches?.[i]; if (!match) continue;
    const x = columns[day]; const y = 414 + i * 45.2;
    drawLogo(ctx, await logoFor(match.home), match.home, x + 9, y - 17, 34, 34); drawLogo(ctx, await logoFor(match.away), match.away, x + 334, y - 17, 34, 34);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    const left = match.home.displayName || (match.home.type === 'bye' ? 'Freilos' : '-'); const right = match.away.displayName || (match.away.type === 'bye' ? 'Freilos' : '-');
    ctx.textAlign = 'left'; fit(ctx, left, 105, 16, 9); ctx.fillText(left, x + 52, y);
    ctx.textAlign = 'right'; fit(ctx, right, 105, 16, 9); ctx.fillText(right, x + 325, y);
    if (match.status === 'confirmed' && match.result) { ctx.textAlign = 'center'; setCanvasFont(ctx, 16, 'Oxanium', '700'); ctx.fillText(`${match.result.homeGoals} : ${match.result.awayGoals}`, x + 190, y); }
  }
  return canvas.toBuffer('image/png');
}
module.exports = { renderLeagueSchedule, renderLeagueTable };
