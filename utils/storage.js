const fs = require('fs');
const { DATA_DIR, LOGOS_DIR, FILES } = require('./paths');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
  }
}

function ensureDataFolders() {
  ensureDir(DATA_DIR);
  ensureDir(LOGOS_DIR);
}

function ensureJsonFiles() {
  ensureFile(FILES.config, {});
  ensureFile(FILES.setupMessages, {});
  ensureFile(FILES.teams, []);
  ensureFile(FILES.checkins, {});
  ensureFile(FILES.groups, {});
  ensureFile(FILES.results, {});
}

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error(`❌ Fehler beim Lesen von ${filePath}:`, err);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  ensureDataFolders,
  ensureJsonFiles,
  readJson,
  writeJson,
};