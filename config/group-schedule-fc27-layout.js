'use strict';

const row = centerY => Object.freeze({
  centerY,
  leftLogo: Object.freeze({ centerX: 84, centerY, width: 72, height: 72 }),
  leftName: Object.freeze({ x: 135, y: centerY, maxWidth: 270, align: 'left' }),
  score: Object.freeze({ x: 512, y: centerY - 8, maxWidth: 155 }),
  status: Object.freeze({ x: 512, y: centerY + 29, maxWidth: 175 }),
  rightName: Object.freeze({ x: 888, y: centerY, maxWidth: 270, align: 'right' }),
  rightLogo: Object.freeze({ centerX: 940, centerY, width: 72, height: 72 }),
});

// Individually measured against the separate FC 27 group-schedule template.
// SPIELTAG 1..3 are part of the artwork. All group, team, logo and score
// content remains dynamic.
module.exports = Object.freeze({
  template: 'assets/templates/group-schedule-fc27.jpeg',
  reference: Object.freeze({ width: 1024, height: 1536 }),
  groupName: Object.freeze({ x: 512, y: 413, maxWidth: 820, maxFontSize: 54, minFontSize: 28 }),
  rows: Object.freeze([row(610), row(711), row(909), row(1007), row(1209), row(1307)]),
  fonts: Object.freeze({
    title: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 54, minSize: 28 }),
    team: Object.freeze({ family: 'Open Sans', weight: '600', maxSize: 27, minSize: 14 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 34, minSize: 22 }),
    status: Object.freeze({ family: 'Open Sans', weight: '700', maxSize: 11, minSize: 8 }),
  }),
  colors: Object.freeze({
    text: '#ffffff',
    notReleased: '#9ca3af',
    notReported: '#e5e7eb',
    waiting: '#f5b942',
    confirmed: '#39d98a',
    conflict: '#ff4d5e',
    admin: '#f2c94c',
    bye: '#aeb4bd',
  }),
});
