'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const roots = ['index.js', 'src', 'systems', 'scripts', 'test'];
const files = [];
function collect(entry) {
  if (!fs.existsSync(entry)) return;
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry)) collect(path.join(entry, child));
  } else if (entry.endsWith('.js')) files.push(entry);
}
roots.forEach(collect);
for (const file of files) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
console.log(`Syntaxpruefung erfolgreich: ${files.length} JavaScript-Dateien.`);
