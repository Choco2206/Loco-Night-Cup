'use strict';

// Separately measured FC 27 template. It stays dormant until the regular
// Team of the Tournament flow explicitly selects the `fc27` variant.
module.exports = {
  template: 'assets/team-of-the-tournament/team-of-the-tournament-fc27.jpeg',
  reference: { width: 1024, height: 1536 },
  serial: { centerX: 907, centerY: 147, width: 150, height: 58, maxFontSize: 46 },
  slots: {
    forward: [
      { logo: { centerX: 343, centerY: 541, radius: 73 }, name: { x: 245, y: 601, width: 145, height: 44 }, rating: { centerX: 417, centerY: 622, radius: 30 } },
      { logo: { centerX: 679, centerY: 541, radius: 73 }, name: { x: 579, y: 601, width: 145, height: 44 }, rating: { centerX: 752, centerY: 622, radius: 30 } },
    ],
    midfielder: [
      { logo: { centerX: 116, centerY: 792, radius: 71 }, name: { x: 25, y: 850, width: 130, height: 43 }, rating: { centerX: 185, centerY: 870, radius: 29 } },
      { logo: { centerX: 315, centerY: 823, radius: 69 }, name: { x: 223, y: 881, width: 130, height: 43 }, rating: { centerX: 383, centerY: 902, radius: 29 } },
      { logo: { centerX: 511, centerY: 782, radius: 70 }, name: { x: 419, y: 839, width: 130, height: 43 }, rating: { centerX: 581, centerY: 860, radius: 29 } },
      { logo: { centerX: 707, centerY: 823, radius: 69 }, name: { x: 616, y: 881, width: 130, height: 43 }, rating: { centerX: 776, centerY: 902, radius: 29 } },
      { logo: { centerX: 906, centerY: 793, radius: 71 }, name: { x: 813, y: 850, width: 130, height: 43 }, rating: { centerX: 973, centerY: 870, radius: 29 } },
    ],
    defender: [
      { logo: { centerX: 239, centerY: 1055, radius: 72 }, name: { x: 141, y: 1112, width: 140, height: 43 }, rating: { centerX: 309, centerY: 1132, radius: 30 } },
      { logo: { centerX: 511, centerY: 1065, radius: 72 }, name: { x: 414, y: 1122, width: 140, height: 43 }, rating: { centerX: 582, centerY: 1142, radius: 30 } },
      { logo: { centerX: 782, centerY: 1055, radius: 72 }, name: { x: 685, y: 1112, width: 140, height: 43 }, rating: { centerX: 853, centerY: 1132, radius: 30 } },
    ],
    goalkeeper: [
      { logo: { centerX: 511, centerY: 1283, radius: 76 }, name: { x: 410, y: 1342, width: 150, height: 43 }, rating: { centerX: 588, centerY: 1363, radius: 32 } },
    ],
  },
};
