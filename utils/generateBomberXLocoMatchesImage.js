'use strict';

const path = require('path');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

// Current Bomber X Loco matches artwork was measured directly at 1024 x 1535.
const WIDTH = 1024;
const HEIGHT = 1535;
const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'bomber-x-loco', 'matches.png');

// Five matchdays, three matches per matchday. Every coordinate below belongs
// specifically to matches.png and must not be reused by another template.
const LAYOUT = Object.freeze({
  // Free header area above Spieltag 1 for the group identifier.
  title: { x: 512, y: 548, maxWidth: 330 },

  // The artwork already prints SPIELTAG 1..5, so those labels are not redrawn.
  matchRowsY: Object.freeze([
    Object.freeze([624, 665, 706]),
    Object.freeze([799, 840, 880]),
    Object.freeze([974, 1015, 1055]),
    Object.freeze([1149, 1190, 1230]),
    Object.freeze([1324, 1365, 1405]),
  ]),

  // Each row is: orange home box | red score box | purple away box.
  homeLogoX: 166,
  homeNameX: 291,
  homeNameMaxWidth: 220,
  scoreX: 510,
  scoreMaxWidth: 116,
  awayNameX: 735,
  awayNameMaxWidth: 220,
  awayLogoX: 860,
  logoSize: 30,
});

let canvasApi = null;
let backgroundPromise = null;
const logoCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function setFont(ctx, size, family, weight = '400') {
  setCanvasFont(ctx, size, family, weight);
}

function loadBackground() {
  if (!backgroundPromise) {
    backgroundPromise = getCanvasApi().loadImage(BACKGROUND).catch(error => {
      backgroundPromise = null;
      throw error;
    });
  }
  return backgroundPromise;
}

function participantTeam(participant) {
  return participant?.type === 'team' ? findTeamById(participant.teamId) : null;
}

function participantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'FREILOS';
  return participantTeam(participant)?.clubName || participant.displayName || participant.teamId || 'TEAM';
}

async function loadLogo(participant) {
  const team = participantTeam(participant);
  if (!team) return null;
  const key = String(team.id);
  if (logoCache.has(key)) return logoCache.get(key);
  const logoPath = resolveTeamLogoPath(team, { optional: true });
  if (!logoPath) {
    logoCache.set(key, null);
    return null;
  }
  try {
    const image = await getCanvasApi().loadImage(logoPath);
    logoCache.set(key, image);
    return image;
  } catch {
    logoCache.set(key, null);
    return null;
  }
}

function fitFont(ctx, text, maxWidth, maxSize = 23, minSize = 12, family = 'Odibee Sans', weight = '400') {
  for (let size = maxSize; size >= minSize; size -= 1) {
    setFont(ctx, size, family, weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  setFont(ctx, minSize, family, weight);
  return minSize;
}

function drawLogo(ctx, image, x, y, size) {
  if (!image) return;
  const scale = Math.min(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
}

function normalizedScore(result) {
  if (!result) return null;
  const home = result.homeGoals ?? result.homeScore ?? result.score?.home ?? result.goals?.home;
  const away = result.awayGoals ?? result.awayScore ?? result.score?.away ?? result.goals?.away;
  if (!Number.isFinite(Number(home)) || !Number.isFinite(Number(away))) return null;
  return `${Number(home)} : ${Number(away)}`;
}

function drawTitle(ctx, groupKey) {
  const text = `GRUPPE ${String(groupKey || '').toUpperCase()}`;
  fitFont(ctx, text, LAYOUT.title.maxWidth, 30, 20, 'Oxanium', '700');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.shadowColor = 'rgba(255,170,40,0.7)';
  ctx.shadowBlur = 7;
  ctx.strokeText(text, LAYOUT.title.x, LAYOUT.title.y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, LAYOUT.title.x, LAYOUT.title.y);
  ctx.shadowBlur = 0;
}

async function drawMatch(ctx, match, y) {
  const homeName = participantName(match?.home);
  const awayName = participantName(match?.away);
  const [homeLogo, awayLogo] = await Promise.all([loadLogo(match?.home), loadLogo(match?.away)]);

  drawLogo(ctx, homeLogo, LAYOUT.homeLogoX, y, LAYOUT.logoSize);
  drawLogo(ctx, awayLogo, LAYOUT.awayLogoX, y, LAYOUT.logoSize);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 3;
  ctx.textBaseline = 'middle';

  fitFont(ctx, homeName, LAYOUT.homeNameMaxWidth, 22, 11);
  ctx.textAlign = 'center';
  ctx.fillText(homeName, LAYOUT.homeNameX, y);

  fitFont(ctx, awayName, LAYOUT.awayNameMaxWidth, 22, 11);
  ctx.textAlign = 'center';
  ctx.fillText(awayName, LAYOUT.awayNameX, y);

  const score = normalizedScore(match?.result);
  if (score && match?.status === 'confirmed') {
    fitFont(ctx, score, LAYOUT.scoreMaxWidth, 22, 14, 'Oxanium', '700');
    ctx.textAlign = 'center';
    ctx.fillText(score, LAYOUT.scoreX, y);
  }
  ctx.shadowBlur = 0;
}

async function generateBomberXLocoMatchesImage({ group }) {
  const background = await loadBackground();
  const { createCanvas } = getCanvasApi();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, WIDTH, HEIGHT);
  drawTitle(ctx, group.groupKey);

  const matchdays = (group.matchdays || []).slice(0, 5);
  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const matches = matchdays[dayIndex]?.matches || [];
    for (let matchIndex = 0; matchIndex < 3; matchIndex += 1) {
      const match = matches[matchIndex];
      if (!match) continue;
      await drawMatch(ctx, match, LAYOUT.matchRowsY[dayIndex][matchIndex]);
    }
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `bomber-x-loco-matches-${String(group.groupKey || 'group').toLowerCase()}.png`,
    width: WIDTH,
    height: HEIGHT,
  };
}

module.exports = {
  BOMBER_X_LOCO_MATCHES_LAYOUT: LAYOUT,
  generateBomberXLocoMatchesImage,
};
