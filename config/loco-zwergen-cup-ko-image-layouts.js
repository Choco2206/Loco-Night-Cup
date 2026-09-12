'use strict';

const REFERENCE = Object.freeze({ width: 1024, height: 1536 });

function matchSlot(y, logoSize = 64) {
  return Object.freeze({
    home: Object.freeze({
      logo: Object.freeze({ centerX: 91, centerY: y, width: logoSize, height: logoSize }),
      teamName: Object.freeze({ x: 270, y, width: 292, height: logoSize, align: 'center', fontSize: 28 }),
    }),
    away: Object.freeze({
      logo: Object.freeze({ centerX: 933, centerY: y, width: logoSize, height: logoSize }),
      teamName: Object.freeze({ x: 754, y, width: 292, height: logoSize, align: 'center', fontSize: 28 }),
    }),
    score: Object.freeze({ x: 512, y, width: 96, height: logoSize }),
  });
}

function round(template, centers, logoSize = 64) {
  return Object.freeze({
    template: `assets/loco-zwerge-cup/${template}`,
    reference: REFERENCE,
    kind: 'round',
    matches: Object.freeze(centers.map(y => matchSlot(y, logoSize))),
  });
}

module.exports = Object.freeze({
  round_of_32: round('round-of-32.jpeg', [494, 549, 602, 655, 708, 761, 814, 867, 922, 975, 1028, 1081, 1134, 1187, 1240, 1293], 38),
  round_of_16: round('round-of-16.jpeg', [515, 618, 721, 825, 930, 1034, 1139, 1244], 54),
  quarter_final: round('quarter-final.jpeg', [671, 851, 1025, 1208]),
  semi_final: round('semi-final.jpeg', [776, 1044]),
  third_place: round('third-place.jpeg', [682]),
  final: round('final.jpeg', [673]),
  fonts: Object.freeze({
    team: Object.freeze({ family: 'Open Sans', weight: '700', maxSize: 28, minSize: 11 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 32, minSize: 18 }),
  }),
  colors: Object.freeze({ text: '#ffffff' }),
});
