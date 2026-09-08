'use strict';

// Individually measured against the separate FC 27 Champion der Woche
// template. The live Power Ranking keeps using the current template until
// the renderer is explicitly called with variant `fc27`.
module.exports = {
  template: 'assets/power-ranking/power-ranking-champion-fc27.jpeg',
  reference: { width: 1254, height: 1254 },
  textColor: '#ffe478',
  logo: { x: 470, y: 405, width: 315, height: 315 },
  teamName: { x: 294, y: 742, width: 667, height: 64, maxFontSize: 46, minFontSize: 22 },
  points: { x: 397, y: 896, width: 461, height: 58, maxFontSize: 48, minFontSize: 28 },
  stats: {
    wins: { x: 196, y: 1029, width: 209, height: 49, maxFontSize: 38, minFontSize: 24 },
    finalAppearances: { x: 551, y: 1029, width: 207, height: 49, maxFontSize: 38, minFontSize: 24 },
    cups: { x: 919, y: 1029, width: 212, height: 49, maxFontSize: 38, minFontSize: 24 },
  },
  calendarWeek: { x: 365, y: 1124, width: 205, height: 54, maxFontSize: 28, minFontSize: 18 },
  dateRange: { x: 627, y: 1124, width: 515, height: 54, maxFontSize: 25, minFontSize: 16 },
};
