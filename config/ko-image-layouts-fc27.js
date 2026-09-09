'use strict';

const PORTRAIT_REFERENCE = Object.freeze({ width: 1024, height: 1536 });
const LANDSCAPE_REFERENCE = Object.freeze({ width: 1536, height: 1024 });

function qualificationSlot({ logoX, nameX, centerY, logoWidth, logoHeight, nameWidth, fontSize }) {
  return Object.freeze({
    logo: Object.freeze({ centerX: logoX, centerY, width: logoWidth, height: logoHeight }),
    teamName: Object.freeze({ x: nameX, y: centerY, width: nameWidth, height: logoHeight, align: 'left', fontSize }),
  });
}

function matchSlot(centerY, { logoWidth = 72, logoHeight = 72, fontSize = 30 } = {}) {
  return Object.freeze({
    home: Object.freeze({
      logo: Object.freeze({ centerX: 76, centerY, width: logoWidth, height: logoHeight }),
      teamName: Object.freeze({ x: 289, y: centerY, width: 300, height: logoHeight, align: 'center', fontSize }),
    }),
    away: Object.freeze({
      logo: Object.freeze({ centerX: 949, centerY, width: logoWidth, height: logoHeight }),
      teamName: Object.freeze({ x: 736, y: centerY, width: 300, height: logoHeight, align: 'center', fontSize }),
    }),
    score: Object.freeze({ x: 512, y: centerY, width: 92, height: logoHeight }),
  });
}

function round(template, centers, options) {
  return Object.freeze({
    template: `assets/ko-phase/${template}`,
    reference: PORTRAIT_REFERENCE,
    kind: 'round',
    matches: Object.freeze(centers.map(centerY => matchSlot(centerY, options))),
  });
}

module.exports = Object.freeze({
  qualification_4: Object.freeze({
    template: 'assets/ko-phase/ko-phase-4-fc27.jpeg', reference: LANDSCAPE_REFERENCE, kind: 'qualification',
    slots: Object.freeze([195, 967].flatMap(logoX => (
      [464, 656].map(centerY => qualificationSlot({
        logoX, nameX: logoX + 78, centerY, logoWidth: 118, logoHeight: 118, nameWidth: 438, fontSize: 38,
      }))
    ))),
  }),
  qualification_8: Object.freeze({
    template: 'assets/ko-phase/ko-phase-8-fc27.jpeg', reference: LANDSCAPE_REFERENCE, kind: 'qualification',
    slots: Object.freeze([193, 968].flatMap(logoX => (
      [404, 529, 654, 779].map(centerY => qualificationSlot({
        logoX, nameX: logoX + 65, centerY, logoWidth: 94, logoHeight: 84, nameWidth: 454, fontSize: 32,
      }))
    ))),
  }),
  qualification_16: Object.freeze({
    template: 'assets/ko-phase/ko-phase-16-fc27.jpeg', reference: LANDSCAPE_REFERENCE, kind: 'qualification',
    slots: Object.freeze([151, 533, 906, 1276].flatMap(logoX => (
      [394, 516, 638, 759].map(centerY => qualificationSlot({
        logoX, nameX: logoX + 43, centerY, logoWidth: 68, logoHeight: 76, nameWidth: 168, fontSize: 22,
      }))
    ))),
  }),
  round_of_16: round('achtelfinale-fc27.jpeg', [523, 620, 716, 813, 909, 1006, 1103, 1200], {
    logoWidth: 70, logoHeight: 70, fontSize: 27,
  }),
  quarter_final: round('viertelfinale-fc27.jpeg', [554, 713, 872, 1032], {
    logoWidth: 72, logoHeight: 82, fontSize: 29,
  }),
  semi_final: round('halbfinale-fc27.jpeg', [616, 810], {
    logoWidth: 88, logoHeight: 106, fontSize: 30,
  }),
  third_place: round('platz-3-fc27.jpeg', [558], {
    logoWidth: 88, logoHeight: 104, fontSize: 30,
  }),
  final: round('finale-fc27.jpeg', [726], {
    logoWidth: 88, logoHeight: 104, fontSize: 30,
  }),
  fonts: Object.freeze({
    team: Object.freeze({ family: 'Open Sans', weight: '700', maxSize: 32, minSize: 11 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 34, minSize: 18 }),
  }),
  colors: Object.freeze({ text: '#ffffff' }),
});
