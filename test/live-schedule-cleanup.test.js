'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const liveScheduleSource = fs.readFileSync(
  path.join(__dirname, '../src/domain/live-schedule/live-schedule-service.js'),
  'utf8',
);
const cleanupSource = fs.readFileSync(
  path.join(__dirname, '../src/domain/events/event-cleanup-service.js'),
  'utf8',
);

assert.match(
  liveScheduleSource,
  /async function cleanupLiveScheduleForEvent\(client, eventKey\)/,
  'Die öffentliche Live-Spielplan-Bereinigung muss implementiert sein.',
);
assert.match(
  liveScheduleSource,
  /scheduleLiveScheduleCleanupForEvent,\s*\n\s*schedulePendingLiveScheduleCleanups/,
  'Der öffentliche Spielplan muss einen eigenen, neustartsicheren Cleanup besitzen.',
);
assert.ok(
  cleanupSource.includes('scheduleLiveScheduleCleanupForEvent(client, eventKey, event)'),
  'Der normale Event-Cleanup muss den separaten Spielplan-Cleanup planen.',
);
assert.ok(
  !cleanupSource.includes('cleanupLiveScheduleForEvent(client, eventKey)'),
  'Der normale Event-Cleanup darf den öffentlichen Spielplan nicht direkt löschen.',
);
assert.match(
  liveScheduleSource,
  /renderLeagueTable\(currentEvent\.leaguePhase\)/,
  'Die Live-Tabelle muss für jede Ligaphase aus den Eventdaten gerendert werden.',
);
assert.match(
  liveScheduleSource,
  /renderLeagueSchedule\(currentEvent\.leaguePhase\)/,
  'Die Begegnungen müssen für jede Ligaphase aus den Eventdaten gerendert werden.',
);

for (const channelName of [
  'nightcup-info-liga',
  'nightcup-info-ko-phase',
  'nightcup-info-achtelfinale',
  'nightcup-info-viertelfinale',
  'nightcup-info-halbfinale',
  'nightcup-info-platz-3',
  'nightcup-info-finale',
]) {
  assert.ok(cleanupSource.includes(`'${channelName}'`), `${channelName} muss beim Cleanup erfasst werden.`);
}

console.log('live-schedule cleanup tests passed');
