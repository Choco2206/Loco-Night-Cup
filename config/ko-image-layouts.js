'use strict';

const qualificationSlot = (logoX, nameX, centerY, logoWidth, logoHeight, nameWidth, fontSize) => Object.freeze({
  logo: Object.freeze({ centerX: logoX, centerY, width: logoWidth, height: logoHeight }),
  teamName: Object.freeze({ x: nameX, y: centerY, width: nameWidth, height: logoHeight, align: 'left', fontSize }),
});

const roundMatch = ({ centerY, homeLogoX, homeNameX, homeNameWidth, awayNameX, awayNameWidth, awayLogoX, logoWidth, logoHeight, scoreX, scoreWidth }) => Object.freeze({
  home: Object.freeze({
    logo: Object.freeze({ centerX: homeLogoX, centerY, width: logoWidth, height: logoHeight }),
    teamName: Object.freeze({ x: homeNameX + (homeNameWidth / 2), y: centerY, width: homeNameWidth, height: logoHeight, align: 'center' }),
  }),
  away: Object.freeze({
    logo: Object.freeze({ centerX: awayLogoX, centerY, width: logoWidth, height: logoHeight }),
    teamName: Object.freeze({ x: awayNameX - (awayNameWidth / 2), y: centerY, width: awayNameWidth, height: logoHeight, align: 'center' }),
  }),
  score: Object.freeze({ x: scoreX, y: centerY, width: scoreWidth, height: logoHeight }),
});

const portrait1024 = centerY => roundMatch({
  centerY, homeLogoX: 72, homeNameX: 126, homeNameWidth: 302,
  awayNameX: 898, awayNameWidth: 302, awayLogoX: 950,
  logoWidth: 76, logoHeight: 82, scoreX: 512, scoreWidth: 122,
});

const portrait1086 = centerY => roundMatch({
  centerY, homeLogoX: 78, homeNameX: 145, homeNameWidth: 320,
  awayNameX: 941, awayNameWidth: 320, awayLogoX: 1007,
  logoWidth: 92, logoHeight: 96, scoreX: 543, scoreWidth: 128,
});

module.exports = Object.freeze({
  qualification_4: Object.freeze({
    template: 'assets/ko-phase/ko-phase-4.png', reference: Object.freeze({ width: 1536, height: 1024 }), kind: 'qualification',
    slots: Object.freeze([
      qualificationSlot(273, 354, 462, 124, 124, 350, 30), qualificationSlot(1005, 1086, 462, 124, 124, 350, 30),
      qualificationSlot(273, 354, 701, 124, 124, 350, 30), qualificationSlot(1005, 1086, 701, 124, 124, 350, 30),
    ]),
  }),
  qualification_8: Object.freeze({
    template: 'assets/ko-phase/ko-phase-8.png', reference: Object.freeze({ width: 1536, height: 1024 }), kind: 'qualification',
    slots: Object.freeze([[245, 312], [955, 1022]].flatMap(([logoX, nameX]) => (
      [417, 545, 673, 801].map(centerY => qualificationSlot(logoX, nameX, centerY, 98, 88, 415, 28))
    ))),
  }),
  qualification_16: Object.freeze({
    template: 'assets/ko-phase/ko-phase-16.png', reference: Object.freeze({ width: 1536, height: 1024 }), kind: 'qualification',
    slots: Object.freeze([154, 538, 914, 1278].flatMap(logoX => (
      [429, 549, 669, 789].map(centerY => qualificationSlot(logoX, logoX + 52, centerY, 72, 76, 170, 22))
    ))),
  }),
  round_of_16: Object.freeze({
    template: 'assets/ko-phase/achtelfinale.png', reference: Object.freeze({ width: 1024, height: 1535 }), kind: 'round',
    matches: Object.freeze([524, 636, 748, 860, 972, 1084, 1196, 1308].map(portrait1024)),
  }),
  quarter_final: Object.freeze({
    template: 'assets/ko-phase/viertelfinale.png', reference: Object.freeze({ width: 1024, height: 1535 }), kind: 'round',
    matches: Object.freeze([650, 864, 1078, 1292].map(portrait1024)),
  }),
  semi_final: Object.freeze({
    template: 'assets/ko-phase/halbfinale.png', reference: Object.freeze({ width: 1086, height: 1448 }), kind: 'round',
    matches: Object.freeze([771, 1104].map(portrait1086)),
  }),
  third_place: Object.freeze({
    template: 'assets/ko-phase/platz-3.png', reference: Object.freeze({ width: 1086, height: 1448 }), kind: 'round',
    matches: Object.freeze([770].map(portrait1086)),
  }),
  final: Object.freeze({
    template: 'assets/ko-phase/finale.png', reference: Object.freeze({ width: 1086, height: 1448 }), kind: 'round',
    matches: Object.freeze([770].map(portrait1086)),
  }),
  fonts: Object.freeze({
    team: Object.freeze({ family: 'Open Sans', weight: '600', maxSize: 30, minSize: 12 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 36, minSize: 22 }),
  }),
  colors: Object.freeze({ text: '#ffffff' }),
});

