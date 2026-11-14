'use strict';

const reference = { width: 1024, height: 1536 };

function cardRound(template, rows, columns, logoSize) {
  const matches = columns.flatMap(({ logoX, nameX, nameWidth, scoreX }) => rows.map(([homeY, awayY]) => {
    const team = y => ({
      logo: { centerX: logoX, centerY: y, width: logoSize, height: logoSize },
      teamName: { x: nameX, y, width: nameWidth, height: logoSize, fontSize: logoSize - 4 },
    });
    return {
      home: team(homeY),
      away: team(awayY),
      score: { home: { x: scoreX, y: homeY, width: 44 }, away: { x: scoreX, y: awayY, width: 44 } },
    };
  }));
  return { template: `assets/bomber-x-loco-christmas/${template}.jpeg`, reference, kind: 'round', matches, splitScore: true };
}

module.exports = {
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
  fonts: {
    team: { family: 'Open Sans', weight: '600', minSize: 13 },
    score: { family: 'Oxanium', weight: '700', minSize: 14, maxSize: 25 },
  },
  colors: { text: '#ffffff' },
};
