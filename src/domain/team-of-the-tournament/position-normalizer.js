'use strict';

const config = require('./config');

function normalizePosition(position) {
  const code = String(position || '').trim().toUpperCase();
  if (!code) return null;
  for (const [group, definition] of Object.entries(config.positionGroups)) {
    if (definition.positions.includes(code)) return { code, group };
  }
  return { code, group: null };
}

module.exports = { normalizePosition };
