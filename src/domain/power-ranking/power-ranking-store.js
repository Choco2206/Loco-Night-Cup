'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createPowerRankingDefault } = require('../../storage/defaults');

function readPowerRankingData() {
  return readJson(FILES.powerRanking, createPowerRankingDefault());
}

function updatePowerRankingData(updater) {
  return updateJson(FILES.powerRanking, createPowerRankingDefault(), updater);
}

module.exports = { readPowerRankingData, updatePowerRankingData };
