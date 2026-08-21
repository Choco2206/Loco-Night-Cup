'use strict';

const { ROYALE_FORMAT_SIZES } = require('../../app/constants');

function chooseRoyaleFormat(participantCount) {
  let size = null;
  for (const candidate of ROYALE_FORMAT_SIZES) {
    if (candidate <= Number(participantCount)) size = candidate;
  }
  return size;
}

function calculateRoyaleCheckin(entries = []) {
  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const teamId = String(entry?.teamId || '').trim();
    if (!teamId || seen.has(teamId)) continue;
    seen.add(teamId);
    unique.push(entry);
  }
  const size = chooseRoyaleFormat(unique.length);
  return {
    size,
    activeEntries: size ? unique.slice(0, size) : [],
    waitlistEntries: size ? unique.slice(size) : unique.slice(),
    nextMilestone: ROYALE_FORMAT_SIZES.find(candidate => candidate > unique.length) || null,
  };
}

module.exports = { calculateRoyaleCheckin, chooseRoyaleFormat };
