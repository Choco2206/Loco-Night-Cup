'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../../storage');

let fontsRegistered = false;

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
  const width = 1600;
  const height = 900;
  const surface = canvas.createCanvas(width, height);
  const ctx = surface.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#090d1b');
  background.addColorStop(0.55, '#101a38');
  background.addColorStop(1, '#070910');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#42d6ff';
  ctx.lineWidth = 5;
  ctx.strokeRect(28, 28, width - 56, height - 56);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '700 72px Oxanium';
  ctx.fillText('LOCO POWER RANKING', width / 2, 105);
  ctx.fillStyle = '#53dcff';
  ctx.font = '700 42px Oxanium';
  ctx.fillText('CHAMPION DER WOCHE', width / 2, 165);

  await drawLogoOrPlaceholder(canvas, ctx, logoSnapshot, 120, 230, 440);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  const nameSize = fittedFontSize(ctx, champion.teamName, 830, 68, 34);
  ctx.font = `700 ${nameSize}px "Open Sans"`;
  ctx.fillText(champion.teamName, 650, 315);
  ctx.fillStyle = '#53dcff';
  ctx.font = '700 82px Oxanium';
  ctx.fillText(`${champion.points} PUNKTE`, 650, 420);

  const stats = [
    ['GESPIELTE CUPS', champion.cups],
    ['TURNIERSIEGE', champion.wins],
    ['FINALTEILNAHMEN', champion.finalAppearances],
  ];
  stats.forEach(([label, value], index) => {
    const x = 650 + index * 285;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, 485, 255, 145);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '700 52px Oxanium';
    ctx.fillText(String(value), x + 127, 550);
    ctx.fillStyle = '#b8c7eb';
    ctx.font = '600 19px "Open Sans"';
    ctx.fillText(label, x + 127, 602);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 32px Oxanium';
  ctx.fillText(`KALENDERWOCHE ${week.calendarWeek}`, width / 2, 750);
  ctx.fillStyle = '#b8c7eb';
  ctx.font = '600 28px "Open Sans"';
  ctx.fillText(`${formatGermanDate(week.startsAt)} bis ${formatGermanDate(week.endsAt)}`, width / 2, 800);

  return {
    buffer: surface.toBuffer('image/png'),
    fileName: `power-ranking-champion-${week.weekKey}.png`,
  };
}

function formatGermanDate(value) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

module.exports = { renderChampionGraphic, resolveLogoPath };
