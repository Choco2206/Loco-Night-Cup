'use strict';

const freezeSlots = placements => Object.freeze(Object.fromEntries(
  Object.entries(placements).map(([placement, slot]) => [placement, Object.freeze(slot)]),
));

module.exports = Object.freeze({
  reference: Object.freeze({ width: 1536, height: 864 }),
  days: Object.freeze({
    monday: Object.freeze({
      template: 'assets/ceremony/monday-fc27.jpeg',
      placements: freezeSlots({
        first: { centerX: 419, centerY: 634, width: 190, height: 190 },
        second: { centerX: 950, centerY: 653, width: 116, height: 116 },
        third: { centerX: 1302, centerY: 673, width: 80, height: 80 },
      }),
    }),
    tuesday: Object.freeze({
      template: 'assets/ceremony/tuesday-fc27.jpeg',
      placements: freezeSlots({
        first: { centerX: 768, centerY: 650, width: 120, height: 120 },
        second: { centerX: 436, centerY: 620, width: 86, height: 86 },
        third: { centerX: 1090, centerY: 620, width: 82, height: 82 },
      }),
    }),
    wednesday: Object.freeze({
      template: 'assets/ceremony/wednesday-fc27.jpeg',
      placements: freezeSlots({
        first: { centerX: 768, centerY: 535, width: 126, height: 126 },
        second: { centerX: 305, centerY: 685, width: 126, height: 126 },
        third: { centerX: 1207, centerY: 685, width: 126, height: 126 },
      }),
    }),
    thursday: Object.freeze({
      template: 'assets/ceremony/thursday-fc27.jpeg',
      placements: freezeSlots({
        first: { centerX: 766, centerY: 653, width: 160, height: 160 },
        second: { centerX: 300, centerY: 680, width: 145, height: 145 },
        third: { centerX: 1200, centerY: 684, width: 138, height: 138 },
      }),
    }),
    friday: Object.freeze({
      template: 'assets/ceremony/friday-fc27.jpeg',
      placements: freezeSlots({
        first: { centerX: 1008, centerY: 690, width: 155, height: 155 },
        second: { centerX: 615, centerY: 642, width: 105, height: 105 },
        third: { centerX: 350, centerY: 635, width: 88, height: 88 },
      }),
    }),
    saturday: Object.freeze({
      template: 'assets/ceremony/saturday-fc27.jpeg',
      placements: freezeSlots({
        first: { centerX: 766, centerY: 674, width: 132, height: 132 },
        second: { centerX: 275, centerY: 674, width: 128, height: 128 },
        third: { centerX: 1255, centerY: 674, width: 128, height: 128 },
      }),
    }),
    sunday: Object.freeze({
      template: 'assets/ceremony/sunday-fc27.jpeg',
      placements: freezeSlots({
        first: { centerX: 768, centerY: 666, width: 125, height: 125 },
        second: { centerX: 426, centerY: 667, width: 105, height: 105 },
        third: { centerX: 1115, centerY: 668, width: 104, height: 104 },
      }),
    }),
  }),
});
