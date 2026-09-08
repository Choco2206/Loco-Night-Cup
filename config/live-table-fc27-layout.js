'use strict';

// Individually measured against the separate FC 27 live-table template.
// The live group table keeps using its current artwork until this renderer is
// explicitly selected.
module.exports = Object.freeze({
  template: 'assets/tables/live-table-fc27.jpeg',
  reference: Object.freeze({ width: 1672, height: 941 }),
  groupName: Object.freeze({ x: 350, y: 318, maxWidth: 400, maxFontSize: 43, minFontSize: 24 }),
  qualification: Object.freeze({ x: 1080, y: 318, maxWidth: 850, maxFontSize: 27, minFontSize: 14 }),
  columns: Object.freeze({
    position: 125,
    teamX: 215,
    teamMaxWidth: 420,
    played: 726,
    wins: 856,
    draws: 1009,
    losses: 1181,
    goalDifference: 1356,
    points: 1538,
  }),
  rowY: Object.freeze([520, 608, 696, 784]),
});
