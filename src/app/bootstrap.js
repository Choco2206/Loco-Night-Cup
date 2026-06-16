'use strict';

const { initializeStorage } = require('../storage');
const { validateAllStorage } = require('../validation');

function bootstrapPhaseOne() {
  initializeStorage();
  validateAllStorage();

  return {
    ok: true,
    phase: 'phase-1-storage-foundation',
  };
}

module.exports = {
  bootstrapPhaseOne,
};
