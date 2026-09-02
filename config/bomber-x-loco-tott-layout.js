'use strict';

// Individually measured against assets/bomber-x-loco/team-of-the-tournament.png.
// The one-off Bomber X Loco artwork intentionally has no serial-number field.
module.exports = {
  template: 'assets/bomber-x-loco/team-of-the-tournament.png',
  reference: { width: 1022, height: 1536 },
  serial: null,
  slots: {
    forward: [
      { logo: { centerX: 320, centerY: 475, radius: 68 }, name: { x: 216, y: 544, width: 168, height: 50 }, rating: { centerX: 405, centerY: 570, radius: 28 } },
      { logo: { centerX: 699, centerY: 475, radius: 68 }, name: { x: 591, y: 544, width: 168, height: 50 }, rating: { centerX: 780, centerY: 570, radius: 28 } },
    ],
    midfielder: [
      { logo: { centerX: 140, centerY: 850, radius: 69 }, name: { x: 38, y: 911, width: 151, height: 49 }, rating: { centerX: 216, centerY: 935, radius: 28 } },
      { logo: { centerX: 378, centerY: 884, radius: 69 }, name: { x: 272, y: 945, width: 154, height: 49 }, rating: { centerX: 450, centerY: 969, radius: 28 } },
      { logo: { centerX: 511, centerY: 684, radius: 70 }, name: { x: 405, y: 745, width: 153, height: 49 }, rating: { centerX: 585, centerY: 770, radius: 28 } },
      { logo: { centerX: 644, centerY: 884, radius: 69 }, name: { x: 539, y: 945, width: 153, height: 49 }, rating: { centerX: 717, centerY: 969, radius: 28 } },
      { logo: { centerX: 882, centerY: 850, radius: 69 }, name: { x: 776, y: 911, width: 154, height: 49 }, rating: { centerX: 954, centerY: 935, radius: 28 } },
    ],
    defender: [
      { logo: { centerX: 241, centerY: 1103, radius: 70 }, name: { x: 145, y: 1164, width: 149, height: 48 }, rating: { centerX: 324, centerY: 1187, radius: 28 } },
      { logo: { centerX: 511, centerY: 1103, radius: 70 }, name: { x: 414, y: 1164, width: 149, height: 48 }, rating: { centerX: 593, centerY: 1187, radius: 28 } },
      { logo: { centerX: 780, centerY: 1103, radius: 70 }, name: { x: 682, y: 1164, width: 149, height: 48 }, rating: { centerX: 862, centerY: 1187, radius: 28 } },
    ],
    goalkeeper: [
      { logo: { centerX: 511, centerY: 1303, radius: 67 }, name: { x: 406, y: 1365, width: 153, height: 48 }, rating: { centerX: 584, centerY: 1389, radius: 28 } },
    ],
  },
};
