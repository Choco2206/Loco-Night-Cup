'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createEventDefault, createSettingsDefault } = require('../src/storage/defaults');
const { validateSettings } = require('../src/validation/settings.schema');
const { ADMIN_CATEGORIES } = require('../src/domain/admin/admin-components');
const { buildCheckinMessagePayload } = require('../src/domain/checkins/checkin-components');
const {
  getGraphicsProfile,
  getGraphicsVariant,
  listGraphicsProfiles,
  normalizeGraphicsProfileKey,
  validateGraphicsProfileAssets,
} = require('../src/domain/graphics/graphics-profile');

test('graphics profile defaults safely and selects FC 27 explicitly', () => {
  assert.equal(normalizeGraphicsProfileKey('unknown'), 'default');
  assert.equal(getGraphicsVariant({}), 'default');
  assert.equal(getGraphicsVariant({ graphics: { activeProfile: 'fc27' } }), 'fc27');
  assert.equal(getGraphicsProfile({ graphics: { activeProfile: 'fc27' } }).checkinBannerPath, 'assets/banners/check-in-fc27.jpeg');
  assert.deepEqual(listGraphicsProfiles().map(profile => profile.key), ['default', 'fc27']);
});

test('settings schema accepts both supported graphics profiles', () => {
  for (const activeProfile of ['default', 'fc27']) {
    const settings = createSettingsDefault();
    settings.graphics.activeProfile = activeProfile;
    assert.deepEqual(validateSettings(settings), []);
  }
  const unsupported = createSettingsDefault();
  unsupported.graphics.activeProfile = 'fc28';
  assert.ok(validateSettings(unsupported).includes('graphics.activeProfile must be default or fc27'));
});

test('admin panel exposes the safe graphics-profile switch', () => {
  assert.ok(ADMIN_CATEGORIES.administration.actions.some(([action]) => action === 'admin_graphics_profile'));
});

test('FC 27 profile selects the uploaded check-in banner', () => {
  const settings = createSettingsDefault();
  settings.graphics.activeProfile = 'fc27';
  const payload = buildCheckinMessagePayload('monday', createEventDefault('monday'), settings);
  assert.equal(payload.files[0].name, 'check-in-fc27.jpeg');
  assert.deepEqual(payload.attachments, []);
});

test('all FC 27 graphics pass the activation preflight', async () => {
  const result = await validateGraphicsProfileAssets('fc27');
  assert.equal(result.profile.key, 'fc27');
  assert.equal(result.checkedAssets, 21);
});

test('existing graphics also remain a valid rollback profile', async () => {
  const result = await validateGraphicsProfileAssets('default');
  assert.equal(result.profile.key, 'default');
  assert.equal(result.checkedAssets, 21);
});
