'use strict';

// Individually measured against the separate FC 27 Awards Arena template.
// The live Special Awards continue to use the default layout until the
// renderer is explicitly called with variant `fc27`.
module.exports = {
  template: 'assets/special-awards/special-awards-fc27.jpeg',
  reference: { width: 1536, height: 1024 },
  serial: { x: 1225, y: 157, width: 250, height: 58, maxFontSize: 42 },
  textColor: '#f5c968',
  awards: [
    {
      key: 'goals', suffix: 'Tore',
      logo: [[89, 322], [145, 305], [201, 322], [198, 389], [145, 416], [89, 389]],
      name: { x: 85, y: 420, width: 310, height: 28 },
      stat: { x: 94, y: 453, width: 292, height: 26 },
    },
    {
      key: 'assists', suffix: 'Vorlagen',
      logo: [[1145, 322], [1201, 305], [1256, 322], [1253, 389], [1201, 416], [1145, 389]],
      name: { x: 1141, y: 420, width: 310, height: 28 },
      stat: { x: 1150, y: 453, width: 292, height: 26 },
    },
    {
      key: 'tacklesMade', suffix: 'erfolgreiche Zweikämpfe',
      logo: [[89, 553], [145, 536], [201, 553], [198, 625], [145, 653], [89, 625]],
      name: { x: 85, y: 655, width: 310, height: 29 },
      stat: { x: 94, y: 689, width: 292, height: 26 },
    },
    {
      key: 'saves', suffix: 'Paraden',
      logo: [[1145, 553], [1201, 536], [1256, 553], [1253, 625], [1201, 653], [1145, 625]],
      name: { x: 1141, y: 655, width: 310, height: 29 },
      stat: { x: 1150, y: 689, width: 292, height: 26 },
    },
    {
      key: 'cleanSheets', suffix: 'Clean Sheets',
      logo: [[89, 795], [145, 777], [201, 795], [198, 865], [145, 892], [89, 865]],
      name: { x: 85, y: 892, width: 310, height: 28 },
      stat: { x: 94, y: 925, width: 292, height: 27 },
    },
    {
      key: 'passesMade', suffix: 'erfolgreiche Pässe',
      logo: [[1145, 795], [1201, 777], [1256, 795], [1253, 865], [1201, 892], [1145, 865]],
      name: { x: 1141, y: 892, width: 310, height: 28 },
      stat: { x: 1150, y: 925, width: 292, height: 27 },
    },
    {
      key: 'averageRating', suffix: 'Ø-Bewertung',
      logo: [[559, 408], [634, 384], [710, 408], [705, 526], [634, 564], [562, 526]],
      name: { x: 562, y: 625, width: 410, height: 38 },
      stat: { x: 570, y: 672, width: 395, height: 37 },
    },
    {
      key: 'manOfTheMatch', suffix: 'Auszeichnungen',
      logo: [[522, 804], [578, 787], [634, 804], [632, 880], [578, 913], [522, 880]],
      name: { x: 783, y: 812, width: 242, height: 42 },
      stat: { x: 783, y: 862, width: 242, height: 42 },
    },
  ],
};
