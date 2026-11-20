'use strict';

const base = require('./ko-image-layouts');

function teamSlot(logoX, nameX, y, align) {
  return {
    logo: { centerX: logoX, centerY: y, width: 40, height: 40 },
    teamName: { x: nameX, y, width: 178, align },
  };
}

module.exports = {
  colors: base.colors,
  fonts: {
    team: { ...base.fonts.team, maxSize: 20, minSize: 11 },
    score: { ...base.fonts.score, maxSize: 21, minSize: 12 },
  },
  round_of_32: {
    template: 'assets/loco-gta-vi-cup/round-of-32.jpeg',
    reference: { width: 1122, height: 1402 },
    matches: [0, 554].flatMap(offset => [653, 752, 851, 951, 1050, 1149, 1247, 1340].map(y => ({
      home: teamSlot(46 + offset, 72 + offset, y, 'left'),
      away: teamSlot(518 + offset, 492 + offset, y, 'right'),
      score: { x: 285 + offset, y, width: 44 },
    }))),
  },
};
