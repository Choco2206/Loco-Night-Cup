'use strict';

const assert = require('assert');
const { migrateLeaguePhaseRoleId } = require('../src/storage/initialize');
const { validateSettings } = require('../src/validation/settings.schema');
const { createSettingsDefault } = require('../src/storage/defaults');

const CATEGORY_ID = '1526896899934654464';
const VALID_ROLE_ID = '1527000000000000001';

const cases = [
  { label: 'Feld fehlt', prepare: roles => delete roles.leaguePhaseRoleId, expected: null, changed: true },
  { label: 'undefined', value: undefined, expected: null, changed: true },
  { label: 'leerer String', value: '', expected: null, changed: true },
  { label: 'ungueltiger Text', value: 'keine-rolle', expected: null, changed: true },
  { label: 'Kategorie-ID', value: CATEGORY_ID, expected: null, changed: true },
  { label: 'Zahl', value: 1527000000000000001, expected: null, changed: true },
  { label: 'gueltige Rollen-ID', value: VALID_ROLE_ID, expected: VALID_ROLE_ID, changed: false },
  { label: 'null', value: null, expected: null, changed: false },
];

for (const testCase of cases) {
  const settings = createSettingsDefault();
  if (testCase.prepare) testCase.prepare(settings.roles);
  else settings.roles.leaguePhaseRoleId = testCase.value;
  assert.strictEqual(migrateLeaguePhaseRoleId(settings), testCase.changed, `${testCase.label}: changed`);
  assert.strictEqual(settings.roles.leaguePhaseRoleId, testCase.expected, `${testCase.label}: Wert`);
  assert.deepStrictEqual(validateSettings(settings), [], `${testCase.label}: Settings muessen nach Migration gueltig sein`);
}

for (const invalid of ['', 'keine-rolle', 1527000000000000001, {}, undefined]) {
  const settings = createSettingsDefault();
  settings.roles.leaguePhaseRoleId = invalid;
  assert(validateSettings(settings).some(error => error.includes('roles.leaguePhaseRoleId')), `Validator muss ${JSON.stringify(invalid)} ablehnen`);
}

console.log(`leaguePhaseRoleId migration: ${cases.length}/${cases.length} Faelle erfolgreich`);
console.log('leaguePhaseRoleId validator: ungueltige Werte bleiben strikt abgelehnt');
