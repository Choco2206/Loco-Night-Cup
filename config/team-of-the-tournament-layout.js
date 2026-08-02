'use strict';

module.exports = {
  template: 'assets/team-of-the-tournament/team-of-the-tournament.png',
  reference: { width: 1024, height: 1536 },
  serial: { centerX: 917, centerY: 91, width: 150, height: 92, maxFontSize: 62 },
  slots: {
    forward: [
      { logo: { centerX: 337, centerY: 516, radius: 78 }, name: { x: 225, y: 582, width: 170, height: 48 }, rating: { centerX: 418, centerY: 608, radius: 38 } },
      { logo: { centerX: 686, centerY: 516, radius: 78 }, name: { x: 574, y: 582, width: 170, height: 48 }, rating: { centerX: 767, centerY: 608, radius: 38 } },
    ],
    midfielder: [
      { logo: { centerX: 113, centerY: 793, radius: 72 }, name: { x: 22, y: 856, width: 145, height: 44 }, rating: { centerX: 184, centerY: 876, radius: 31 } },
      { logo: { centerX: 319, centerY: 824, radius: 68 }, name: { x: 229, y: 886, width: 145, height: 44 }, rating: { centerX: 386, centerY: 906, radius: 31 } },
      { logo: { centerX: 512, centerY: 741, radius: 72 }, name: { x: 416, y: 805, width: 145, height: 44 }, rating: { centerX: 580, centerY: 825, radius: 31 } },
      { logo: { centerX: 706, centerY: 824, radius: 68 }, name: { x: 615, y: 886, width: 145, height: 44 }, rating: { centerX: 772, centerY: 906, radius: 31 } },
      { logo: { centerX: 911, centerY: 793, radius: 72 }, name: { x: 816, y: 856, width: 145, height: 44 }, rating: { centerX: 978, centerY: 876, radius: 31 } },
    ],
    defender: [
      { logo: { centerX: 236, centerY: 1058, radius: 74 }, name: { x: 133, y: 1123, width: 150, height: 46 }, rating: { centerX: 313, centerY: 1144, radius: 32 } },
      { logo: { centerX: 513, centerY: 1058, radius: 74 }, name: { x: 410, y: 1123, width: 150, height: 46 }, rating: { centerX: 590, centerY: 1144, radius: 32 } },
      { logo: { centerX: 789, centerY: 1058, radius: 74 }, name: { x: 686, y: 1123, width: 150, height: 46 }, rating: { centerX: 866, centerY: 1144, radius: 32 } },
    ],
    goalkeeper: [
      { logo: { centerX: 513, centerY: 1313, radius: 82 }, name: { x: 386, y: 1387, width: 190, height: 50 }, rating: { centerX: 601, centerY: 1412, radius: 38 } },
    ],
  },
};

