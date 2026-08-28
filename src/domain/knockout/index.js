'use strict';

const bracket = require('./knockout-bracket');
const interactions = require('./knockout-interactions');
const posts = require('./knockout-posts');
const qualification = require('./knockout-qualification');
const results = require('./knockout-results');
const service = require('./knockout-service');
const { initBomberRound32Posts } = require('./bomber-x-loco-round32-post');

async function initKnockoutReleases(client) {
  await posts.initKnockoutReleases(client);
  await initBomberRound32Posts(client);
}

module.exports = {
  ...bracket,
  ...interactions,
  ...posts,
  ...qualification,
  ...results,
  ...service,
  initKnockoutReleases,
};
