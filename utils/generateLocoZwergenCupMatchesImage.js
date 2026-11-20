'use strict';

const path = require('path');
const LAYOUT = require('../config/loco-zwergen-cup-group-schedule-layout');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { getMatchPresentation, orderedMatches } = require('./generateGroupScheduleImage');

const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'loco-zwerge-cup', 'matches.jpeg');
const GTA_BACKGROUND = path.resolve(__dirname, '..', 'assets', 'loco-gta-vi-cup', 'matches.jpeg');
const GTA_LAYOUT = {
  reference: { width: 1122, height: 1402 },
  title: { x: 662, y: 320, maxWidth: 64 },
  rowsY: [645, 732, 921, 1007, 1198, 1284],
  homeLogoX: 71,
  homeNameX: 291,
  awayNameX: 831,
  awayLogoX: 1051,
  teamMaxWidth: 360,
  scoreX: 561,
  scoreMaxWidth: 112,
  logoSize: 56,
};
let canvasApi;
const backgrounds = new Map();
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
function loadBackground(file) {
  if (!backgrounds.has(file)) {
    backgrounds.set(file, getCanvasApi().loadImage(file).catch(error => {
      backgrounds.delete(file);
      throw error;
    }));
  }
  return backgrounds.get(file);
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
function drawLogo(ctx, image, x, y, size) {
  if (!image) return;
  const scale = Math.min(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
}
async function drawMatch(ctx, match, y, layout, gta) {
  const home = participantName(match?.home);
  const away = participantName(match?.away);
  const [homeLogo, awayLogo] = await Promise.all([loadLogo(match?.home), loadLogo(match?.away)]);
  drawLogo(ctx, homeLogo, layout.homeLogoX, y, layout.logoSize);
  drawLogo(ctx, awayLogo, layout.awayLogoX, y, layout.logoSize);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 2;
  ctx.textBaseline = 'middle';
  fitFont(ctx, home, layout.teamMaxWidth, gta ? 31 : 23, 11);
  ctx.textAlign = 'center'; ctx.strokeText(home, layout.homeNameX, y); ctx.fillText(home, layout.homeNameX, y);
  fitFont(ctx, away, layout.teamMaxWidth, gta ? 31 : 23, 11);
  ctx.strokeText(away, layout.awayNameX, y); ctx.fillText(away, layout.awayNameX, y);
  const presentation = getMatchPresentation(match);
  if (presentation.score) {
    fitFont(ctx, presentation.score, layout.scoreMaxWidth, gta ? 34 : 25, 15, 'Oxanium', '700');
    ctx.strokeText(presentation.score, layout.scoreX, y); ctx.fillText(presentation.score, layout.scoreX, y);
  }
}
async function renderMatches({ group }, gta) {
  const layout = gta ? GTA_LAYOUT : LAYOUT;
  const background = await loadBackground(gta ? GTA_BACKGROUND : BACKGROUND);
  const canvas = getCanvasApi().createCanvas(layout.reference.width, layout.reference.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, layout.reference.width, layout.reference.height);
  const letter = String(group.groupKey || '').toUpperCase();
  const title = gta ? letter : `GRUPPE ${letter}`;
  fitFont(ctx, title, layout.title.maxWidth, gta ? 50 : 42, 22, 'Oxanium', '700');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 3;
  ctx.strokeText(title, layout.title.x, layout.title.y); ctx.fillText(title, layout.title.x, layout.title.y);
  const matches = gta
    ? [0, 1, 2].flatMap(day => [group.matchdays?.[day]?.matches?.[0], group.matchdays?.[day]?.matches?.[1]])
    : orderedMatches(group);
  for (let index = 0; index < Math.min(matches.length, layout.rowsY.length); index += 1) {
    if (matches[index]) await drawMatch(ctx, matches[index], layout.rowsY[index], layout, gta);
  }
  return { buffer: canvas.toBuffer('image/png'), fileName: `loco-${gta ? 'gta-vi' : 'zwergen'}-cup-matches-${String(group.groupKey || 'group').toLowerCase()}.png`, width: layout.reference.width, height: layout.reference.height };
}

function generateLocoZwergenCupMatchesImage(data) {
  return renderMatches(data, false);
}

function generateLocoGtaCupMatchesImage(data) {
  return renderMatches(data, true);
}

module.exports = { generateLocoZwergenCupMatchesImage, generateLocoGtaCupMatchesImage };
