'use strict';

const path = require('path');
const LAYOUT = require('../config/group-schedule-layout');
const { findTeamById } = require('../src/domain/teams/team-service');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');
const { ensureCanvasFontsRegistered, setCanvasFont } = require('./canvas-fonts');

const TEMPLATE_PATH = path.resolve(__dirname, '..', 'assets', 'templates', 'group-schedule.png');
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
    templatePromise = getCanvasApi().loadImage(TEMPLATE_PATH).catch(error => {
      templatePromise = null;
      throw error;
    });
  }
  return templatePromise;
}

function fitTextToWidth(ctx, text, maxWidth, startFontSize, minFontSize, font) {
  for (let size = startFontSize; size >= minFontSize; size -= 1) {
    setCanvasFont(ctx, size, font.family, font.weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return minFontSize;
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let output = text;
  while (output.length && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

function drawFittedText({ ctx, text, x, y, maxWidth, maxFontSize, minFontSize, align, font, color }) {
  const clean = String(text || '').trim();
  const size = fitTextToWidth(ctx, clean, maxWidth, maxFontSize, minFontSize, font);
  setCanvasFont(ctx, size, font.family, font.weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(ellipsize(ctx, clean, maxWidth), x, y);
  return size;
}

function participantKey(participant) {
  if (!participant) return null;
  if (participant.participantKey) return participant.participantKey;
  if (participant.type === 'team') return `team:${participant.teamId}`;
  if (participant.type === 'bye') return `bye:${participant.byeId}`;
  return null;
}

function participantTeam(participant) {
  return participant?.type === 'team' ? findTeamById(participant.teamId) : null;
}

function participantName(participant) {
  if (!participant) return 'TBD';
  if (participant.type === 'bye') return 'FREILOS';
  return participantTeam(participant)?.clubName || participant.displayName || participant.teamId || 'TEAM';
}

function isByeMatch(match) {
  return match?.status === 'bye' || match?.home?.type === 'bye' || match?.away?.type === 'bye';
}

function normalizedScore(value) {
  if (!value) return null;
  const homeGoals = value.homeGoals ?? value.homeScore ?? value.score?.home ?? value.goals?.home;
  const awayGoals = value.awayGoals ?? value.awayScore ?? value.score?.away ?? value.goals?.away;
  if (!Number.isFinite(Number(homeGoals)) || !Number.isFinite(Number(awayGoals))) return null;
  return { homeGoals: Number(homeGoals), awayGoals: Number(awayGoals) };
}

function hasScore(value) {
  return Boolean(normalizedScore(value));
}

function scoreText(value) {
  const score = normalizedScore(value);
  return score ? `${score.homeGoals} : ${score.awayGoals}` : '';
}

function getMatchPresentation(match) {
  if (isByeMatch(match)) return { score: '', status: '', color: LAYOUT.colors.bye };
  if (match.status === 'confirmed' && hasScore(match.result)) {
    const admin = match.result.source === 'admin' || Boolean(match.adminDecision?.setByUserId);
    return { score: scoreText(match.result), status: '', color: admin ? LAYOUT.colors.admin : LAYOUT.colors.confirmed };
  }
  if (!match?.release?.releasedAt) return { score: '', status: '', color: LAYOUT.colors.notReleased };
  if (match.status === 'admin_decision_required') return { score: '', status: 'ERGEBNISSE WEICHEN AB', color: LAYOUT.colors.conflict };
  const reports = Array.isArray(match.reports) ? match.reports : [];
  if (reports.length === 1) {
    const reported = new Set(reports.map(report => report.participantKey));
    const waiting = [match.home, match.away].find(participant => participant?.type === 'team' && !reported.has(participantKey(participant)));
    return { score: scoreText(reports[0]), status: `WARTET AUF ${participantName(waiting).toUpperCase()}`, color: LAYOUT.colors.waiting };
  }
  return { score: '', status: '', color: LAYOUT.colors.notReported };
}

function scaleBox(box, scaleX, scaleY) {
  return { centerX: box.centerX * scaleX, centerY: box.centerY * scaleY, width: box.width * scaleX, height: box.height * scaleY };
}

function drawLogoFallback(ctx, box, scaleY) {
  const size = Math.max(18, LAYOUT.fonts.fallback.maxSize * scaleY);
  setCanvasFont(ctx, size, LAYOUT.fonts.fallback.family, LAYOUT.fonts.fallback.weight);
  ctx.fillStyle = LAYOUT.colors.fallback;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('X', box.centerX, box.centerY);
}

async function drawTeamLogoOrFallback({ ctx, participant, logoBox, scaleY }) {
  const team = participantTeam(participant);
  const logoSource = resolveTeamLogoPath(team, { optional: true });
  if (!logoSource) {
    drawLogoFallback(ctx, logoBox, scaleY);
    return false;
  }
  try {
    const logo = await getCanvasApi().loadImage(logoSource);
    const scale = Math.min(logoBox.width / logo.width, logoBox.height / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    ctx.drawImage(logo, logoBox.centerX - width / 2, logoBox.centerY - height / 2, width, height);
    return true;
  } catch (error) {
    console.warn(`[group-schedule] Logo fuer ${participantName(participant)} konnte nicht geladen werden.`, error.message);
    drawLogoFallback(ctx, logoBox, scaleY);
    return false;
  }
}

function drawDebug(ctx, row, index, scaleX, scaleY) {
  ctx.save();
  ctx.strokeStyle = LAYOUT.colors.debug;
  ctx.fillStyle = LAYOUT.colors.debug;
  ctx.lineWidth = Math.max(1, scaleX);
  for (const box of [row.leftLogo, row.rightLogo]) ctx.strokeRect(box.centerX - box.width / 2, box.centerY - box.height / 2, box.width, box.height);
  for (const point of [row.leftLogo, row.rightLogo, row.score]) {
    const x = point.centerX ?? point.x;
    const y = point.centerY ?? point.y;
    ctx.beginPath(); ctx.arc(x, y, 4 * scaleX, 0, Math.PI * 2); ctx.fill();
  }
  for (const name of [row.leftName, row.rightName]) ctx.strokeRect(name.align === 'right' ? name.x - name.maxWidth : name.x, name.y - 18 * scaleY, name.maxWidth, 36 * scaleY);
  setCanvasFont(ctx, 14 * scaleY, 'Open Sans', '700');
  ctx.textAlign = 'left'; ctx.fillText(String(index + 1), 12 * scaleX, row.centerY);
  ctx.restore();
}

function orderedMatches(group) {
  return (group.matchdays || []).flatMap(matchday => matchday.matches || []).slice(0, 6);
}

async function generateGroupScheduleImage({ group, debug = false, version = Date.now() }) {
  renderSequence = (renderSequence + 1) % 1000000;
  const template = await loadTemplate();
  const width = template.naturalWidth || template.width;
  const height = template.naturalHeight || template.height;
  if (!width || !height) throw new Error('Spielplan-Template besitzt keine gueltige Bildgroesse.');
  const scaleX = width / LAYOUT.reference.width;
  const scaleY = height / LAYOUT.reference.height;
  const { createCanvas } = getCanvasApi();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0, width, height);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4 * scaleY;

  drawFittedText({
    ctx, text: `GRUPPE ${String(group.groupKey || '').toUpperCase()}`,
    x: LAYOUT.groupName.x * scaleX, y: LAYOUT.groupName.y * scaleY, maxWidth: LAYOUT.groupName.maxWidth * scaleX,
    maxFontSize: LAYOUT.groupName.maxFontSize * scaleY, minFontSize: LAYOUT.groupName.minFontSize * scaleY,
    align: 'center', font: LAYOUT.fonts.title, color: LAYOUT.colors.text,
  });

  const matches = orderedMatches(group);
  for (let index = 0; index < LAYOUT.rows.length; index += 1) {
    const match = matches[index];
    if (!match) continue;
    const source = LAYOUT.rows[index];
    const row = {
      centerY: source.centerY * scaleY,
      leftLogo: scaleBox(source.leftLogo, scaleX, scaleY), rightLogo: scaleBox(source.rightLogo, scaleX, scaleY),
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
    if (debug) drawDebug(ctx, row, index, scaleX, scaleY);
  }
  ctx.shadowBlur = 0;
  return {
    buffer: canvas.toBuffer('image/png'),
    fileName: `group-schedule-${String(group.groupKey || 'group').toLowerCase()}-${version}-${renderSequence}.png`,
    width, height,
  };
}

module.exports = { drawFittedText, fitTextToWidth, generateGroupScheduleImage, getMatchPresentation, orderedMatches };
