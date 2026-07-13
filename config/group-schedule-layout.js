'use strict';

const row = centerY => Object.freeze({
  centerY,
  leftLogo: Object.freeze({ centerX: 104, centerY, width: 72, height: 72 }),
  leftName: Object.freeze({ x: 158, y: centerY, maxWidth: 250, align: 'left' }),
  score: Object.freeze({ x: 512, y: centerY, maxWidth: 150 }),
  status: Object.freeze({ x: 512, y: centerY + 63, maxWidth: 360 }),
  rightName: Object.freeze({ x: 866, y: centerY, maxWidth: 250, align: 'right' }),
  rightLogo: Object.freeze({ centerX: 920, centerY, width: 72, height: 72 }),
});

module.exports = Object.freeze({
  reference: Object.freeze({ width: 1024, height: 1536 }),
  groupName: Object.freeze({ x: 512, y: 397, maxWidth: 610, maxFontSize: 58, minFontSize: 28 }),
  rows: Object.freeze([row(579), row(706), row(884), row(1011), row(1189), row(1317)]),
  fonts: Object.freeze({
    title: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 58, minSize: 28 }),
    team: Object.freeze({ family: 'Open Sans', weight: '600', maxSize: 28, minSize: 15 }),
    score: Object.freeze({ family: 'Oxanium', weight: '700', maxSize: 35, minSize: 24 }),
    status: Object.freeze({ family: 'Open Sans', weight: '700', maxSize: 15, minSize: 10 }),
    fallback: Object.freeze({ family: 'Open Sans', weight: '700', maxSize: 38, minSize: 24 }),
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
    fallback: '#ff344d',
    debug: '#00e5ff',
  }),
});
