'use strict';

const path = require('path');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

const WIDTH = 1600;
const HEIGHT = 900;
const BACKGROUND = path.resolve(__dirname, '..', 'assets', 'bomber-x-loco', 'matches.png');

// Die Vorlage ist als 5 Spieltage mit jeweils 3 horizontalen Begegnungszeilen aufgebaut.
// Pro Begegnung gibt es genau EIN linkes Teamfeld, EIN Ergebnisfeld in der Mitte
// und EIN rechtes Teamfeld. Die Begegnungen werden deshalb vertikal in den
// jeweiligen Spieltagsblock geschrieben und nicht nebeneinander verteilt.
const LAYOUT = Object.freeze({
  title: { x: 800, y: 203, maxWidth: 360 },
  matchdayTitleY: [244, 368, 492, 616, 740],
  matchRowsY: [
    [276, 307, 338],
    [400, 431, 462],
    [524, 555, 586],
    [648, 679, 710],
    [772, 803, 834],
  ],
  scoreX: 800,
  homeLogoX: 258,
  homeNameX: 478,
  awayNameX: 1122,
  awayLogoX: 1342,
  logoSize: 34,
  teamMaxWidth: 330,
  scoreMaxWidth: 105,
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
  fitFont(ctx, text, LAYOUT.title.maxWidth, 38, 26, 'Oxanium', '700');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.shadowColor = 'rgba(255,170,40,0.7)';
  ctx.shadowBlur = 9;
  ctx.strokeText(text, LAYOUT.title.x, LAYOUT.title.y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, LAYOUT.title.x, LAYOUT.title.y);
  ctx.shadowBlur = 0;
}

function drawMatchdayTitle(ctx, matchdayNumber, y) {
  setFont(ctx, 22, 'Oxanium', '700');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4;
  ctx.fillText(`SPIELTAG ${matchdayNumber}`, 800, y);
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
  ctx.shadowBlur = 4;
  ctx.textBaseline = 'middle';

  fitFont(ctx, homeName, LAYOUT.teamMaxWidth, 25, 13);
  ctx.textAlign = 'center';
  ctx.fillText(homeName, LAYOUT.homeNameX, y);

  fitFont(ctx, awayName, LAYOUT.teamMaxWidth, 25, 13);
  ctx.textAlign = 'center';
  ctx.fillText(awayName, LAYOUT.awayNameX, y);

  const score = normalizedScore(match?.result);
  if (score && match?.status === 'confirmed') {
    fitFont(ctx, score, LAYOUT.scoreMaxWidth, 26, 17, 'Oxanium', '700');
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
    drawMatchdayTitle(ctx, dayIndex + 1, LAYOUT.matchdayTitleY[dayIndex]);
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
