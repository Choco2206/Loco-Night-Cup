'use strict';

const path = require('path');
const sharp = require('sharp');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');

// Current Bomber X Loco matches artwork was measured directly at 1024 x 1535.
const WIDTH = 1024;
const HEIGHT = 1535;
const BACKGROUNDS = Object.freeze({
  regular: path.resolve(__dirname, '..', 'assets', 'bomber-x-loco', 'matches.png'),
  halloween: path.resolve(__dirname, '..', 'assets', 'bomber-x-loco-halloween', 'matches-v4.jpeg'),
});

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

// Measured independently on the replacement 1024 x 1536 Halloween template.
// Five sections, exactly three rows each; the group label sits beside Spieltag 1.
const HALLOWEEN_LAYOUT = Object.freeze({
  title: { x: 810, y: 472, maxWidth: 180 },
  matchRowsY: Object.freeze([
    Object.freeze([518, 566, 612]),
    Object.freeze([718, 764, 810]),
    Object.freeze([918, 966, 1012]),
    Object.freeze([1128, 1176, 1224]),
    Object.freeze([1334, 1380, 1428]),
  ]),
  homeLogoX: 134,
  homeNameX: 306,
  homeNameMaxWidth: 282,
  scoreX: 512,
  scoreMaxWidth: 44,
  awayNameX: 716,
  awayNameMaxWidth: 280,
  awayLogoX: 890,
  logoSize: 28,
});

let canvasApi = null;
const backgroundPromises = new Map();
const logoCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function setFont(ctx, size, family, weight = '400') {
  setCanvasFont(ctx, size, family, weight);
}

function loadBackground(eventKey) {
  const variant = eventKey === 'bomber_halloween' ? 'halloween' : 'regular';
  if (!backgroundPromises.has(variant)) {
    const promise = (async () => {
      const source = BACKGROUNDS[variant];
      try {
        // Decode fully before handing PNG data to Cairo, whose error can
        // misleadingly report corrupt IDAT chunks as an allocation failure.
        const normalized = await sharp(source, { failOn: 'warning' }).png().toBuffer();
        return await getCanvasApi().loadImage(normalized);
      } catch (error) {
        throw new Error(`Spielplan-Vorlage ${path.basename(source)} kann nicht gelesen werden: ${error.message}`);
      }
    })().catch(error => {
      backgroundPromises.delete(variant);
      throw error;
    });
    backgroundPromises.set(variant, promise);
  }
  return backgroundPromises.get(variant);
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

function drawTitle(ctx, groupKey, layout) {
  const text = `GRUPPE ${String(groupKey || '').toUpperCase()}`;
  fitFont(ctx, text, layout.title.maxWidth, 30, 20, 'Oxanium', '700');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.shadowColor = 'rgba(255,170,40,0.7)';
  ctx.shadowBlur = 7;
  ctx.strokeText(text, layout.title.x, layout.title.y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, layout.title.x, layout.title.y);
  ctx.shadowBlur = 0;
}

async function drawMatch(ctx, match, y, layout) {
  const homeName = participantName(match?.home);
  const awayName = participantName(match?.away);
  const [homeLogo, awayLogo] = await Promise.all([loadLogo(match?.home), loadLogo(match?.away)]);

  drawLogo(ctx, homeLogo, layout.homeLogoX, y, layout.logoSize);
  drawLogo(ctx, awayLogo, layout.awayLogoX, y, layout.logoSize);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 3;
  ctx.textBaseline = 'middle';

  fitFont(ctx, homeName, layout.homeNameMaxWidth, 22, 11);
  ctx.textAlign = 'center';
  ctx.fillText(homeName, layout.homeNameX, y);

  fitFont(ctx, awayName, layout.awayNameMaxWidth, 22, 11);
  ctx.textAlign = 'center';
  ctx.fillText(awayName, layout.awayNameX, y);

  const score = normalizedScore(match?.result);
  if (score && match?.status === 'confirmed') {
    fitFont(ctx, score, layout.scoreMaxWidth, 22, 14, 'Oxanium', '700');
    ctx.textAlign = 'center';
    ctx.fillText(score, layout.scoreX, y);
  }
  ctx.shadowBlur = 0;
}

async function generateBomberXLocoMatchesImage({ group }) {
  const background = await loadBackground(group.eventKey);
  const { createCanvas } = getCanvasApi();
  const height = group.eventKey === 'bomber_halloween' ? 1536 : HEIGHT;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0, WIDTH, height);
  const layout = group.eventKey === 'bomber_halloween' ? HALLOWEEN_LAYOUT : LAYOUT;
  drawTitle(ctx, group.groupKey, layout);

  const matchdays = (group.matchdays || []).slice(0, 5);
  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const matches = matchdays[dayIndex]?.matches || [];
    for (let matchIndex = 0; matchIndex < 3; matchIndex += 1) {
      const match = matches[matchIndex];
      if (!match) continue;
      await drawMatch(ctx, match, layout.matchRowsY[dayIndex][matchIndex], layout);
    }
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `bomber-x-loco-matches-${String(group.groupKey || 'group').toLowerCase()}.png`,
    width: WIDTH,
    height,
  };
}

module.exports = {
  BOMBER_X_LOCO_MATCHES_LAYOUT: LAYOUT,
  BOMBER_X_LOCO_HALLOWEEN_MATCHES_LAYOUT: HALLOWEEN_LAYOUT,
  generateBomberXLocoMatchesImage,
};
