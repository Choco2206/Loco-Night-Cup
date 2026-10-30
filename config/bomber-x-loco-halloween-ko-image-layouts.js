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

// Measured independently on the supplied 1024 x 1536 Halloween artwork.
function measuredRound(template, centers, { homeLogoX, homeNameX, homeNameWidth, awayLogoX, awayNameX, awayNameWidth, logoSize, fontSize }) {
  return Object.freeze({
    template: `assets/bomber-x-loco-halloween/${template}`,
    reference,
    kind: 'round',
    matches: Object.freeze(centers.map(y => Object.freeze({
      home: Object.freeze({
        logo: Object.freeze({ centerX: homeLogoX, centerY: y, width: logoSize, height: logoSize }),
        teamName: Object.freeze({ x: homeNameX, y, width: homeNameWidth, height: logoSize, align: 'center', fontSize }),
      }),
      away: Object.freeze({
        logo: Object.freeze({ centerX: awayLogoX, centerY: y, width: logoSize, height: logoSize }),
        teamName: Object.freeze({ x: awayNameX, y, width: awayNameWidth, height: logoSize, align: 'center', fontSize }),
      }),
      score: Object.freeze({ x: 512, y, width: 80, height: logoSize }),
    }))),
  });
}

module.exports = Object.freeze({
  round_of_16: measuredRound('round-of-16.jpeg',
    [600, 708, 816, 924, 1036, 1148, 1262, 1372],
    { homeLogoX: 112, homeNameX: 282, homeNameWidth: 264, awayLogoX: 944, awayNameX: 764, awayNameWidth: 284, logoSize: 44, fontSize: 24 }),
  quarter_final: measuredRound('quarter-final.jpeg',
    [662, 864, 1064, 1260],
    { homeLogoX: 118, homeNameX: 284, homeNameWidth: 256, awayLogoX: 930, awayNameX: 754, awayNameWidth: 272, logoSize: 60, fontSize: 28 }),
  round_of_32: Object.freeze({
    template: 'assets/bomber-x-loco-halloween/round-of-32-v3.png',
    reference,
    kind: 'round',
    matches: Object.freeze(matches),
  }),
  fonts: bomberXLoco.fonts,
  colors: bomberXLoco.colors,
});
