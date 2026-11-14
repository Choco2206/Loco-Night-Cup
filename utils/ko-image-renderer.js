'use strict';

const path = require('path');
const LAYOUTS = require('../config/ko-image-layouts');
const CHRISTMAS_LAYOUTS = require('../config/bomber-x-loco-christmas-ko-image-layouts');
const FC27_LAYOUTS = require('../config/ko-image-layouts-fc27');
const BOMBER_X_LOCO_LAYOUTS = require('../config/bomber-x-loco-ko-image-layouts');
const BOMBER_X_LOCO_HALLOWEEN_LAYOUTS = require('../config/bomber-x-loco-halloween-ko-image-layouts');
const LOCO_ZWERGEN_CUP_LAYOUTS = require('../config/loco-zwergen-cup-ko-image-layouts');
const { ROOT_DIR } = require('../src/storage');
const { findTeamById } = require('../src/domain/teams/team-service');
const { drawFittedText, drawTeamLogoOrFallback } = require('./generateGroupScheduleImage');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');
const { loadCanvasImage } = require('./canvas-image-loader');

const { HALLOWEEN_EVENT_KEY, SEASONAL_CUP, isHalloweenCycle, isBomberXLocoDate } = require('../src/domain/events/bomber-x-loco-config');
const LOCO_ZWERGEN_CUP_CYCLE_KEY = 'saturday_2026-09-12';
let canvasApi = null;
let renderSequence = 0;
const templateCache = new Map();

function getCanvasApi() {
  if (!canvasApi) canvasApi = require('canvas');
  ensureCanvasFontsRegistered(canvasApi);
  return canvasApi;
}

function isBomberXLocoRender(eventId) {
  const [, eventKey, eventDate] = /^(.*)_(\d{4}-\d{2}-\d{2})$/.exec(String(eventId || '')) || [];
  return isHalloweenCycle(eventId) || isBomberXLocoDate(eventKey, eventDate);
}

function isLocoZwergenCupRender(eventId) {
  return String(eventId || '') === LOCO_ZWERGEN_CUP_CYCLE_KEY;
}

function isChristmasCycle(eventId) {
  return SEASONAL_CUP.theme === 'christmas'
    && eventId === `${HALLOWEEN_EVENT_KEY}_${SEASONAL_CUP.date}`;
}

function getKoTemplate({ phase, qualifiedTeamCount, eventId = null }) {
  const bomberXLoco = isBomberXLocoRender(eventId);
  const locoZwergenCup = isLocoZwergenCupRender(eventId);
  if (phase === 'qualification_overview') {
    if (![4, 8, 16].includes(Number(qualifiedTeamCount))
      && !(isChristmasCycle(eventId) && Number(qualifiedTeamCount) === 32)) throw new Error(`Keine K.O.-Uebersicht fuer ${qualifiedTeamCount} Teams.`);
    return `qualification_${Number(qualifiedTeamCount)}`;
  }

  if ((bomberXLoco || locoZwergenCup) && ['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'].includes(phase)) {
    return phase;
  }

  if (![
    'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final',
  ].includes(phase)) {
    throw new Error(`Unbekannte K.O.-Bildphase: ${phase}`);
  }
  return phase;
}

function getKoLayout(options) {
  const key = getKoTemplate(options);
  let layouts = LAYOUTS;
  if (isHalloweenCycle(options.eventId) && BOMBER_X_LOCO_HALLOWEEN_LAYOUTS[key]) layouts = BOMBER_X_LOCO_HALLOWEEN_LAYOUTS;
  else if (isChristmasCycle(options.eventId) && CHRISTMAS_LAYOUTS[key]) layouts = CHRISTMAS_LAYOUTS;
  else if (options.variant === 'fc27' && FC27_LAYOUTS[key]) layouts = FC27_LAYOUTS;
  else if (isBomberXLocoRender(options.eventId) && BOMBER_X_LOCO_LAYOUTS[key]) layouts = BOMBER_X_LOCO_LAYOUTS;
  else if (isLocoZwergenCupRender(options.eventId) && LOCO_ZWERGEN_CUP_LAYOUTS[key]) layouts = LOCO_ZWERGEN_CUP_LAYOUTS;
  const layout = layouts[key];
  if (!layout) throw new Error(`K.O.-Layout fehlt: ${key}`);
  return { key, layout, layouts };
}

function loadTemplate(templatePath) {
  const absolute = path.resolve(ROOT_DIR, templatePath);
  if (!templateCache.has(absolute)) {
    templateCache.set(absolute, loadCanvasImage(getCanvasApi(), absolute).catch(error => {
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
  if (!participant) return '';
  if (participant.type === 'placeholder') return participant.displayName || '';
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

async function drawParticipant(ctx, participantValue, slot, scaleX, scaleY, layouts) {
  const participant = asParticipant(participantValue);
  const name = participantName(participant);
  if (!name) return;
  if (participant?.type === 'team') {
    await drawTeamLogoOrFallback({ ctx, participant, logoBox: scaleBox(slot.logo, scaleX, scaleY), scaleY });
  }
  const box = scaleTextBox(slot.teamName, scaleX, scaleY);
  drawFittedText({
    ctx, text: name, x: box.x, y: box.y, maxWidth: box.width,
    maxFontSize: (slot.teamName.fontSize || layouts.fonts.team.maxSize) * scaleY,
    minFontSize: layouts.fonts.team.minSize * scaleY,
    align: box.align || 'left', font: layouts.fonts.team, color: layouts.colors.text,
  });
}

function officialScore(match) {
  if (match?.status !== 'confirmed' || !match.result) return null;
  const home = Number(match.result.homeGoals);
  const away = Number(match.result.awayGoals);
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

function drawScore(ctx, value, box, scaleX, scaleY, layouts) {
  drawFittedText({
    ctx, text: String(value), x: box.x * scaleX, y: box.y * scaleY,
    maxWidth: box.width * scaleX,
    maxFontSize: layouts.fonts.score.maxSize * scaleY,
    minFontSize: layouts.fonts.score.minSize * scaleY,
    align: 'center', font: layouts.fonts.score, color: layouts.colors.text,
  });
}

async function renderKoImage({ phase, qualifiedTeams = [], matches = [], eventId = 'event', version = Date.now(), variant = null }) {
  const { key, layout, layouts } = getKoLayout({ phase, qualifiedTeamCount: qualifiedTeams.length, eventId, variant });
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
      await drawParticipant(ctx, qualifiedTeams[index], layout.slots[index], scaleX, scaleY, layouts);
    }
  } else {
    for (let index = 0; index < layout.matches.length; index += 1) {
      const match = matches[index];
      if (!match) continue;
      const slot = layout.matches[index];
      await drawParticipant(ctx, match.home, slot.home, scaleX, scaleY, layouts);
      await drawParticipant(ctx, match.away, slot.away, scaleX, scaleY, layouts);
      const score = officialScore(match);
      if (score && layout.splitScore) {
        drawScore(ctx, score.home, slot.score.home, scaleX, scaleY, layouts);
        drawScore(ctx, score.away, slot.score.away, scaleX, scaleY, layouts);
      } else if (score) {
        drawScore(ctx, `${score.home}:${score.away}`, slot.score, scaleX, scaleY, layouts);
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
