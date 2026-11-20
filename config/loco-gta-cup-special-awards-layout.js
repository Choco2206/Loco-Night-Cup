'use strict';

function sideAward(key, suffix, offset, row) {
  const [crestY, nameY, statY] = [[312, 421, 454], [547, 658, 691], [782, 894, 927]][row];
  const x = 144 + offset;
  return {
    key, suffix,
    logo: [[x - 48, crestY + 15], [x, crestY], [x + 48, crestY + 15],
      [x + 46, crestY + 67], [x, crestY + 100], [x - 46, crestY + 67]],
    name: { x: 91 + offset, y: nameY, width: 300, height: 27 },
    stat: { x: 101 + offset, y: statY, width: 280, height: 23 },
  };
}

module.exports = {
  template: 'assets/loco-gta-vi-cup/special-awards.jpeg',
  reference: { width: 1536, height: 1024 },
  serial: { x: 1240, y: 160, width: 230, height: 53, maxFontSize: 39 },
  textColor: '#ffe19a',
  awards: [
    sideAward('goals', 'Tore', 0, 0),
    sideAward('assists', 'Vorlagen', 1056, 0),
    sideAward('tacklesMade', 'erfolgreiche Zweikämpfe', 0, 1),
    sideAward('saves', 'Paraden', 1056, 1),
    sideAward('cleanSheets', 'Clean Sheets', 0, 2),
    sideAward('passesMade', 'erfolgreiche Pässe', 1056, 2),
    {
      key: 'averageRating', suffix: 'Ø-Bewertung',
      logo: [[568, 412], [640, 388], [710, 412], [708, 498], [640, 557], [570, 498]],
      name: { x: 547, y: 626, width: 443, height: 36 },
      stat: { x: 550, y: 671, width: 439, height: 34 },
    },
    {
      key: 'manOfTheMatch', suffix: 'Auszeichnungen',
      logo: [[525, 811], [576, 794], [628, 811], [626, 875], [576, 914], [526, 875]],
      name: { x: 790, y: 817, width: 230, height: 34 },
      stat: { x: 790, y: 866, width: 230, height: 32 },
    },
  ],
};
