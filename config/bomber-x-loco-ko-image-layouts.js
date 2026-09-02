'use strict';

const REFERENCE = Object.freeze({ width: 1024, height: 1536 });

function slot({ y, homeLogoX, homeNameX, homeNameWidth, awayNameX, awayNameWidth, awayLogoX, logoSize, scoreX = 512, scoreWidth, fontSize }) {
  return Object.freeze({
    home: Object.freeze({ logo: Object.freeze({ centerX: homeLogoX, centerY: y, width: logoSize, height: logoSize }), teamName: Object.freeze({ x: homeNameX, y, width: homeNameWidth, height: logoSize, align: 'center', fontSize }) }),
    away: Object.freeze({ logo: Object.freeze({ centerX: awayLogoX, centerY: y, width: logoSize, height: logoSize }), teamName: Object.freeze({ x: awayNameX, y, width: awayNameWidth, height: logoSize, align: 'center', fontSize }) }),
    score: Object.freeze({ x: scoreX, y, width: scoreWidth, height: logoSize }),
  });
}
function measuredRound(template, measurements) { return Object.freeze({ template:`assets/bomber-x-loco/${template}`, reference:REFERENCE, kind:'round', matches:Object.freeze(measurements.map(slot)) }); }

// All 16 visible rows are match rows. Logos sit inside the tapered team panels,
// with the name areas measured between logo and score panel.
const ROUND_32 = [578,635,692,749,806,863,920,977,1034,1091,1148,1205,1262,1319,1376,1433].map(y => ({ y,homeLogoX:104,homeNameX:270,homeNameWidth:280,awayNameX:754,awayNameWidth:280,awayLogoX:920,logoSize:36,scoreX:512,scoreWidth:92,fontSize:18 }));
const ROUND_16 = [674,770,866,962,1058,1154,1250,1346].map(y => ({ y,homeLogoX:116,homeNameX:286,homeNameWidth:292,awayNameX:738,awayNameWidth:292,awayLogoX:908,logoSize:52,scoreX:512,scoreWidth:92,fontSize:25 }));
const QUARTER_FINAL = [721,916,1114,1315].map(y => ({ y,homeLogoX:132,homeNameX:292,homeNameWidth:270,awayNameX:732,awayNameWidth:270,awayLogoX:892,logoSize:64,scoreX:512,scoreWidth:82,fontSize:29 }));
const SEMI_FINAL = [872,1230].map(y => ({ y,homeLogoX:134,homeNameX:292,homeNameWidth:266,awayNameX:732,awayNameWidth:266,awayLogoX:890,logoSize:70,scoreX:512,scoreWidth:80,fontSize:30 }));
const THIRD_PLACE = [{ y:775,homeLogoX:132,homeNameX:290,homeNameWidth:264,awayNameX:734,awayNameWidth:264,awayLogoX:892,logoSize:68,scoreX:512,scoreWidth:80,fontSize:30 }];

// Finale: independently measured from the supplied current 1024x1536 artwork.
// Match row sits directly below the FINALE header and above the gold/silver trophies.
const FINAL = [{
  y: 756,
  homeLogoX: 124,
  homeNameX: 282,
  homeNameWidth: 266,
  awayNameX: 742,
  awayNameWidth: 266,
  awayLogoX: 900,
  logoSize: 68,
  scoreX: 512,
  scoreWidth: 80,
  fontSize: 30,
}];

module.exports = Object.freeze({
 round_of_32:measuredRound('round-of-32.png',ROUND_32), round_of_16:measuredRound('round-of-16.png',ROUND_16), quarter_final:measuredRound('quarter-final.png',QUARTER_FINAL), semi_final:measuredRound('semi-final.png',SEMI_FINAL), third_place:measuredRound('third-place.png',THIRD_PLACE), final:measuredRound('final.png',FINAL),
 fonts:Object.freeze({ team:Object.freeze({family:'Open Sans',weight:'700',maxSize:32,minSize:11}), score:Object.freeze({family:'Oxanium',weight:'700',maxSize:34,minSize:18}) }), colors:Object.freeze({text:'#ffffff'})
});
