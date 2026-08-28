'use strict';

const baseCeremony = require('./ceremony-test-service');
const bomberXLocoCeremony = require('./bomber-x-loco-ceremony');

module.exports = {
  ...baseCeremony,
  ...bomberXLocoCeremony,
  postHallOfFameCeremony: bomberXLocoCeremony.postBomberXLocoCeremony,
  maybePostHallOfFameCeremony: bomberXLocoCeremony.maybePostBomberXLocoCeremony,
};
