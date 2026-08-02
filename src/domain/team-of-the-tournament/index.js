'use strict';

// Gemeinsamer Einstiegspunkt fuer EA-Club-Verknuepfung und TOTT-Auswertung.

module.exports = {
  ...require('./ea-clubs-client'),
  ...require('./team-of-the-tournament-service'),
};

