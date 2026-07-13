'use strict';

const fs = require('fs');
const path = require('path');

const FONT_FILES = Object.freeze([
  [path.resolve(__dirname, '..', 'assets', 'fonts', 'Oxanium-VariableFont_wght.ttf'), { family: 'Oxanium', weight: '700' }],
  [path.resolve(__dirname, '..', 'assets', 'fonts', 'OdibeeSans-Regular.ttf'), { family: 'Odibee Sans', weight: '400' }],
  [path.resolve(__dirname, '..', 'assets', 'fonts', 'OpenSans-VariableFont_wdth,wght.ttf'), { family: 'Open Sans', weight: '600' }],
]);

let registered = false;

function ensureCanvasFontsRegistered(canvasApi) {
  if (registered) return true;
  for (const [file, definition] of FONT_FILES) {
    if (!fs.existsSync(file)) {
      console.warn(`[canvas-fonts] Fontdatei fehlt, Standardschrift wird verwendet: ${file}`);
      continue;
    }
    try {
      canvasApi.registerFont(file, definition);
    } catch (error) {
      console.warn(`[canvas-fonts] Font konnte nicht registriert werden: ${file}`, error);
    }
  }
  registered = true;
  return true;
}

function setCanvasFont(ctx, size, family, weight = '400') {
  ctx.font = `${weight} ${size}px "${family}", sans-serif`;
}

module.exports = { ensureCanvasFontsRegistered, setCanvasFont };
