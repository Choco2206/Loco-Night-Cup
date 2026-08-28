'use strict';

const REFERENCE = Object.freeze({ width: 1024, height: 1536 });

function matchSlot({
  centerY,
  homeLogoX = 82,
  homeNameX = 278,
  homeNameWidth = 300,
  awayNameX = 746,
  awayNameWidth = 300,
  awayLogoX = 942,
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

// Erste Vermessung der neuen Bomber-X-Loco-Grafiken.
// Die Werte sind bewusst zentral gehalten, damit sie nach dem Admin-Grafiktest
// schnell pixelgenau nachjustiert werden koennen.
module.exports = Object.freeze({
  // Die Vorlage zeigt 17 sichtbare Zeilen. Es werden absichtlich NUR 16
  // Match-Slots definiert. Dadurch bleibt das unterste 17. Feld immer leer.
  round_of_32: round(
    'round-of-32.png',
    [636, 684, 732, 780, 828, 876, 924, 972, 1020, 1068, 1116, 1164, 1212, 1260, 1308, 1356],
    {
      homeLogoX: 76,
      homeNameX: 282,
      homeNameWidth: 306,
      awayNameX: 742,
      awayNameWidth: 306,
      awayLogoX: 948,
      logoSize: 34,
      scoreWidth: 82,
      fontSize: 18,
    }
  ),

  round_of_16: round(
    'round-of-16.png',
    [704, 788, 872, 956, 1040, 1124, 1208, 1292],
    {
      homeLogoX: 82,
      homeNameX: 282,
      homeNameWidth: 310,
      awayNameX: 742,
      awayNameWidth: 310,
      awayLogoX: 942,
      logoSize: 48,
      scoreWidth: 96,
      fontSize: 23,
    }
  ),

  quarter_final: round(
    'quarter-final.png',
    [776, 914, 1052, 1190],
    {
      homeLogoX: 86,
      homeNameX: 286,
      homeNameWidth: 318,
      awayNameX: 738,
      awayNameWidth: 318,
      awayLogoX: 938,
      logoSize: 58,
      scoreWidth: 104,
      fontSize: 27,
    }
  ),

  semi_final: round(
    'semi-final.png',
    [828, 1082],
    {
      homeLogoX: 90,
      homeNameX: 292,
      homeNameWidth: 326,
      awayNameX: 732,
      awayNameWidth: 326,
      awayLogoX: 934,
      logoSize: 68,
      scoreWidth: 112,
      fontSize: 30,
    }
  ),

  third_place: round(
    'third-place.png',
    [754],
    {
      homeLogoX: 94,
      homeNameX: 296,
      homeNameWidth: 330,
      awayNameX: 728,
      awayNameWidth: 330,
      awayLogoX: 930,
      logoSize: 76,
      scoreWidth: 120,
      fontSize: 32,
    }
  ),

  final: round(
    'final.png',
    [754],
    {
      homeLogoX: 94,
      homeNameX: 296,
      homeNameWidth: 330,
      awayNameX: 728,
      awayNameWidth: 330,
      awayLogoX: 930,
      logoSize: 76,
      scoreWidth: 120,
      fontSize: 32,
    }
  ),

  fonts: Object.freeze({
    team: Object.freeze({ family: 'Open Sans', weight: '700', maxSize: 32, minSize: 11 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 34, minSize: 18 }),
  }),
  colors: Object.freeze({ text: '#ffffff' }),
});
