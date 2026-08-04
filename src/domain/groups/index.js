'use strict';

const groupReleases = require('./group-releases');
const attendance = require('./attendance-service');
const groupAccess = require('./group-access-sync');

module.exports = {
  ...require('./group-channels'),
  ...require('./group-service'),
  ...require('./group-draw'),
  ...require('./group-embeds'),
  ...groupAccess,
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
    await groupAccess.reconcileActiveGroupChannels(client).catch(error => {
      console.error('Gruppenkanäle konnten beim Start nicht vollständig wiederhergestellt werden:', error);
    });
    await attendance.initAttendance(client);
    await groupReleases.initGroupReleases(client);
  },
};
