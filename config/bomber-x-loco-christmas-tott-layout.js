'use strict';

function slot(logoX, logoY, logoRadius, nameLeft, ratingX, ratingY) {
  const ratingRadius = 20;
  return {
    logo: { centerX: logoX, centerY: logoY, radius: logoRadius },
    name: { x: nameLeft, y: ratingY - 14, width: ratingX - 25 - nameLeft, height: 28 },
    rating: { centerX: ratingX, centerY: ratingY, radius: ratingRadius },
  };
}

module.exports = {
  template: 'assets/bomber-x-loco-christmas/team-of-the-tournament.jpeg',
  reference: { width: 1024, height: 1536 },
  serial: null,
  slots: {
    forward: [slot(356, 410, 59, 268, 428, 494), slot(667, 410, 59, 580, 740, 494)],
    midfielder: [
      slot(149, 633, 53, 71, 212, 709),
      slot(332, 676, 53, 254, 395, 753),
      slot(512, 633, 53, 435, 575, 709),
      slot(690, 676, 53, 615, 755, 753),
      slot(875, 633, 53, 800, 940, 709),
    ],
    defender: [
      slot(252, 888, 58, 166, 323, 971),
      slot(512, 908, 58, 427, 582, 987),
      slot(771, 888, 58, 686, 841, 971),
    ],
    goalkeeper: [slot(512, 1125, 59, 422, 586, 1210)],
  },
};
