'use strict';

// Measured visually against the 1080x1536 source template. Text is placed
// directly below each neon circle; all renderer geometry lives here.
const centers = {
  LS: [380, 573], RS: [654, 573], ZOM: [517, 699],
  LM: [156, 865], LZDM: [356, 865], RZDM: [673, 865], RM: [878, 865],
  LIV: [283, 1059], ZIV: [517, 1059], RIV: [761, 1059], TW: [517, 1224],
};

const TOTT_LAYOUT = Object.fromEntries(Object.entries(centers).map(([slot, [cx, cy]]) => [slot, {
  circle: { cx, cy, radius: 58 },
  name: { x: cx - 85, y: cy + 70, width: 170, height: 28, minFontSize: 12, maxFontSize: 22 },
  rating: { x: cx - 45, y: cy + 96, width: 90, height: 26, fontSize: 22 },
}]));

module.exports = { TEMPLATE_SIZE: { width: 1054, height: 1492 }, TOTT_LAYOUT };
