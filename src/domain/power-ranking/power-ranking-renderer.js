'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../../storage');

let fontsRegistered = false;
const CHAMPION_TEMPLATE_PATH = 'assets/power-ranking/power-ranking-champion.png';

function registerFonts(canvas) {
  if (fontsRegistered) return;
  const fonts = [
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

function fittedFontSize(ctx, text, maxWidth, maximum, minimum = 24) {
  for (let size = maximum; size >= minimum; size -= 2) {
    ctx.font = `700 ${size}px "Open Sans"`;
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

async function renderChampionGraphic({ week, champion, logoSnapshot = null }) {
  const canvas = require('canvas');
  registerFonts(canvas);
  const templatePath = path.resolve(ROOT_DIR, CHAMPION_TEMPLATE_PATH);
  if (!fs.existsSync(templatePath)) throw new Error(`Power-Ranking-Vorlage fehlt: ${CHAMPION_TEMPLATE_PATH}`);
  const template = await canvas.loadImage(templatePath);
  const width = template.naturalWidth || template.width;
  const height = template.naturalHeight || template.height;
  const scaleX = width / 1254;
  const scaleY = height / 1254;
  const surface = canvas.createCanvas(width, height);
  const ctx = surface.getContext('2d');
  ctx.drawImage(template, 0, 0, width, height);

  await drawLogoOrPlaceholder(
    canvas,
    ctx,
    logoSnapshot,
    437 * scaleX,
    326 * scaleY,
    380 * Math.min(scaleX, scaleY),
  );

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  const nameSize = fittedFontSize(ctx, champion.teamName, 760 * scaleX, 54 * scaleY, 26 * scaleY);
  ctx.font = `700 ${nameSize}px "Open Sans"`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 8 * scaleY;
  ctx.fillText(champion.teamName, 627 * scaleX, 752 * scaleY);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#ffd33d';
  ctx.font = `700 ${55 * scaleY}px Oxanium`;
  ctx.fillText(String(champion.points), 627 * scaleX, 906 * scaleY);

  const stats = [
    { value: champion.wins, x: 287, color: '#ff4545' },
    { value: champion.finalAppearances, x: 627, color: '#bb55ff' },
    { value: champion.cups, x: 968, color: '#45a7ff' },
  ];
  stats.forEach(stat => {
    ctx.fillStyle = stat.color;
    ctx.font = `700 ${45 * scaleY}px Oxanium`;
    ctx.fillText(String(stat.value), stat.x * scaleX, 1030 * scaleY);
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
