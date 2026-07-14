'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR, readJson, writeJsonAtomic } = require('../../storage');

const DIR = path.join(DATA_DIR, 'team-of-the-tournament');
const FILE = path.join(DIR, 'store.json');
const EMPTY = { version: 1, jobs: [], matches: [], tournamentStats: {}, publications: [], playerImageMappings: [], history: [] };

function initializeTottStorage() {
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(FILE)) writeJsonAtomic(FILE, EMPTY);
}
function readStore() { initializeTottStorage(); const stored = readJson(FILE); return { ...EMPTY, ...stored, jobs: Array.isArray(stored.jobs) ? stored.jobs : [], matches: Array.isArray(stored.matches) ? stored.matches : [], tournamentStats: stored.tournamentStats && typeof stored.tournamentStats === 'object' ? stored.tournamentStats : {}, publications: Array.isArray(stored.publications) ? stored.publications : [], playerImageMappings: Array.isArray(stored.playerImageMappings) ? stored.playerImageMappings : [] }; }
function updateStore(mutator) { const next = mutator(readStore()); writeJsonAtomic(FILE, next); return next; }

module.exports = { DIR, FILE, initializeTottStorage, readStore, updateStore };
