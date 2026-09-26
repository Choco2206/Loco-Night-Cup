'use strict';

const bomberXLoco = require('./bomber-x-loco-ko-image-layouts');
const reference = Object.freeze({ width: 1024, height: 1536 });

// Measured against the Halloween round-of-32 artwork. Each center belongs to
// one visible home | score | away row, including the sixteenth row at y=1396.
const centersY = [567, 624, 679, 734, 789, 844, 900, 954,
  1010, 1065, 1120, 1175, 1230, 1286, 1340, 1396];
const matches = centersY.map(y => Object.freeze({
  home: Object.freeze({
    logo: Object.freeze({ centerX: 104, centerY: y, width: 36, height: 36 }),
    teamName: Object.freeze({ x: 270, y, width: 280, height: 36, align: 'center', fontSize: 18 }),
  }),
  away: Object.freeze({
    logo: Object.freeze({ centerX: 920, centerY: y, width: 36, height: 36 }),
    teamName: Object.freeze({ x: 754, y, width: 280, height: 36, align: 'center', fontSize: 18 }),
  }),
  score: Object.freeze({ x: 512, y, width: 92, height: 36 }),
}));

module.exports = Object.freeze({
  round_of_32: Object.freeze({
    template: 'assets/bomber-x-loco-halloween/round-of-32.png',
    reference,
    kind: 'round',
    matches: Object.freeze(matches),
  }),
  fonts: bomberXLoco.fonts,
  colors: bomberXLoco.colors,
});
