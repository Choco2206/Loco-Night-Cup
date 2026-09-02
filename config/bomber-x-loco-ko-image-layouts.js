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

// IMPORTANT: Every Bomber X Loco template is measured independently.
// No KO round inherits coordinates or spacing from another image.
const ROUND_32 = [636,684,732,780,828,876,924,972,1020,1068,1116,1164,1212,1260,1308,1356].map(y => ({
  y, homeLogoX:118, homeNameX:300, homeNameWidth:286, awayNameX:724, awayNameWidth:286,
  awayLogoX:906, logoSize:30, scoreWidth:82, fontSize:17,
}));

const ROUND_16 = [704,788,872,956,1040,1124,1208,1292].map(y => ({
  y, homeLogoX:122, homeNameX:302, homeNameWidth:292, awayNameX:722, awayNameWidth:292,
  awayLogoX:902, logoSize:42, scoreWidth:94, fontSize:22,
}));

const QUARTER_FINAL = [776,914,1052,1190].map(y => ({
  y, homeLogoX:126, homeNameX:306, homeNameWidth:300, awayNameX:718, awayNameWidth:300,
  awayLogoX:898, logoSize:50, scoreWidth:102, fontSize:26,
}));

const SEMI_FINAL = [828,1082].map(y => ({
  y, homeLogoX:130, homeNameX:310, homeNameWidth:306, awayNameX:714, awayNameWidth:306,
  awayLogoX:894, logoSize:58, scoreWidth:110, fontSize:29,
}));

// These are deliberately separate measurements. Do not merge them even if
// their current values happen to be close: the artwork is different.
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
