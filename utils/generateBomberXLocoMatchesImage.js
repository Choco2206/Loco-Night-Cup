'use strict';

const path = require('path');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

const WIDTH = 1600;
const HEIGHT = 900;
const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'bomber-x-loco', 'matches.png');

// Erste Vermessung der Bomber-X-Loco-Vorlage.
// Wird spaeter mit dem Admin-Test feinjustiert.
const LAYOUT = Object.freeze({
  title: { x: 800, y: 170 },
  matchdayTitleY: [286, 410, 534, 658, 782],
  columnsX: [255, 800, 1345],
  teamGap: 74,
  logoSize: 46,
  teamMaxWidth: 190,
  scoreMaxWidth: 115,
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

function fitFont(ctx, text, maxWidth, maxSize = 28, minSize = 15, family = 'Odibee Sans', weight = '400') {
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
  setFont(ctx, 72, 'Oxanium', '700');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.shadowColor = 'rgba(255,170,40,0.82)';
  ctx.shadowBlur = 18;
  ctx.strokeText(text, LAYOUT.title.x, LAYOUT.title.y);
  const gradient = ctx.createLinearGradient(560, LAYOUT.title.y, 1040, LAYOUT.title.y);
  gradient.addColorStop(0, '#f6b343');
  gradient.addColorStop(0.5, '#ffffff');
  gradient.addColorStop(1, '#c58a2b');
  ctx.fillStyle = gradient;
  ctx.fillText(text, LAYOUT.title.x, LAYOUT.title.y);
  ctx.shadowBlur = 0;
}

function drawMatchdayTitle(ctx, matchdayNumber, y) {
  setFont(ctx, 25, 'Oxanium', '700');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4;
  ctx.fillText(`SPIELTAG ${matchdayNumber}`, 800, y - 42);
  ctx.shadowBlur = 0;
}

async function drawMatch(ctx, match, x, y) {
  const homeName = participantName(match?.home);
  const awayName = participantName(match?.away);
  const [homeLogo, awayLogo] = await Promise.all([loadLogo(match?.home), loadLogo(match?.away)]);
  const leftLogoX = x - 218;
  const rightLogoX = x + 218;
  drawLogo(ctx, homeLogo, leftLogoX, y, LAYOUT.logoSize);
  drawLogo(ctx, awayLogo, rightLogoX, y, LAYOUT.logoSize);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 4;
  fitFont(ctx, homeName, LAYOUT.teamMaxWidth, 28, 14);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(homeName, x - LAYOUT.teamGap, y);

  fitFont(ctx, awayName, LAYOUT.teamMaxWidth, 28, 14);
  ctx.textAlign = 'left';
  ctx.fillText(awayName, x + LAYOUT.teamGap, y);

  const score = normalizedScore(match?.result);
  if (score && match?.status === 'confirmed') {
    fitFont(ctx, score, LAYOUT.scoreMaxWidth, 32, 20, 'Oxanium', '700');
    ctx.textAlign = 'center';
    ctx.fillText(score, x, y);
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
    const y = LAYOUT.matchdayTitleY[dayIndex];
    drawMatchdayTitle(ctx, dayIndex + 1, y);
    const matches = matchdays[dayIndex]?.matches || [];
    for (let matchIndex = 0; matchIndex < 3; matchIndex += 1) {
      const match = matches[matchIndex];
      if (!match) continue;
      await drawMatch(ctx, match, LAYOUT.columnsX[matchIndex], y);
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
