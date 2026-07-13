'use strict';

const path = require('path');
const LAYOUTS = require('../config/ko-image-layouts');
const { ROOT_DIR } = require('../src/storage');
const { findTeamById } = require('../src/domain/teams/team-service');
const { drawFittedText, drawTeamLogoOrFallback } = require('./generateGroupScheduleImage');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');

let canvasApi = null;
let renderSequence = 0;
const templateCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function getKoTemplate({ phase, qualifiedTeamCount }) {
  if (phase === 'qualification_overview') {
    if (![4, 8, 16].includes(Number(qualifiedTeamCount))) throw new Error(`Keine K.O.-Uebersicht fuer ${qualifiedTeamCount} Teams.`);
    return `qualification_${Number(qualifiedTeamCount)}`;
  }
  if (!['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'].includes(phase)) {
    throw new Error(`Unbekannte K.O.-Bildphase: ${phase}`);
  }
  return phase;
}

function getKoLayout(options) {
  const key = getKoTemplate(options);
  const layout = LAYOUTS[key];
  if (!layout) throw new Error(`K.O.-Layout fehlt: ${key}`);
  return { key, layout };
}

function loadTemplate(templatePath) {
  const absolute = path.resolve(ROOT_DIR, templatePath);
  if (!templateCache.has(absolute)) {
    templateCache.set(absolute, getCanvasApi().loadImage(absolute).catch(error => {
      templateCache.delete(absolute);
      throw error;
    }));
  }
  return templateCache.get(absolute);
}

function asParticipant(entry) {
  if (!entry) return null;
  if (entry.type) return entry;
  return { type: 'team', teamId: entry.teamId, displayName: entry.displayName, participantKey: `team:${entry.teamId}` };
}

function participantName(participant) {
  if (!participant || participant.type === 'placeholder') return '';
  if (participant.type === 'bye') return 'Freilos';
  return participant.displayName || findTeamById(participant.teamId)?.clubName || participant.teamId || '';
}

function scaleBox(box, scaleX, scaleY) {
  return {
    centerX: box.centerX * scaleX, centerY: box.centerY * scaleY,
    width: box.width * scaleX, height: box.height * scaleY,
  };
}

function scaleTextBox(box, scaleX, scaleY) {
  return { ...box, x: box.x * scaleX, y: box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY };
}

async function drawParticipant(ctx, participantValue, slot, scaleX, scaleY) {
  const participant = asParticipant(participantValue);
  const name = participantName(participant);
  if (!name) return;
  if (participant?.type === 'team') {
    await drawTeamLogoOrFallback({ ctx, participant, logoBox: scaleBox(slot.logo, scaleX, scaleY), scaleY });
  }
  const box = scaleTextBox(slot.teamName, scaleX, scaleY);
  drawFittedText({
    ctx, text: name, x: box.x, y: box.y, maxWidth: box.width,
    maxFontSize: (slot.teamName.fontSize || LAYOUTS.fonts.team.maxSize) * scaleY,
    minFontSize: LAYOUTS.fonts.team.minSize * scaleY,
    align: box.align || 'left', font: LAYOUTS.fonts.team, color: LAYOUTS.colors.text,
  });
}

function officialScore(match) {
  if (match?.status !== 'confirmed' || !match.result) return null;
  const home = Number(match.result.homeGoals);
  const away = Number(match.result.awayGoals);
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

function drawScore(ctx, value, box, scaleX, scaleY) {
  drawFittedText({
    ctx, text: String(value), x: box.x * scaleX, y: box.y * scaleY,
    maxWidth: box.width * scaleX,
    maxFontSize: LAYOUTS.fonts.score.maxSize * scaleY,
    minFontSize: LAYOUTS.fonts.score.minSize * scaleY,
    align: 'center', font: LAYOUTS.fonts.score, color: LAYOUTS.colors.text,
  });
}

async function renderKoImage({ phase, qualifiedTeams = [], matches = [], eventId = 'event', version = Date.now() }) {
  const { key, layout } = getKoLayout({ phase, qualifiedTeamCount: qualifiedTeams.length });
  const template = await loadTemplate(layout.template);
  const width = template.naturalWidth || template.width;
  const height = template.naturalHeight || template.height;
  const scaleX = width / layout.reference.width;
  const scaleY = height / layout.reference.height;
  const canvas = getCanvasApi().createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, width, height);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4 * scaleY;

  if (layout.kind === 'qualification') {
    for (let index = 0; index < layout.slots.length; index += 1) {
      await drawParticipant(ctx, qualifiedTeams[index], layout.slots[index], scaleX, scaleY);
    }
  } else {
    for (let index = 0; index < layout.matches.length; index += 1) {
      const match = matches[index];
      if (!match) continue;
      const slot = layout.matches[index];
      await drawParticipant(ctx, match.home, slot.home, scaleX, scaleY);
      await drawParticipant(ctx, match.away, slot.away, scaleX, scaleY);
      const score = officialScore(match);
      if (score) {
        drawScore(ctx, `${score.home}:${score.away}`, slot.score, scaleX, scaleY);
      }
    }
  }

  renderSequence = (renderSequence + 1) % 1000000;
  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `ko-${String(eventId).replace(/[^a-z0-9_-]+/gi, '-')}-${key}-${version}-${renderSequence}.png`,
    template: layout.template,
    width,
    height,
  };
}

module.exports = { getKoLayout, getKoTemplate, officialScore, renderKoImage };

