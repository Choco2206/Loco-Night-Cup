'use strict';

const { FILES, readJson, updateJson } = require('../../storage');
const { createTeamsDefault } = require('../../storage/defaults');

function readTeamsData() {
  return readJson(FILES.teams, createTeamsDefault());
}

function updateTeamsData(updater) {
  return updateJson(FILES.teams, createTeamsDefault(), updater);
}

module.exports = {
  readTeamsData,
  updateTeamsData,
};
