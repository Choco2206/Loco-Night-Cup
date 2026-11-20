'use strict';

const path = require('node:path');
const canvasApi = require('canvas');
const { ROOT_DIR } = require('../src/storage');
const { resolveTeamLogoPath } = require('../src/domain/teams/team-logos');
const { ensureCanvasFontsRegistered } = require('./canvas-fonts');
const { loadCanvasImage } = require('./canvas-image-loader');
const { drawFittedText } = require('./generateGroupScheduleImage');

const template = path.join(ROOT_DIR, 'assets/loco-gta-vi-cup/podium.jpeg');
const slots = {
  first: { crest: { x: 840, y: 652, size: 266 }, name: { x: 837, y: 858, width: 362 } },
  second: { crest: { x: 335, y: 657, size: 236 }, name: { x: 333, y: 848, width: 320 } },
  third: { crest: { x: 1358, y: 657, size: 236 }, name: { x: 1359, y: 848, width: 324 } },
};

async function renderLocoGtaCupCeremonyImage({ teams }) {
  ensureCanvasFontsRegistered(canvasApi);
  const background = await loadCanvasImage(canvasApi, template);
  const canvas = canvasApi.createCanvas(background.width, background.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(background, 0, 0);

  for (const [rank, { crest, name }] of Object.entries(slots)) {
    const team = teams[rank];
    const source = resolveTeamLogoPath(team, { optional: true });
    const logo = source ? await loadCanvasImage(canvasApi, source).catch(() => null) : null;
    if (logo) {
      const scale = crest.size / Math.max(logo.width, logo.height);
      const width = logo.width * scale;
      const height = logo.height * scale;
      ctx.drawImage(logo, crest.x - width / 2, crest.y - height / 2, width, height);
    }
    drawFittedText({
      ctx, text: team.clubName, x: name.x, y: name.y, maxWidth: name.width,
      maxFontSize: rank === 'first' ? 36 : 32, minFontSize: 16,
      align: 'center', font: { family: 'Open Sans', weight: '700' }, color: '#ffffff',
    });
  }
  return { buffer: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height };
}

module.exports = { renderLocoGtaCupCeremonyImage };
