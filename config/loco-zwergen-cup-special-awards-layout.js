'use strict';

const topLogo = x => [[x, 291], [x + 16, 274], [x + 140, 274], [x + 156, 291], [x + 156, 407], [x + 140, 424], [x + 16, 424], [x, 407]];
const bottomLogo = x => [[x, 594], [x + 16, 577], [x + 140, 577], [x + 156, 594], [x + 156, 711], [x + 140, 728], [x + 16, 728], [x, 711]];

module.exports = {
  template: 'assets/loco-zwerge-cup/special-awards.jpeg',
  reference: { width: 1536, height: 1024 },
  serial: { x: 1210, y: 91, width: 187, height: 114, maxFontSize: 46 },
  textColor: '#f3c66d',
  awards: [
    { key: 'goals', suffix: 'Tore', logo: topLogo(43), name: { x: 47, y: 434, width: 314, height: 36 }, stat: { x: 47, y: 477, width: 314, height: 38 } },
    { key: 'assists', suffix: 'Vorlagen', logo: topLogo(428), name: { x: 414, y: 434, width: 314, height: 36 }, stat: { x: 414, y: 477, width: 314, height: 38 } },
    { key: 'tacklesMade', suffix: 'erfolgreiche Zweikämpfe', logo: topLogo(795), name: { x: 798, y: 434, width: 315, height: 36 }, stat: { x: 798, y: 477, width: 315, height: 38 } },
    { key: 'saves', suffix: 'Paraden', logo: topLogo(1163), name: { x: 1166, y: 434, width: 316, height: 36 }, stat: { x: 1166, y: 477, width: 316, height: 38 } },
    { key: 'cleanSheets', suffix: 'Clean Sheets', logo: bottomLogo(43), name: { x: 47, y: 739, width: 314, height: 35 }, stat: { x: 47, y: 780, width: 314, height: 35 } },
    { key: 'passesMade', suffix: 'erfolgreiche Pässe', logo: bottomLogo(428), name: { x: 414, y: 739, width: 314, height: 35 }, stat: { x: 414, y: 780, width: 314, height: 35 } },
    { key: 'averageRating', suffix: 'Ø-Bewertung', logo: bottomLogo(795), name: { x: 798, y: 739, width: 315, height: 35 }, stat: { x: 798, y: 780, width: 315, height: 35 } },
    { key: 'manOfTheMatch', suffix: 'Auszeichnungen', logo: bottomLogo(1163), name: { x: 1166, y: 739, width: 316, height: 35 }, stat: { x: 1166, y: 780, width: 316, height: 35 } },
  ],
};
