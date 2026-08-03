'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildQualificationAudit } = require('../src/domain/league-phase/league-phase-qualification-audit');

test('documents the top-eight cutoff and the decisive league tiebreaker', () => {
  const standings = Array.from({ length: 10 }, (_, index) => ({
    teamId: `team-${index + 1}`,
    participantKey: `team:team-${index + 1}`,
    displayName: `Team ${index + 1}`,
    points: 20 - index,
    goalDifference: 10 - index,
    goalsFor: 20 - index,
    goalsAgainst: 10,
  }));
  standings[7].points = 10;
  standings[8].points = 10;
  standings[9].points = 5;
  standings[7].goalDifference = 2;
  standings[8].goalDifference = 1;
  const payload = buildQualificationAudit({
    leaguePhase: { phaseType: 'league', groupKey: 'league', standings, matchdays: [], completedAt: new Date().toISOString() },
  });
  const json = payload.embeds.map(embed => embed.toJSON());
  assert.match(json[0].description, /08\. âœ….*Team 8/);
  assert.match(json[0].description, /09\. âŒ.*Team 9/);
  assert.match(json[1].description, /Team 8 ist qualifiziert/);
  assert.match(json[1].description, /bessere Tordifferenz/);
});

