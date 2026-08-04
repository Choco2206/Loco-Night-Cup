'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mojibakeMarkers = ['Ã', 'Â', 'â€', 'ðŸ', '�', 'ƒ?', 'ÐY'];
const asciiSubstitutes = [
  'Nachruecker', 'fuer', 'auswaehlen', 'bestaetigt', 'Bestaetigung',
  'Teamuebersicht', 'Uebersicht', 'muessen', 'koennen', 'geloescht',
  'verfuegbar', 'naechste', 'Kanaele', 'gueltig', 'Klaerung',
  'zusaetzlich', 'vollstaendig', 'zurueck', 'oeffnen', 'schliessen',
];

function javascriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return javascriptFiles(filePath);
    return entry.isFile() && filePath.endsWith('.js') ? [filePath] : [];
  });
}

test('visible source texts contain neither mojibake nor common German ASCII substitutes', () => {
  const findings = [];
  for (const filePath of javascriptFiles(path.join(__dirname, '..', 'src'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const marker of mojibakeMarkers) {
      if (source.includes(marker)) findings.push(`${path.relative(process.cwd(), filePath)}: ${marker}`);
    }
    for (const substitute of asciiSubstitutes) {
      const pattern = new RegExp(`\\b${substitute}\\b`);
      if (pattern.test(source)) findings.push(`${path.relative(process.cwd(), filePath)}: ${substitute}`);
    }
  }
  assert.deepEqual(findings, []);
});
