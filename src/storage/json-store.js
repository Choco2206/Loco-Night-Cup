'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;

    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error(`Could not read JSON file: ${filePath}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, payload, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {}
    }

    const wrapped = new Error(`Could not write JSON file atomically: ${filePath}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function ensureJsonFile(filePath, defaultFactory) {
  if (fs.existsSync(filePath)) return readJson(filePath);

  const data = typeof defaultFactory === 'function' ? defaultFactory() : defaultFactory;
  writeJsonAtomic(filePath, data);
  return data;
}

function updateJson(filePath, fallback, updater) {
  const current = readJson(filePath, fallback);
  const next = updater(current);
  writeJsonAtomic(filePath, next);
  return next;
}

module.exports = {
  ensureDir,
  ensureJsonFile,
  readJson,
  updateJson,
  writeJsonAtomic,
};
