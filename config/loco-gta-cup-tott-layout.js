'use strict';

function slots(centers) {
  return centers.map(([x, y]) => ({
    logo: { centerX: x, centerY: y, radius: 70 },
    name: { x: x - 86, y: y + 61, width: 122, height: 44 },
    rating: { centerX: x + 70, centerY: y + 83, radius: 26 },
  }));
}

module.exports = {
  template: 'assets/loco-gta-vi-cup/team-of-the-tournament.jpeg',
  reference: { width: 1024, height: 1536 },
  serial: { centerX: 935, centerY: 113.5, width: 114, height: 43, maxFontSize: 36 },
  slots: {
    forward: slots([[342, 555], [678, 555]]),
    midfielder: slots([[118, 801], [315, 836], [512, 788], [707, 836], [904, 801]]),
    defender: slots([[232, 1057], [512, 1068], [792, 1057]]),
    goalkeeper: slots([[512, 1282]]),
  },
};
