'use strict';

const fs = require('fs');
const sharp = require('sharp');

async function loadCanvasImage(canvasApi, source) {
  try {
    return await canvasApi.loadImage(source);
  } catch (canvasError) {
    try {
      const input = Buffer.isBuffer(source) ? source : await fs.promises.readFile(source);
      const normalized = await sharp(input).png().toBuffer();
      return await canvasApi.loadImage(normalized);
    } catch (normalizationError) {
      normalizationError.cause = canvasError;
      throw normalizationError;
    }
  }
}

module.exports = { loadCanvasImage };
