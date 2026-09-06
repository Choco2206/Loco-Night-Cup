'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const koLayouts = require('../config/loco-zwergen-cup-ko-image-layouts');
const tottLayout = require('../config/loco-zwergen-cup-tott-layout');
const awardsLayout = require('../config/loco-zwergen-cup-special-awards-layout');
const ceremonyLayout = require('../config/loco-zwergen-cup-ceremony-layout');
const scheduleLayout = require('../config/loco-zwergen-cup-group-schedule-layout');
const { getKoLayout } = require('../utils/ko-image-renderer');

test('Zwergen layouts use only the dedicated JPEG templates', () => {
  assert.equal(tottLayout.template, 'assets/loco-zwerge-cup/team-of-the-tournament.jpeg');
  assert.equal(awardsLayout.template, 'assets/loco-zwerge-cup/special-awards.jpeg');
  assert.equal(ceremonyLayout.template, 'assets/loco-zwerge-cup/ceremony.jpeg');
  for (const phase of ['round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final']) {
    assert.match(koLayouts[phase].template, /^assets\/loco-zwerge-cup\/.*\.jpeg$/);
  }
});

test('Zwergen match and knockout layouts contain the normal tournament row counts', () => {
  assert.equal(scheduleLayout.rowsY.length, 6);
  assert.equal(koLayouts.round_of_16.matches.length, 8);
  assert.equal(koLayouts.quarter_final.matches.length, 4);
  assert.equal(koLayouts.semi_final.matches.length, 2);
  assert.equal(koLayouts.third_place.matches.length, 1);
  assert.equal(koLayouts.final.matches.length, 1);
});

test('KO selector keeps Bomber, Zwergen and default layouts separate', () => {
  assert.equal(getKoLayout({ phase: 'final', eventId: 'saturday_2026-09-12' }).layout.template, 'assets/loco-zwerge-cup/final.jpeg');
  assert.equal(getKoLayout({ phase: 'final', eventId: 'saturday_2026-09-19' }).layout.template, 'assets/bomber-x-loco/final.png');
  assert.equal(getKoLayout({ phase: 'final', eventId: 'saturday_2026-09-26' }).layout.template, 'assets/ko-phase/finale.png');
});
