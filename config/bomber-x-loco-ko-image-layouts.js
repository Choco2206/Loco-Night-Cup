'use strict';

const REFERENCE = Object.freeze({ width: 1024, height: 1536 });

function slot({ y, homeLogoX, homeNameX, homeNameWidth, awayNameX, awayNameWidth, awayLogoX, logoSize, scoreX = 512, scoreWidth, fontSize }) {
  return Object.freeze({
    home: Object.freeze({
      logo: Object.freeze({ centerX: homeLogoX, centerY: y, width: logoSize, height: logoSize }),
      teamName: Object.freeze({ x: homeNameX, y, width: homeNameWidth, height: logoSize, align: 'center', fontSize }),
    }),
    away: Object.freeze({
      logo: Object.freeze({ centerX: awayLogoX, centerY: y, width: logoSize, height: logoSize }),
      teamName: Object.freeze({ x: awayNameX, y, width: awayNameWidth, height: logoSize, align: 'center', fontSize }),
    }),
    score: Object.freeze({ x: scoreX, y, width: scoreWidth, height: logoSize }),
  });
}

function measuredRound(template, measurements) {
  return Object.freeze({
    template: `assets/bomber-x-loco/${template}`,
    reference: REFERENCE,
    kind: 'round',
    matches: Object.freeze(measurements.map(slot)),
  });
}

// Each Bomber X Loco template is measured independently.
// Sechzehntelfinale: first 16 rows are populated; bottom/17th artwork row stays empty.
const ROUND_32 = [578,635,692,749,806,863,920,977,1034,1091,1148,1205,1262,1319,1376,1433].map(y => ({
  y, homeLogoX:64, homeNameX:250, homeNameWidth:330, awayNameX:774, awayNameWidth:330,
  awayLogoX:960, logoSize:36, scoreX:512, scoreWidth:92, fontSize:18,
}));

// Achtelfinale: measured directly from the current 1024x1536 artwork supplied for
// round-of-16.png. Eight large rows, each with its own left team field, central score
// box and right team field. These values are NOT derived from the Sechzehntelfinale.
const ROUND_16 = [674,770,866,962,1058,1154,1250,1346].map(y => ({
  y,
  homeLogoX: 116,
  homeNameX: 286,
  homeNameWidth: 292,
  awayNameX: 738,
  awayNameWidth: 292,
  awayLogoX: 908,
  logoSize: 52,
  scoreX: 512,
  scoreWidth: 92,
  fontSize: 25,
}));

// Remaining rounds stay isolated until their current artwork is supplied and measured.
const QUARTER_FINAL = [776,914,1052,1190].map(y => ({
  y, homeLogoX:126, homeNameX:306, homeNameWidth:300, awayNameX:718, awayNameWidth:300,
  awayLogoX:898, logoSize:50, scoreWidth:102, fontSize:26,
}));

const SEMI_FINAL = [828,1082].map(y => ({
  y, homeLogoX:130, homeNameX:310, homeNameWidth:306, awayNameX:714, awayNameWidth:306,
  awayLogoX:894, logoSize:58, scoreWidth:110, fontSize:29,
}));

const THIRD_PLACE = [{
  y:754, homeLogoX:134, homeNameX:314, homeNameWidth:310, awayNameX:710, awayNameWidth:310,
  awayLogoX:890, logoSize:64, scoreWidth:116, fontSize:31,
}];

const FINAL = [{
  y:754, homeLogoX:134, homeNameX:314, homeNameWidth:310, awayNameX:710, awayNameWidth:310,
  awayLogoX:890, logoSize:64, scoreWidth:116, fontSize:31,
}];

module.exports = Object.freeze({
  round_of_32: measuredRound('round-of-32.png', ROUND_32),
  round_of_16: measuredRound('round-of-16.png', ROUND_16),
  quarter_final: measuredRound('quarter-final.png', QUARTER_FINAL),
  semi_final: measuredRound('semi-final.png', SEMI_FINAL),
  third_place: measuredRound('third-place.png', THIRD_PLACE),
  final: measuredRound('final.png', FINAL),

  fonts: Object.freeze({
    team: Object.freeze({ family: 'Open Sans', weight: '700', maxSize:32, minSize:11 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize:34, minSize:18 }),
  }),
  colors: Object.freeze({ text:'#ffffff' }),
});
