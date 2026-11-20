'use strict';

const base = require('./ko-image-layouts');

function teamSlot(logoX, nameX, y, align, width = 178, logoSize = 40, fontSize) {
  return {
    logo: { centerX: logoX, centerY: y, width: logoSize, height: logoSize },
    teamName: { x: nameX, y, width, align, fontSize },
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
  round_of_16: {
    template: 'assets/loco-gta-vi-cup/round-of-16.jpeg',
    reference: { width: 1122, height: 1402 },
    matches: [677, 773, 869, 962, 1054, 1147, 1239, 1331].map(y => ({
      home: teamSlot(80, 122, y, 'left', 354, 56, 30),
      away: teamSlot(1042, 1000, y, 'right', 354, 56, 30),
      score: { x: 561, y, width: 108, fontSize: 32 },
    })),
  },
  quarter_final: {
    template: 'assets/loco-gta-vi-cup/quarter-final.jpeg',
    reference: { width: 1122, height: 1402 },
    matches: [814, 963, 1113, 1262].map(y => ({
      home: teamSlot(78, 126, y, 'left', 350, 68, 34),
      away: teamSlot(1044, 996, y, 'right', 350, 68, 34),
      score: { x: 561, y, width: 116, fontSize: 38 },
    })),
  },
  semi_final: {
    template: 'assets/loco-gta-vi-cup/semi-final.jpeg',
    reference: { width: 1122, height: 1402 },
    matches: [1058, 1235].map(y => ({
      home: teamSlot(81, 134, y, 'left', 334, 76, 36),
      away: teamSlot(1041, 988, y, 'right', 334, 76, 36),
      score: { x: 560, y, width: 126, fontSize: 44 },
    })),
  },
};
