'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../../storage');
const FC27_LAYOUT = require('../../../config/power-ranking-champion-fc27-layout');

let fontsRegistered = false;
const CHAMPION_TEMPLATE_PATH = 'assets/power-ranking/power-ranking-champion.png';

function registerFonts(canvas) {
  if (fontsRegistered) return;
  const fonts = [
    ['assets/fonts/BlackOpsOne-Regular.ttf', 'Black Ops One'],
    ['assets/fonts/RubikSprayPaint-Regular.ttf', 'Rubik Spray Paint'],
    ['assets/fonts/Oxanium-VariableFont_wght.ttf', 'Oxanium'],
    ['assets/fonts/OpenSans-VariableFont_wdth,wght.ttf', 'Open Sans'],
  ];
  for (const [relativePath, family] of fonts) {
    const absolutePath = path.resolve(ROOT_DIR, relativePath);
    if (fs.existsSync(absolutePath)) canvas.registerFont(absolutePath, { family });
  }
  fontsRegistered = true;
}

function resolveLogoPath(logoSnapshot) {
  if (!logoSnapshot?.fileName) return null;
  const fileName = path.basename(logoSnapshot.fileName);
  const candidates = [
    logoSnapshot.path && !String(logoSnapshot.path).includes('://') ? path.resolve(ROOT_DIR, logoSnapshot.path) : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function fittedFontSize(ctx, text, maxWidth, maximum, minimum = 24, family = 'Open Sans', weight = 700) {
  for (let size = maximum; size >= minimum; size -= 2) {
    ctx.font = `${weight} ${size}px "${family}"`;
    if (ctx.measureText(String(text)).width <= maxWidth) return size;
  }
  return minimum;
}

async function drawLogoOrPlaceholder(canvas, ctx, logoSnapshot, x, y, size) {
  const logoPath = resolveLogoPath(logoSnapshot);
  if (logoPath) {
    try {
      const image = await canvas.loadImage(logoPath);
      const scale = Math.min(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
      return 'logo';
    } catch (error) {
      console.warn(`[PowerRanking] Teamlogo konnte nicht geladen werden, Platzhalter wird verwendet: ${error.message}`);
    }
  }

  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(Math.PI / 4);
  const diamondSize = size * 0.48;
  const gradient = ctx.createLinearGradient(-diamondSize, -diamondSize, diamondSize, diamondSize);
  gradient.addColorStop(0, '#8cecff');
  gradient.addColorStop(0.5, '#247cff');
  gradient.addColorStop(1, '#7448ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 8;
  ctx.strokeRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
  ctx.restore();
  return 'placeholder';
}

function drawFc27Text(ctx, value, field, scaleX, scaleY, { family = 'Black Ops One', weight = 400 } = {}) {
  const text = String(value ?? '');
  const maximum = field.maxFontSize * scaleY;
  const minimum = field.minFontSize * scaleY;
  const fontSize = fittedFontSize(ctx, text, (field.width - 18) * scaleX, maximum, minimum, family, weight);
  ctx.font = `${weight} ${fontSize}px "${family}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, (field.x + field.width / 2) * scaleX, (field.y + field.height / 2) * scaleY);
}

async function renderFc27Champion(canvas, ctx, { week, champion, logoSnapshot, width, height }) {
  const scaleX = width / FC27_LAYOUT.reference.width;
  const scaleY = height / FC27_LAYOUT.reference.height;
  const logoSize = Math.min(FC27_LAYOUT.logo.width * scaleX, FC27_LAYOUT.logo.height * scaleY);
  await drawLogoOrPlaceholder(
    canvas,
    ctx,
    logoSnapshot,
    FC27_LAYOUT.logo.x * scaleX,
    FC27_LAYOUT.logo.y * scaleY,
    logoSize,
  );

  ctx.fillStyle = FC27_LAYOUT.textColor;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 8 * scaleY;
  drawFc27Text(ctx, champion.teamName, FC27_LAYOUT.teamName, scaleX, scaleY);
  ctx.shadowBlur = 0;
  drawFc27Text(ctx, champion.points, FC27_LAYOUT.points, scaleX, scaleY);
  drawFc27Text(ctx, champion.wins, FC27_LAYOUT.stats.wins, scaleX, scaleY);
  drawFc27Text(ctx, champion.finalAppearances, FC27_LAYOUT.stats.finalAppearances, scaleX, scaleY);
  drawFc27Text(ctx, champion.cups, FC27_LAYOUT.stats.cups, scaleX, scaleY);
  drawFc27Text(ctx, `KW ${week.calendarWeek}`, FC27_LAYOUT.calendarWeek, scaleX, scaleY, { family: 'Open Sans', weight: 700 });
  drawFc27Text(
    ctx,
    `${formatGermanDate(week.startsAt)} – ${formatGermanDate(week.endsAt)}`,
    FC27_LAYOUT.dateRange,
    scaleX,
    scaleY,
    { family: 'Open Sans', weight: 700 },
  );
}

async function renderChampionGraphic({ week, champion, logoSnapshot = null, variant = 'default' }) {
  const canvas = require('canvas');
  registerFonts(canvas);
  const isFc27 = variant === 'fc27';
  const templateRelativePath = isFc27 ? FC27_LAYOUT.template : CHAMPION_TEMPLATE_PATH;
  const templatePath = path.resolve(ROOT_DIR, templateRelativePath);
  if (!fs.existsSync(templatePath)) throw new Error(`Power-Ranking-Vorlage fehlt: ${templateRelativePath}`);
  const template = await canvas.loadImage(templatePath);
  const width = template.naturalWidth || template.width;
  const height = template.naturalHeight || template.height;
  const scaleX = width / 1254;
  const scaleY = height / 1254;
  const surface = canvas.createCanvas(width, height);
  const ctx = surface.getContext('2d');
  ctx.drawImage(template, 0, 0, width, height);

  if (isFc27) {
    await renderFc27Champion(canvas, ctx, { week, champion, logoSnapshot, width, height });
    return {
      buffer: surface.toBuffer('image/png'),
      fileName: `power-ranking-champion-fc27-${week.weekKey}.png`,
    };
  }

  await drawLogoOrPlaceholder(
    canvas,
    ctx,
    logoSnapshot,
    437 * scaleX,
    326 * scaleY,
    380 * Math.min(scaleX, scaleY),
  );

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe478';
  const nameSize = fittedFontSize(ctx, champion.teamName, 760 * scaleX, 50 * scaleY, 24 * scaleY, 'Black Ops One', 400);
  ctx.font = `400 ${nameSize}px "Black Ops One"`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 8 * scaleY;
  ctx.fillText(champion.teamName, 627 * scaleX, 782 * scaleY);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ffe478';
  ctx.font = `400 ${52 * scaleY}px "Black Ops One"`;
  ctx.fillText(String(champion.points), 627 * scaleX, 944 * scaleY);

  const stats = [
    { value: champion.wins, x: 287 },
    { value: champion.finalAppearances, x: 627 },
    { value: champion.cups, x: 968 },
  ];
  stats.forEach(stat => {
    ctx.fillStyle = '#ffe478';
    ctx.font = `400 ${42 * scaleY}px "Black Ops One"`;
    ctx.fillText(String(stat.value), stat.x * scaleX, 1090 * scaleY);
  });

  const weekText = `KW ${week.calendarWeek}  •  ${formatGermanDate(week.startsAt)} – ${formatGermanDate(week.endsAt)}`;
  ctx.fillStyle = '#ffe478';
  const weekSize = fittedFontSize(ctx, weekText, 650 * scaleX, 34 * scaleY, 20 * scaleY);
  ctx.font = `700 ${weekSize}px "Open Sans"`;
  ctx.textAlign = 'left';
  ctx.fillText(weekText, 455 * scaleX, 1194 * scaleY);

  return {
    buffer: surface.toBuffer('image/png'),
    fileName: `power-ranking-champion-${week.weekKey}.png`,
  };
}

function formatGermanDate(value) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

module.exports = { CHAMPION_TEMPLATE_PATH, renderChampionGraphic, resolveLogoPath };
