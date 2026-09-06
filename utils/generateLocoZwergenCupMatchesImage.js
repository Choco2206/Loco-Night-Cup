'use strict';

const path = require('path');
const LAYOUT = require('../config/loco-zwergen-cup-group-schedule-layout');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { getMatchPresentation, orderedMatches } = require('./generateGroupScheduleImage');

const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'loco-zwerge-cup', 'matches.jpeg');
let canvasApi;
let backgroundPromise;
const logoCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}
function setFont(ctx, size, family, weight = '400') { setCanvasFont(ctx, size, family, weight); }
function fitFont(ctx, text, maxWidth, maxSize, minSize, family = 'Open Sans', weight = '700') {
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
function participantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'FREILOS';
  return findTeamById(participant.teamId)?.clubName || participant.displayName || participant.teamId || 'TEAM';
}
async function loadLogo(participant) {
  if (participant?.type !== 'team') return null;
  const key = String(participant.teamId);
  if (logoCache.has(key)) return logoCache.get(key);
  const logoPath = resolveTeamLogoPath(findTeamById(participant.teamId), { optional: true });
  if (!logoPath) return null;
  try {
    const image = await getCanvasApi().loadImage(logoPath);
    logoCache.set(key, image);
    return image;
  } catch { return null; }
}
function drawLogo(ctx, image, x, y) {
  if (!image) return;
  const scale = Math.min(LAYOUT.logoSize / image.width, LAYOUT.logoSize / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
}
async function drawMatch(ctx, match, y) {
  const home = participantName(match?.home);
  const away = participantName(match?.away);
  const [homeLogo, awayLogo] = await Promise.all([loadLogo(match?.home), loadLogo(match?.away)]);
  drawLogo(ctx, homeLogo, LAYOUT.homeLogoX, y);
  drawLogo(ctx, awayLogo, LAYOUT.awayLogoX, y);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 2;
  ctx.textBaseline = 'middle';
  fitFont(ctx, home, LAYOUT.teamMaxWidth, 23, 11);
  ctx.textAlign = 'center'; ctx.strokeText(home, LAYOUT.homeNameX, y); ctx.fillText(home, LAYOUT.homeNameX, y);
  fitFont(ctx, away, LAYOUT.teamMaxWidth, 23, 11);
  ctx.strokeText(away, LAYOUT.awayNameX, y); ctx.fillText(away, LAYOUT.awayNameX, y);
  const presentation = getMatchPresentation(match);
  if (presentation.score) {
    fitFont(ctx, presentation.score, LAYOUT.scoreMaxWidth, 25, 15, 'Oxanium', '700');
    ctx.strokeText(presentation.score, LAYOUT.scoreX, y); ctx.fillText(presentation.score, LAYOUT.scoreX, y);
  }
}
async function generateLocoZwergenCupMatchesImage({ group }) {
  const background = await loadBackground();
  const canvas = getCanvasApi().createCanvas(LAYOUT.reference.width, LAYOUT.reference.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, LAYOUT.reference.width, LAYOUT.reference.height);
  const title = `GRUPPE ${String(group.groupKey || '').toUpperCase()}`;
  fitFont(ctx, title, LAYOUT.title.maxWidth, 42, 22, 'Oxanium', '700');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 3;
  ctx.strokeText(title, LAYOUT.title.x, LAYOUT.title.y); ctx.fillText(title, LAYOUT.title.x, LAYOUT.title.y);
  const matches = orderedMatches(group);
  for (let index = 0; index < Math.min(matches.length, LAYOUT.rowsY.length); index += 1) await drawMatch(ctx, matches[index], LAYOUT.rowsY[index]);
  return { buffer: canvas.toBuffer('image/png'), fileName: `loco-zwergen-cup-matches-${String(group.groupKey || 'group').toLowerCase()}.png`, width: LAYOUT.reference.width, height: LAYOUT.reference.height };
}

module.exports = { generateLocoZwergenCupMatchesImage };
