'use strict';

// Bomber X Loco Cup ceremony template measurement.
// Reference image: assets/bomber-x-loco/ceremony.png (1536 x 896).
// The three boxes below are deliberately inset from the decorative frame so
// transparent team logos can be scaled with `fit: contain` without touching it.
module.exports = Object.freeze({
  template: 'assets/bomber-x-loco/ceremony.png',
  reference: Object.freeze({ width: 1536, height: 896 }),
  placements: Object.freeze({
    first: Object.freeze({
      place: 1,
      centerX: 779,
      centerY: 731,
      width: 236,
      height: 166,
      left: 661,
      top: 648,
    }),
    second: Object.freeze({
      place: 2,
      centerX: 477,
      centerY: 750,
      width: 190,
      height: 134,
      left: 382,
      top: 683,
    }),
    third: Object.freeze({
      place: 3,
      centerX: 1067,
      centerY: 751,
      width: 180,
      height: 126,
      left: 977,
      top: 688,
    }),
  }),
});
