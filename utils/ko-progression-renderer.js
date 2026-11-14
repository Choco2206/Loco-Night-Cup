'use strict';

const path = require('path');
const { ROOT_DIR } = require('../src/storage');
const { findTeamById } = require('../src/domain/teams/team-service');
const { drawFittedText, drawTeamLogoOrFallback } = require('./generateGroupScheduleImage');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');
const { loadCanvasImage } = require('./canvas-image-loader');

const TEMPLATE = 'assets/ko-phase/ko-verlauf-16-fc27.jpeg';
const TEMPLATE_8 = 'assets/ko-phase/ko-verlauf-8-fc27.jpeg';
const TEMPLATE_4 = 'assets/ko-phase/ko-verlauf-4-fc27.jpeg';
const WIDTH = 1792;
const HEIGHT = 1344;
const RED = '#f12b45';
const BLUE = '#2684ff';
const GOLD = '#f1c54b';
const SILVER = '#b9c1ce';
const R16_Y = Object.freeze([180, 385, 590, 795]);
let canvasApi = null;
const templatePromises = new Map();
let renderSequence = 0;

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function loadTemplate(templatePath) {
  if (!templatePromises.has(templatePath)) {
    templatePromises.set(templatePath, loadCanvasImage(getCanvasApi(), path.resolve(ROOT_DIR, templatePath)).catch(error => {
      templatePromises.delete(templatePath);
      throw error;
    }));
  }
  return templatePromises.get(templatePath);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRounded(ctx, x, y, width, height, radius, fill, stroke = null, lineWidth = 1) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function participantName(participant) {
  if (!participant) return '';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || String(participant.teamId || '');
}

function resultFor(match) {
  if (!match?.result) return null;
  const home = Number(match.result.homeGoals);
  const away = Number(match.result.awayGoals);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

function winnerSide(match) {
  const score = resultFor(match);
  if (score) {
    if (score.home > score.away) return 'home';
    if (score.away > score.home) return 'away';
  }
  const winnerKey = match?.winner?.participantKey;
  if (winnerKey && winnerKey === match?.home?.participantKey) return 'home';
  if (winnerKey && winnerKey === match?.away?.participantKey) return 'away';
  return null;
}

function winnerParticipant(match) {
  const side = winnerSide(match);
  return side ? match?.[side] : match?.winner || null;
}

function drawConnector(ctx, points, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
  ctx.restore();
}

function drawConnectors16(ctx) {
  R16_Y.map(y => y + 62).forEach((sourceY, index) => {
    const targetY = index < 2 ? 408 : 728;
    drawConnector(ctx, [[304, sourceY], [327, sourceY], [327, targetY], [348, targetY]], RED);
    drawConnector(ctx, [[1488, sourceY], [1465, sourceY], [1465, targetY], [1444, targetY]], BLUE);
  });
  for (const sourceY of [408, 728]) {
    drawConnector(ctx, [[602, sourceY], [622, sourceY], [622, 568], [640, 568]], RED);
    drawConnector(ctx, [[1190, sourceY], [1170, sourceY], [1170, 568], [1152, 568]], BLUE);
  }
  drawConnector(ctx, [[874, 568], [896, 568], [896, 760]], GOLD);
  drawConnector(ctx, [[918, 568], [896, 568]], GOLD);
}

function drawConnectors8(ctx) {
  for (const sourceY of [312, 712]) {
    drawConnector(ctx, [[390, sourceY], [425, sourceY], [425, 522], [460, 522]], RED);
    drawConnector(ctx, [[1402, sourceY], [1367, sourceY], [1367, 522], [1332, 522]], BLUE);
  }
  drawConnector(ctx, [[760, 522], [896, 522], [896, 770]], GOLD);
  drawConnector(ctx, [[1032, 522], [896, 522]], GOLD);
}

function drawConnectors4(ctx) {
  drawConnector(ctx, [[640, 482], [896, 482], [896, 770]], GOLD);
  drawConnector(ctx, [[1152, 482], [896, 482]], GOLD);
}

function drawLabel(ctx, text, x, y, width) {
  drawFittedText({
    ctx, text, x, y, maxWidth: width, maxFontSize: 13, minFontSize: 9, align: 'center',
    font: { family: 'Oxanium', weight: '800' }, color: '#eef3fb',
  });
}

async function drawTeamRow(ctx, { participant, score, x, y, width, color, winner }) {
  const border = winner ? GOLD : color;
  fillRounded(ctx, x + 7, y, width - 14, 43, 8, winner ? 'rgba(24,24,19,.96)' : 'rgba(7,16,27,.96)', border, winner ? 2 : 1);
  const logoBox = { centerX: x + 29, centerY: y + 21.5, width: 31, height: 31 };
  ctx.save();
  roundedRect(ctx, logoBox.centerX - 16, logoBox.centerY - 16, 32, 32, 16);
  ctx.fillStyle = '#091321';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();
  if (participant) await drawTeamLogoOrFallback({ ctx, participant, logoBox, scaleY: 1 });
  ctx.restore();

  drawFittedText({
    ctx, text: participantName(participant), x: x + 52, y: y + 22, maxWidth: width - 116,
    maxFontSize: 17, minFontSize: 10, align: 'left', font: { family: 'Oxanium', weight: winner ? '800' : '650' },
    color: winner ? '#ffe899' : '#e8edf5',
  });
  if (score !== null && score !== undefined) {
    fillRounded(ctx, x + width - 56, y + 7, 34, 29, 7, winner ? '#d6a923' : '#142137', border, 1);
    drawFittedText({
      ctx, text: String(score), x: x + width - 39, y: y + 22, maxWidth: 26,
      maxFontSize: 18, minFontSize: 12, align: 'center', font: { family: 'Oxanium', weight: '900' }, color: '#fff',
    });
  }
}

async function drawMatchCard(ctx, { match, x, y, width, label, color, final = false }) {
  const height = final ? 168 : 125;
  fillRounded(ctx, x, y, width, height, final ? 18 : 13, 'rgba(2,7,17,.94)', color, final ? 3 : 2);
  fillRounded(ctx, x + 1, y + 1, width - 2, final ? 38 : 28, final ? 17 : 12, final ? '#d5aa35' : `${color}2e`);
  drawFittedText({
    ctx, text: label, x: x + width / 2, y: y + (final ? 21 : 15), maxWidth: width - 20,
    maxFontSize: final ? 18 : 13, minFontSize: 9, align: 'center',
    font: { family: 'Oxanium', weight: '900' }, color: final ? '#171000' : '#eef3fb',
  });
  const score = resultFor(match);
  const winner = winnerSide(match);
  const firstY = y + (final ? 46 : 31);
  await drawTeamRow(ctx, { participant: match?.home, score: score?.home ?? null, x, y: firstY, width, color, winner: winner === 'home' });
  await drawTeamRow(ctx, { participant: match?.away, score: score?.away ?? null, x, y: firstY + (final ? 49 : 47), width, color, winner: winner === 'away' });
}

function roundMatches(rounds, key) {
  const value = rounds?.[key];
  return Array.isArray(value) ? value : value?.matches || [];
}

async function drawChampion(ctx, participant) {
  fillRounded(ctx, 768, 950, 256, 72, 0, 'rgba(7,11,16,.97)', GOLD, 2);
  drawLabel(ctx, 'TURNIERSIEGER', 896, 976, 210);
  drawFittedText({
    ctx, text: participantName(participant), x: 896, y: 1003, maxWidth: 220, maxFontSize: 26, minFontSize: 12,
    align: 'center', font: { family: 'Oxanium', weight: '900' }, color: '#ffe58a',
  });
}

async function drawThirdPlace(ctx, match) {
  const x = 624; const y = 1082; const width = 544;
  fillRounded(ctx, x, y, width, 146, 17, 'rgba(3,7,13,.97)', SILVER, 2);
  fillRounded(ctx, x + 1, y + 1, width - 2, 36, 16, 'rgba(216,222,232,.14)');
  drawFittedText({ ctx, text: 'SPIEL UM PLATZ 3', x: 896, y: 1103, maxWidth: 500, maxFontSize: 17, minFontSize: 12, align: 'center', font: { family: 'Oxanium', weight: '850' }, color: '#fff' });
  const score = resultFor(match);
  const winner = winnerSide(match);
  await drawTeamRow(ctx, { participant: match?.home, score: score?.home ?? null, x: 635, y: 1131, width: 522, color: SILVER, winner: winner === 'home' });
  await drawTeamRow(ctx, { participant: match?.away, score: score?.away ?? null, x: 635, y: 1176, width: 522, color: SILVER, winner: winner === 'away' });
}

function drawSerial(ctx, serialNumber) {
  if (serialNumber === null || serialNumber === undefined || serialNumber === '') return;
  fillRounded(ctx, 1548, 1244, 174, 67, 14, 'rgba(5,9,16,.96)', GOLD, 2);
  drawFittedText({
    ctx, text: `#${serialNumber}`, x: 1635, y: 1278, maxWidth: 150, maxFontSize: 40, minFontSize: 18,
    align: 'center', font: { family: 'Oxanium', weight: '900' }, color: '#ffe68a',
  });
}

async function renderKoProgression16({ rounds, serialNumber = null, eventId = 'event', version = Date.now() }) {
  const template = await loadTemplate(TEMPLATE);
  const canvas = getCanvasApi().createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);
  drawConnectors16(ctx);

  const roundOf16 = roundMatches(rounds, 'round_of_16');
  for (let index = 0; index < 4; index += 1) {
    await drawMatchCard(ctx, { match: roundOf16[index], x: 42, y: R16_Y[index], width: 262, label: `ACHTELFINALE ${index + 1}`, color: RED });
    await drawMatchCard(ctx, { match: roundOf16[index + 4], x: 1488, y: R16_Y[index], width: 262, label: `ACHTELFINALE ${index + 5}`, color: BLUE });
  }
  const quarters = roundMatches(rounds, 'quarter_final');
  await drawMatchCard(ctx, { match: quarters[0], x: 348, y: 346, width: 254, label: 'VIERTELFINALE 1', color: RED });
  await drawMatchCard(ctx, { match: quarters[1], x: 348, y: 666, width: 254, label: 'VIERTELFINALE 2', color: RED });
  await drawMatchCard(ctx, { match: quarters[2], x: 1190, y: 346, width: 254, label: 'VIERTELFINALE 3', color: BLUE });
  await drawMatchCard(ctx, { match: quarters[3], x: 1190, y: 666, width: 254, label: 'VIERTELFINALE 4', color: BLUE });
  const semis = roundMatches(rounds, 'semi_final');
  await drawMatchCard(ctx, { match: semis[0], x: 640, y: 506, width: 234, label: 'HALBFINALE 1', color: RED });
  await drawMatchCard(ctx, { match: semis[1], x: 918, y: 506, width: 234, label: 'HALBFINALE 2', color: BLUE });
  const final = roundMatches(rounds, 'final')[0];
  await drawMatchCard(ctx, { match: final, x: 704, y: 760, width: 384, label: 'FINALE', color: GOLD, final: true });
  await drawChampion(ctx, winnerParticipant(final));
  await drawThirdPlace(ctx, roundMatches(rounds, 'third_place')[0]);
  drawSerial(ctx, serialNumber);

  renderSequence = (renderSequence + 1) % 1000000;
  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `ko-verlauf-${String(eventId).replace(/[^a-z0-9_-]+/gi, '-')}-${version}-${renderSequence}.png`,
    template: TEMPLATE,
    width: WIDTH,
    height: HEIGHT,
  };
}

async function renderKoProgression8({ rounds, serialNumber = null, eventId = 'event', version = Date.now() }) {
  const template = await loadTemplate(TEMPLATE_8);
  const canvas = getCanvasApi().createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);
  drawConnectors8(ctx);

  const quarters = roundMatches(rounds, 'quarter_final');
  await drawMatchCard(ctx, { match: quarters[0], x: 80, y: 250, width: 310, label: 'VIERTELFINALE 1', color: RED });
  await drawMatchCard(ctx, { match: quarters[1], x: 80, y: 650, width: 310, label: 'VIERTELFINALE 2', color: RED });
  await drawMatchCard(ctx, { match: quarters[2], x: 1402, y: 250, width: 310, label: 'VIERTELFINALE 3', color: BLUE });
  await drawMatchCard(ctx, { match: quarters[3], x: 1402, y: 650, width: 310, label: 'VIERTELFINALE 4', color: BLUE });
  const semis = roundMatches(rounds, 'semi_final');
  await drawMatchCard(ctx, { match: semis[0], x: 460, y: 460, width: 300, label: 'HALBFINALE 1', color: RED });
  await drawMatchCard(ctx, { match: semis[1], x: 1032, y: 460, width: 300, label: 'HALBFINALE 2', color: BLUE });
  const final = roundMatches(rounds, 'final')[0];
  await drawMatchCard(ctx, { match: final, x: 704, y: 770, width: 384, label: 'FINALE', color: GOLD, final: true });
  await drawChampion(ctx, winnerParticipant(final));
  await drawThirdPlace(ctx, roundMatches(rounds, 'third_place')[0]);
  drawSerial(ctx, serialNumber);

  renderSequence = (renderSequence + 1) % 1000000;
  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `ko-verlauf-8-${String(eventId).replace(/[^a-z0-9_-]+/gi, '-')}-${version}-${renderSequence}.png`,
    template: TEMPLATE_8,
    width: WIDTH,
    height: HEIGHT,
  };
}

async function renderKoProgression4({ rounds, serialNumber = null, eventId = 'event', version = Date.now() }) {
  const template = await loadTemplate(TEMPLATE_4);
  const canvas = getCanvasApi().createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);
  drawConnectors4(ctx);

  const semis = roundMatches(rounds, 'semi_final');
  await drawMatchCard(ctx, { match: semis[0], x: 300, y: 420, width: 340, label: 'HALBFINALE 1', color: RED });
  await drawMatchCard(ctx, { match: semis[1], x: 1152, y: 420, width: 340, label: 'HALBFINALE 2', color: BLUE });
  const final = roundMatches(rounds, 'final')[0];
  await drawMatchCard(ctx, { match: final, x: 704, y: 770, width: 384, label: 'FINALE', color: GOLD, final: true });
  await drawChampion(ctx, winnerParticipant(final));
  await drawThirdPlace(ctx, roundMatches(rounds, 'third_place')[0]);
  drawSerial(ctx, serialNumber);

  renderSequence = (renderSequence + 1) % 1000000;
  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `ko-verlauf-4-${String(eventId).replace(/[^a-z0-9_-]+/gi, '-')}-${version}-${renderSequence}.png`,
    template: TEMPLATE_4,
    width: WIDTH,
    height: HEIGHT,
  };
}

const CHRISTMAS_PROGRESSION_LAYOUTS = {
  quarter_final: { columns: [96, 930, 1764], cardWidth: 444, firstCenters: [365, 605, 845, 1085] },
  round_of_16: { columns: [70, 665, 1260, 1855], cardWidth: 379, firstCenters: [344, 458, 572, 686, 800, 914, 1028, 1142] },
  round_of_32: { columns: [56, 506, 956, 1406, 1856], cardWidth: 392, firstCenters: [
    330, 392, 454, 516, 578, 640, 702, 764, 826, 888, 950, 1012, 1074, 1136, 1198, 1260,
  ] },
};
const CHRISTMAS_ROUNDS = [
  ['round_of_32', 'SECHZEHNTELFINALE'], ['round_of_16', 'ACHTELFINALE'],
  ['quarter_final', 'VIERTELFINALE'], ['semi_final', 'HALBFINALE'], ['final', 'FINALE'],
];
const CHRISTMAS_TEMPLATE = 'assets/bomber-x-loco-christmas/road-to-glory.jpeg';

async function renderChristmasProgression({ firstRoundKey, rounds, version = Date.now() }) {
  const layout = CHRISTMAS_PROGRESSION_LAYOUTS[firstRoundKey];
  if (!layout) return null;
  const { columns, cardWidth, firstCenters } = layout;
  const width = 2304;
  const height = 1536;
  const canvas = getCanvasApi().createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await loadTemplate(CHRISTMAS_TEMPLATE), 0, 0, width, height);
  const stages = CHRISTMAS_ROUNDS.slice(-columns.length);
  const cardHeight = 57;
  let centers = firstCenters;
  for (const [index, [key, label]] of stages.entries()) {
    const x = columns[index];
    const color = key === 'final' ? GOLD : index % 2 ? BLUE : RED;
    fillRounded(ctx, x, 260, cardWidth, 34, 8, '#091321', color, 2);
    drawLabel(ctx, label, x + cardWidth / 2, 278, cardWidth - 16);
    const matches = roundMatches(rounds, key);
    const nextCenters = [];
    for (const [slot, y] of centers.entries()) {
      if (index + 1 < stages.length) {
        const target = (centers[slot - slot % 2] + centers[slot - slot % 2 + 1]) / 2;
        const nextX = columns[index + 1];
        const elbow = (x + cardWidth + nextX) / 2;
        drawConnector(ctx, [[x + cardWidth, y], [elbow, y], [elbow, target], [nextX, target]], color);
        if (slot % 2 === 0) nextCenters.push(target);
      }
      const match = matches[slot];
      const score = match?.status === 'confirmed' ? resultFor(match) : null;
      const winner = score ? winnerSide(match) : null;
      fillRounded(ctx, x, y - cardHeight / 2, cardWidth, cardHeight, 8, '#071223', color, 2);
      drawLabel(ctx, String(slot + 1).padStart(2, '0'), x + 19, y, 30);
      for (const [sideIndex, side] of ['home', 'away'].entries()) {
        const rowY = y + (sideIndex ? 15 : -15);
        const participant = match?.[side];
        const logoBox = { centerX: x + 53, centerY: rowY, width: 23, height: 23 };
        if (participant?.type === 'team') await drawTeamLogoOrFallback({ ctx, participant, logoBox, scaleY: 1 });
        drawFittedText({
          ctx, text: participantName(participant), x: x + 72, y: rowY, maxWidth: cardWidth - 132,
          maxFontSize: 20, minFontSize: 12, align: 'left',
          font: { family: 'Oxanium', weight: '700' }, color: winner === side ? '#ffe58a' : '#eef3fb',
        });
        fillRounded(ctx, x + cardWidth - 52, rowY - 12, 42, 24, 4, '#142137');
        if (score) drawLabel(ctx, String(score[side]), x + cardWidth - 31, rowY, 34);
      }
    }
    centers = nextCenters;
  }
  await drawMatchCard(ctx, {
    match: roundMatches(rounds, 'third_place')[0],
    x: columns.at(-1), y: 950, width: cardWidth, label: 'SPIEL UM PLATZ 3', color: '#cd8757',
  });
  return { buffer: canvas.toBuffer('image/png'), fileName: `christmas-road-to-glory-${firstCenters.length * 2}-${version}.png`, width, height };
}

module.exports = {
  TEMPLATE,
  TEMPLATE_4,
  TEMPLATE_8,
  resultFor,
  renderChristmasProgression,
  renderKoProgression4,
  renderKoProgression8,
  renderKoProgression16,
  winnerParticipant,
  winnerSide,
};
