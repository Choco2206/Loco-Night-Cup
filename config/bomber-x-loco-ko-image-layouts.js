'use strict';

const REFERENCE = Object.freeze({ width: 1024, height: 1536 });

function matchSlot({
  centerY,
  homeLogoX = 122,
  homeNameX = 302,
  homeNameWidth = 300,
  awayNameX = 722,
  awayNameWidth = 300,
  awayLogoX = 902,
  logoSize = 54,
  scoreX = 512,
  scoreWidth = 104,
  fontSize = 24,
}) {
  return Object.freeze({
    home: Object.freeze({
      logo: Object.freeze({ centerX: homeLogoX, centerY, width: logoSize, height: logoSize }),
      teamName: Object.freeze({ x: homeNameX, y: centerY, width: homeNameWidth, height: logoSize, align: 'center', fontSize }),
    }),
    away: Object.freeze({
      logo: Object.freeze({ centerX: awayLogoX, centerY, width: logoSize, height: logoSize }),
      teamName: Object.freeze({ x: awayNameX, y: centerY, width: awayNameWidth, height: logoSize, align: 'center', fontSize }),
    }),
    score: Object.freeze({ x: scoreX, y: centerY, width: scoreWidth, height: logoSize }),
  });
}

function round(template, centers, options = {}) {
  return Object.freeze({
    template: `assets/bomber-x-loco/${template}`,
    reference: REFERENCE,
    kind: 'round',
    matches: Object.freeze(centers.map(centerY => matchSlot({ centerY, ...options }))),
  });
}

// Die Teamlogos und Teamnamen sitzen bewusst INNERHALB der dunklen
// Begegnungsfelder. Die vorherigen X-Werte lagen zu nah am Außenrahmen und
// führten besonders im Sechzehntelfinale zu deutlich versetzten Inhalten.
module.exports = Object.freeze({
  // Exakt 16 Slots. Ein eventuell sichtbares zusätzliches Schmuck-/Leerfeld
  // der Grafik wird nicht beschrieben.
  round_of_32: round(
    'round-of-32.png',
    [636, 684, 732, 780, 828, 876, 924, 972, 1020, 1068, 1116, 1164, 1212, 1260, 1308, 1356],
    {
      homeLogoX: 118,
      homeNameX: 300,
      homeNameWidth: 286,
      awayNameX: 724,
      awayNameWidth: 286,
      awayLogoX: 906,
      logoSize: 30,
      scoreWidth: 82,
      fontSize: 17,
    }
  ),

  round_of_16: round(
    'round-of-16.png',
    [704, 788, 872, 956, 1040, 1124, 1208, 1292],
    {
      homeLogoX: 122,
      homeNameX: 302,
      homeNameWidth: 292,
      awayNameX: 722,
      awayNameWidth: 292,
      awayLogoX: 902,
      logoSize: 42,
      scoreWidth: 94,
      fontSize: 22,
    }
  ),

  quarter_final: round(
    'quarter-final.png',
    [776, 914, 1052, 1190],
    {
      homeLogoX: 126,
      homeNameX: 306,
      homeNameWidth: 300,
      awayNameX: 718,
      awayNameWidth: 300,
      awayLogoX: 898,
      logoSize: 50,
      scoreWidth: 102,
      fontSize: 26,
    }
  ),

  semi_final: round(
    'semi-final.png',
    [828, 1082],
    {
      homeLogoX: 130,
      homeNameX: 310,
      homeNameWidth: 306,
      awayNameX: 714,
      awayNameWidth: 306,
      awayLogoX: 894,
      logoSize: 58,
      scoreWidth: 110,
      fontSize: 29,
    }
  ),

  third_place: round(
    'third-place.png',
    [754],
    {
      homeLogoX: 134,
      homeNameX: 314,
      homeNameWidth: 310,
      awayNameX: 710,
      awayNameWidth: 310,
      awayLogoX: 890,
      logoSize: 64,
      scoreWidth: 116,
      fontSize: 31,
    }
  ),

  final: round(
    'final.png',
    [754],
    {
      homeLogoX: 134,
      homeNameX: 314,
      homeNameWidth: 310,
      awayNameX: 710,
      awayNameWidth: 310,
      awayLogoX: 890,
      logoSize: 64,
      scoreWidth: 116,
      fontSize: 31,
    }
  ),

  fonts: Object.freeze({
    team: Object.freeze({ family: 'Open Sans', weight: '700', maxSize: 32, minSize: 11 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 34, minSize: 18 }),
  }),
  colors: Object.freeze({ text: '#ffffff' }),
});
