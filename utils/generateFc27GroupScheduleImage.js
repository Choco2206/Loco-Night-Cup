'use strict';

const path = require('path');
const LAYOUT = require('../config/group-schedule-fc27-layout');
const { findTeamById } = require('../src/domain/teams/team-service');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');
const { loadCanvasImage } = require('./canvas-image-loader');
const {
  drawFittedText,
  drawTeamLogoOrFallback,
  getMatchPresentation,
  orderedMatches,
} = require('./generateGroupScheduleImage');

const TEMPLATE_PATH = path.resolve(__dirname, '..', LAYOUT.template);
let canvasApi = null;
let templatePromise = null;
let renderSequence = 0;

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

function participantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'FREILOS';
  return findTeamById(participant.teamId)?.clubName || participant.displayName || participant.teamId || 'TEAM';
}

function scaleBox(box, scaleX, scaleY) {
  return {
    centerX: box.centerX * scaleX,
    centerY: box.centerY * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

async function generateFc27GroupScheduleImage({ group, version = Date.now() }) {
  renderSequence = (renderSequence + 1) % 1000000;
  const template = await loadTemplate();
  const width = template.naturalWidth || template.width;
  const height = template.naturalHeight || template.height;
  const scaleX = width / LAYOUT.reference.width;
  const scaleY = height / LAYOUT.reference.height;
  const canvas = getCanvasApi().createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, width, height);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4 * scaleY;

  drawFittedText({
    ctx,
    text: `GRUPPE ${String(group.groupKey || '').toUpperCase()}`,
    x: LAYOUT.groupName.x * scaleX,
    y: LAYOUT.groupName.y * scaleY,
    maxWidth: LAYOUT.groupName.maxWidth * scaleX,
    maxFontSize: LAYOUT.groupName.maxFontSize * scaleY,
    minFontSize: LAYOUT.groupName.minFontSize * scaleY,
    align: 'center',
    font: LAYOUT.fonts.title,
    color: LAYOUT.colors.text,
  });

  const matches = orderedMatches(group);
  for (let index = 0; index < LAYOUT.rows.length; index += 1) {
    const match = matches[index];
    if (!match) continue;
    const source = LAYOUT.rows[index];
    const row = {
      leftLogo: scaleBox(source.leftLogo, scaleX, scaleY),
      rightLogo: scaleBox(source.rightLogo, scaleX, scaleY),
      leftName: { ...source.leftName, x: source.leftName.x * scaleX, y: source.leftName.y * scaleY, maxWidth: source.leftName.maxWidth * scaleX },
      rightName: { ...source.rightName, x: source.rightName.x * scaleX, y: source.rightName.y * scaleY, maxWidth: source.rightName.maxWidth * scaleX },
      score: { ...source.score, x: source.score.x * scaleX, y: source.score.y * scaleY, maxWidth: source.score.maxWidth * scaleX },
      status: { ...source.status, x: source.status.x * scaleX, y: source.status.y * scaleY, maxWidth: source.status.maxWidth * scaleX },
    };

    await Promise.all([
      drawTeamLogoOrFallback({ ctx, participant: match.home, logoBox: row.leftLogo, scaleY }),
      drawTeamLogoOrFallback({ ctx, participant: match.away, logoBox: row.rightLogo, scaleY }),
    ]);
    drawFittedText({ ctx, text: participantName(match.home), ...row.leftName, maxFontSize: LAYOUT.fonts.team.maxSize * scaleY, minFontSize: LAYOUT.fonts.team.minSize * scaleY, font: LAYOUT.fonts.team, color: LAYOUT.colors.text });
    drawFittedText({ ctx, text: participantName(match.away), ...row.rightName, maxFontSize: LAYOUT.fonts.team.maxSize * scaleY, minFontSize: LAYOUT.fonts.team.minSize * scaleY, font: LAYOUT.fonts.team, color: LAYOUT.colors.text });
    const presentation = getMatchPresentation(match);
    if (presentation.score) drawFittedText({ ctx, text: presentation.score, ...row.score, maxFontSize: LAYOUT.fonts.score.maxSize * scaleY, minFontSize: LAYOUT.fonts.score.minSize * scaleY, align: 'center', font: LAYOUT.fonts.score, color: LAYOUT.colors.text });
    if (presentation.status) drawFittedText({ ctx, text: presentation.status, ...row.status, maxFontSize: LAYOUT.fonts.status.maxSize * scaleY, minFontSize: LAYOUT.fonts.status.minSize * scaleY, align: 'center', font: LAYOUT.fonts.status, color: presentation.color });
  }
  ctx.shadowBlur = 0;

  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `group-schedule-fc27-${String(group.groupKey || 'group').toLowerCase()}-${version}-${renderSequence}.png`,
    width,
    height,
  };
}

module.exports = { FC27_GROUP_SCHEDULE_LAYOUT: LAYOUT, generateFc27GroupScheduleImage };
