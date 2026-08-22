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

const royalMatch = ({ centerY, homeLogoX, homeNameX, awayNameX, awayLogoX, scoreX = 836, scoreY = centerY, logoSize = 112, nameWidth = 430, scoreWidth = 170 }) => Object.freeze({
  home: Object.freeze({
    logo: Object.freeze({ centerX: homeLogoX, centerY, width: logoSize, height: logoSize }),
    teamName: Object.freeze({ x: homeNameX, y: centerY, width: nameWidth, height: logoSize, align: 'center' }),
  }),
  away: Object.freeze({
    logo: Object.freeze({ centerX: awayLogoX, centerY, width: logoSize, height: logoSize }),
    teamName: Object.freeze({ x: awayNameX, y: centerY, width: nameWidth, height: logoSize, align: 'center' }),
  }),
  score: Object.freeze({ x: scoreX, y: scoreY, width: scoreWidth, height: logoSize }),
});

const royalRound = (template, matches) => Object.freeze({
  template: `assets/knockout-royale/${template}`,
  reference: Object.freeze({ width: 1672, height: 941 }),
  kind: 'round',
  matches: Object.freeze(matches.map(match => royalMatch(match))),
});

const royalRows = (template, centers, coordinates) => royalRound(template, centers.map(centerY => ({ centerY, ...coordinates })));

const royal32OpeningColumn = (centers, coordinates) => centers.map(centerY => royalMatch({
  centerY, logoSize: 54, nameWidth: 190, scoreWidth: 72, ...coordinates,
}));

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
  royal_8_kings_round_1: royalRound('royal-8-kings-round-1.png', [356, 500, 641, 784].map(centerY => ({ centerY, homeLogoX: 154, homeNameX: 468, awayNameX: 1202, awayLogoX: 1510, scoreX: 831 }))),
  royal_8_kings_round_2: royalRound('royal-8-kings-round-2.png', [411, 575].map(centerY => ({ centerY, homeLogoX: 264, homeNameX: 500, awayNameX: 1171, awayLogoX: 1378, scoreX: 826, logoSize: 108, nameWidth: 360 }))),
  royal_8_kings_final: royalRound('royal-8-kings-final.png', [{ centerY: 507, homeLogoX: 183, homeNameX: 452, awayNameX: 1198, awayLogoX: 1459, scoreX: 812 }]),
  royal_8_shadows_round_1: royalRound('royal-8-shadows-round-1.png', [430, 627].map(centerY => ({ centerY, homeLogoX: 184, homeNameX: 466, awayNameX: 1200, awayLogoX: 1484, scoreX: 833 }))),
  royal_8_shadows_round_2: royalRound('royal-8-shadows-round-2.png', [424, 588].map(centerY => ({ centerY, homeLogoX: 177, homeNameX: 451, awayNameX: 1221, awayLogoX: 1490, scoreX: 825 }))),
  royal_8_shadows_round_3: royalRound('royal-8-shadows-round-3.png', [{ centerY: 400, homeLogoX: 137, homeNameX: 448, awayNameX: 1222, awayLogoX: 1532, scoreX: 834 }]),
  royal_8_shadows_final: royalRound('royal-8-shadows-final.png', [{ centerY: 560, homeLogoX: 152, homeNameX: 449, awayNameX: 1226, awayLogoX: 1512, scoreX: 839 }]),
  royal_32_kings_round_1: Object.freeze({
    template: 'assets/knockout-royale/winner-32-round1.png', reference: Object.freeze({ width: 1672, height: 941 }), kind: 'round',
    matches: Object.freeze([
      ...royal32OpeningColumn([327, 397, 466, 536, 605, 675, 744, 813], { homeLogoX: 174, homeNameX: 316, awayNameX: 617, awayLogoX: 742, scoreX: 469 }),
      ...royal32OpeningColumn([327, 397, 466, 536, 605, 675, 744, 813], { homeLogoX: 904, homeNameX: 1048, awayNameX: 1348, awayLogoX: 1493, scoreX: 1205 }),
    ]),
  }),
  royal_32_kings_round_2: royalRows('winner-32-round2.png', [341, 409, 478, 547, 615, 684, 753, 821], { homeLogoX: 285, homeNameX: 505, awayNameX: 1167, awayLogoX: 1385, scoreX: 836, logoSize: 54, nameWidth: 360, scoreWidth: 105 }),
  royal_32_kings_round_3: royalRows('winner-32-round3.png', [391, 509, 628, 746], { homeLogoX: 213, homeNameX: 478, awayNameX: 1194, awayLogoX: 1459, scoreX: 836, logoSize: 82, nameWidth: 410, scoreWidth: 115 }),
  royal_32_kings_round_4: royalRows('winner-32-round4.png', [454, 657], { homeLogoX: 191, homeNameX: 465, awayNameX: 1206, awayLogoX: 1480, scoreX: 836, logoSize: 104, nameWidth: 430, scoreWidth: 135 }),
  royal_32_kings_final: royalRows('winner-32-round-final.png', [589], { homeLogoX: 188, homeNameX: 456, awayNameX: 1215, awayLogoX: 1485, scoreX: 837, logoSize: 112, nameWidth: 430, scoreWidth: 145 }),
  royal_32_shadows_round_1: royalRows('shadow-32-round1.png', [337, 406, 475, 544, 613, 683, 752, 821], { homeLogoX: 280, homeNameX: 502, awayNameX: 1166, awayLogoX: 1385, scoreX: 836, logoSize: 54, nameWidth: 360, scoreWidth: 105 }),
  royal_32_shadows_round_2: royalRows('shadow-32-round2.png', [342, 411, 479, 548, 616, 685, 753, 822], { homeLogoX: 289, homeNameX: 507, awayNameX: 1165, awayLogoX: 1381, scoreX: 837, logoSize: 54, nameWidth: 355, scoreWidth: 105 }),
  royal_32_shadows_round_3: royalRows('shadow-32-round3.png', [374, 492, 611, 729], { homeLogoX: 277, homeNameX: 497, awayNameX: 1175, awayLogoX: 1395, scoreX: 836, logoSize: 82, nameWidth: 360, scoreWidth: 100 }),
  royal_32_shadows_round_4: royalRows('shadow-32-round4.png', [371, 494, 617, 740], { homeLogoX: 287, homeNameX: 500, awayNameX: 1168, awayLogoX: 1382, scoreX: 836, logoSize: 82, nameWidth: 355, scoreWidth: 115 }),
  royal_32_shadows_round_5: royalRows('shadow-32-round5.png', [428, 642], { homeLogoX: 257, homeNameX: 481, awayNameX: 1190, awayLogoX: 1412, scoreX: 836, logoSize: 102, nameWidth: 370, scoreWidth: 145 }),
  royal_32_shadows_round_6: royalRows('shadow-32-round6.png', [454, 666], { homeLogoX: 250, homeNameX: 476, awayNameX: 1192, awayLogoX: 1420, scoreX: 836, logoSize: 104, nameWidth: 375, scoreWidth: 140 }),
  royal_32_shadows_round_7: royalRows('shadow-32-round7.png', [538], { homeLogoX: 253, homeNameX: 478, awayNameX: 1200, awayLogoX: 1425, scoreX: 835, logoSize: 112, nameWidth: 375, scoreWidth: 135 }),
  royal_32_shadows_final: royalRows('shadow-32-final.png', [552], { homeLogoX: 250, homeNameX: 476, awayNameX: 1195, awayLogoX: 1418, scoreX: 833, logoSize: 112, nameWidth: 375, scoreWidth: 135 }),
  royal_grand_final: royalRound('royal-grand-final.png', [{ centerY: 650, homeLogoX: 170, homeNameX: 437, awayNameX: 1238, awayLogoX: 1517, scoreX: 836, scoreY: 688 }]),
  royal_grand_final_reset: royalRound('royal-grand-final-reset.png', [{ centerY: 722, homeLogoX: 166, homeNameX: 438, awayNameX: 1240, awayLogoX: 1490, scoreX: 837 }]),
  fonts: Object.freeze({
    team: Object.freeze({ family: 'Open Sans', weight: '600', maxSize: 30, minSize: 12 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 36, minSize: 22 }),
  }),
  colors: Object.freeze({ text: '#ffffff' }),
});

