'use strict';

const { initializeStorage } = require('../storage');
const { validateAllStorage } = require('../validation');
const { repairTeamRuntimeData } = require('../domain/teams/team-runtime-repair');
const { initializeTottStorage } = require('../domain/team-of-the-tournament');

function bootstrapPhaseOne() {
  initializeStorage();
  initializeTottStorage();
  repairTeamRuntimeData();
  validateAllStorage();

  return {
    ok: true,
    phase: 'phase-1-storage-foundation',
  };
}

module.exports = {
  bootstrapPhaseOne,
};
