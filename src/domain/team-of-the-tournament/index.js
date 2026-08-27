'use strict';

// Gemeinsamer Einstiegspunkt für EA-Club-Verknüpfung und TOTT-Auswertung.

module.exports = {
  ...require('./ea-clubs-client'),
  ...require('./team-of-the-tournament-service'),
  ...require('./team-of-the-tournament-post'),
  ...require('./tott-tracker'),
};
