'use strict';

const groupReleases = require('./group-releases');

module.exports = {
  ...require('./group-channels'),
  ...require('./group-service'),
  ...require('./group-draw'),
  ...require('./group-embeds'),
  ...require('./group-interactions'),
  ...require('./group-matches'),
  ...require('./group-message-cleanup'),
  ...require('./group-posts'),
  ...groupReleases,
  ...require('./group-results'),
  ...require('./group-roles'),
  init: groupReleases.initGroupReleases,
};
