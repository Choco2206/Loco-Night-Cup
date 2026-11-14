'use strict';

const reference = { width: 1024, height: 1536 };

function cardRound(template, rows, columns, logoSize, nameFontSize = logoSize - 4) {
  const matches = columns.flatMap(({ logoX, nameX, nameWidth, scoreX }) => rows.map(([homeY, awayY]) => {
    const team = y => ({
      logo: { centerX: logoX, centerY: y, width: logoSize, height: logoSize },
      teamName: { x: nameX, y, width: nameWidth, height: logoSize, fontSize: nameFontSize },
    });
    return {
      home: team(homeY),
      away: team(awayY),
      score: { home: { x: scoreX, y: homeY, width: 44 }, away: { x: scoreX, y: awayY, width: 44 } },
    };
  }));
  return { template: `assets/bomber-x-loco-christmas/${template}.jpeg`, reference, kind: 'round', matches, splitScore: true };
}

function qualification(count, width, height, rows, columns, logoSize, fontSize) {
  return {
    template: `assets/bomber-x-loco-christmas/qualified-${count}.jpeg`,
    reference: { width, height },
    kind: 'qualification',
    slots: rows.flatMap(y => columns.map(([logoX, left, right]) => ({
      logo: { centerX: logoX, centerY: y, width: logoSize, height: logoSize },
      teamName: { x: (left + right) / 2, y, width: right - left, height: logoSize, align: 'center', fontSize },
    }))),
  };
}

module.exports = {
  qualification_8: qualification(8, 1536, 1024, [292, 454, 614, 773],
    [[174, 273, 712], [882, 979, 1422]], 78, 34),
  qualification_16: qualification(16, 1672, 941, [291, 421, 550, 676],
    [[90, 142, 389], [495, 548, 796], [902, 951, 1200], [1309, 1360, 1611]], 56, 25),
  qualification_32: qualification(32, 1536, 1024, [248, 328, 407, 486, 565, 645, 724, 803],
    [[98, 138, 375], [457, 498, 738], [820, 860, 1098], [1181, 1221, 1459]], 38, 23),
  round_of_32: cardRound('round-of-32', [
    [346, 388], [472, 514], [596, 638], [720, 761],
    [841, 880], [958, 997], [1075, 1114], [1190, 1230],
  ], [
    { logoX: 133, nameX: 155, nameWidth: 253, scoreX: 447 },
    { logoX: 644, nameX: 666, nameWidth: 252, scoreX: 957 },
  ], 29),
  round_of_16: cardRound('round-of-16', [
    [379, 457], [607, 686], [833, 911], [1054, 1132],
  ], [
    { logoX: 151, nameX: 177, nameWidth: 217, scoreX: 440 },
    { logoX: 659, nameX: 685, nameWidth: 218, scoreX: 949 },
  ], 38),
  quarter_final: cardRound('quarter-final', [
    [486, 550], [687, 753], [889, 955], [1091, 1157],
  ], [
    { logoX: 185, nameX: 220, nameWidth: 630, scoreX: 922 },
  ], 46),
  semi_final: cardRound('semi-final', [
    [546, 669], [922, 1043],
  ], [
    { logoX: 226, nameX: 278, nameWidth: 564, scoreX: 917 },
  ], 72, 46),
  third_place: cardRound('third-place', [
    [1155, 1297],
  ], [
    { logoX: 101, nameX: 156, nameWidth: 688, scoreX: 922 },
  ], 76, 48),
  final: cardRound('final', [
    [1187, 1328],
  ], [
    { logoX: 101, nameX: 156, nameWidth: 688, scoreX: 922 },
  ], 76, 48),
  fonts: {
    team: { family: 'Open Sans', weight: '600', maxSize: 30, minSize: 13 },
    score: { family: 'Oxanium', weight: '700', minSize: 14, maxSize: 25 },
  },
  colors: { text: '#ffffff' },
};
