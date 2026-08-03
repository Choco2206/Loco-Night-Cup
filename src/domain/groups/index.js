'use strict';

const groupReleases = require('./group-releases');
const attendance = require('./attendance-service');

module.exports = {
  ...require('./group-channels'),
  ...require('./group-service'),
  ...require('./group-draw'),
  ...require('./group-embeds'),
  ...require('./group-access-sync'),
  ...attendance,
  ...require('./group-interactions'),
  ...require('./group-matches'),
  ...require('./group-message-cleanup'),
  ...require('./group-posts'),
  ...require('./group-replacements'),
  ...groupReleases,
  ...require('./group-results'),
  ...require('./group-roles'),
  init: async client => {
    await attendance.initAttendance(client);
    await groupReleases.initGroupReleases(client);
  },
};

