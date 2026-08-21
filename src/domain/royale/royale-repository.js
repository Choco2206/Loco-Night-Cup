'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createKnockoutRoyaleDefault } = require('../../storage/defaults');

function readRoyale() {
  return readJson(FILES.knockoutRoyale, createKnockoutRoyaleDefault());
}

function updateRoyale(updater) {
  return updateJson(FILES.knockoutRoyale, createKnockoutRoyaleDefault(), updater);
}

module.exports = { readRoyale, updateRoyale };
