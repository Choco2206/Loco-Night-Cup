'use strict';

function card(key, suffix, centerX, centerY, left, right, nameTop, statTop) {
  return {
    key,
    suffix,
    logo: [[-77, 0], [-40, -58], [40, -58], [77, 0], [40, 58], [-40, 58]]
      .map(([x, y]) => [centerX + x, centerY + y]),
    name: { x: left, y: nameTop, width: right - left, height: 34 },
    stat: { x: left, y: statTop, width: right - left, height: 32 },
  };
}

module.exports = {
  template: 'assets/bomber-x-loco-christmas/special-awards.jpeg',
  reference: { width: 1536, height: 1024 },
  serial: null,
  textColor: '#fff4d9',
  awards: [
    card('goals', 'Tore', 245, 307, 109, 382, 386, 437),
    card('assists', 'Vorlagen', 596, 307, 465, 729, 386, 437),
    card('tacklesMade', 'erfolgreiche Zweikämpfe', 943, 307, 809, 1076, 386, 437),
    card('saves', 'Paraden', 1292, 307, 1160, 1425, 386, 437),
    card('cleanSheets', 'Clean Sheets', 244, 629, 109, 381, 705, 758),
    card('passesMade', 'erfolgreiche Pässe', 596, 629, 465, 729, 705, 758),
    card('averageRating', 'Ø-Bewertung', 943, 629, 810, 1076, 705, 758),
    card('manOfTheMatch', 'Auszeichnungen', 1293, 629, 1161, 1426, 705, 758),
  ],
};
