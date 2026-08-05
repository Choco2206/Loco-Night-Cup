'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FILES, writeJsonAtomic } = require('../src/storage');
const { createMessagesDefault, createPowerRankingDefault, createSettingsDefault } = require('../src/storage/defaults');
const {
  calculateWeekRanking,
  compareRanking,
  evaluateTournament,
  getWeekWindow,
} = require('../src/domain/power-ranking/power-ranking-core');
const {
  finalizeWeekData,
  processCompletedTournament,
  publishChampionPost,
  recordTournamentEvaluation,
  refreshRankingMessage,
} = require('../src/domain/power-ranking/power-ranking-service');
const { resolveLogoPath } = require('../src/domain/power-ranking/power-ranking-renderer');
const { isPowerRankingSettled } = require('../src/domain/events/event-completion-policy');

function team(teamId) {
  return { type: 'team', teamId: String(teamId), displayName: `Team ${teamId}`, participantKey: `team:${teamId}` };
}

function confirmedLoser(roundKey, loserId) {
  return { roundKey, status: 'confirmed', loser: team(loserId) };
}

function completedEvent(size, { eventKey = 'monday', eventDate = '2026-08-03', finishedAt = '2026-08-03T22:30:00.000Z' } = {}) {
  const participants = Array.from({ length: size }, (_, index) => team(index + 1));
  const qualified = size === 8 ? 4 : size >= 24 ? 16 : 8;
  const rounds = {
    round_of_16: { matches: qualified === 16 ? Array.from({ length: 8 }, (_, index) => confirmedLoser('round_of_16', index + 9)) : [] },
    quarter_final: { matches: qualified >= 8 ? Array.from({ length: 4 }, (_, index) => confirmedLoser('quarter_final', index + 5)) : [] },
    semi_final: { matches: [confirmedLoser('semi_final', 3), confirmedLoser('semi_final', 4)] },
    third_place: { matches: [{ status: 'confirmed', winner: team(3), loser: team(4) }] },
    final: { matches: [{ status: 'confirmed', winner: team(1), loser: team(2) }] },
  };
  return {
    eventKey,
    status: 'ceremony',
    cycle: { cycleKey: `${eventKey}_${eventDate}`, eventDate, timezone: 'Europe/Berlin' },
    format: { size, participants },
    groups: { status: 'completed', groups: {} },
    leaguePhase: { phaseType: [14, 18, 20].includes(size) ? 'league' : null, status: [14, 18, 20].includes(size) ? 'completed' : 'not_created' },
    knockout: {
      status: 'completed', completedAt: finishedAt, rounds,
      placements: { firstTeamId: '1', secondTeamId: '2', thirdTeamId: '3', fourthTeamId: '4' },
    },
    ceremony: { placements: { firstTeamId: '1', secondTeamId: '2', thirdTeamId: '3', fourthTeamId: '4' } },
    meta: {},
  };
}

function evaluationFor(size, options) {
  const event = completedEvent(size, options);
  return evaluateTournament({ eventKey: event.eventKey, event, teamsById: new Map() });
}

test('awards the final cup value across every elimination stage and format', () => {
  const eight = evaluationFor(8);
  assert.equal(eight.results['1'].points, 10, '8er-Sieger');
  assert.equal(eight.results['5'].points, 1, '8er-Gruppenaus');

  const sixteen = evaluationFor(16);
  assert.equal(sixteen.results['1'].points, 10, '16er-Sieger');
  assert.equal(sixteen.results['2'].points, 8, 'Platz 2');
  assert.equal(sixteen.results['3'].points, 6, 'Platz 3');
  assert.equal(sixteen.results['4'].points, 5, 'Platz 4');
  assert.equal(sixteen.results['5'].points, 3, 'Viertelfinal-Aus');
  assert.equal(sixteen.results['9'].points, 1, 'Gruppenphasen-Aus');

  const twenty = evaluationFor(20);
  assert.equal(twenty.results['1'].points, 10, '20er-Ligaphasen-Sieger');
  assert.equal(twenty.results['9'].points, 1, 'Ligaphasen-Aus');

  const twentyFour = evaluationFor(24);
  assert.equal(twentyFour.results['9'].points, 2, 'Achtelfinal-Aus');
  assert.equal(twentyFour.results['17'].points, 1, 'Gruppenphasen-Aus im 24er');
});

test('never evaluates byes as teams', () => {
  const event = completedEvent(8);
  event.format.size = 9;
  event.format.participants.push({ type: 'bye', byeId: 'bye-1', displayName: 'Freilos' });
  const evaluation = evaluateTournament({ eventKey: 'monday', event, teamsById: new Map() });
  assert.equal(Object.keys(evaluation.results).length, 8);
  assert.equal(Object.values(evaluation.results).some(result => result.teamNameSnapshot === 'Freilos'), false);
});

test('uses a neutral champion placeholder when no logo snapshot exists', () => {
  assert.equal(resolveLogoPath(null), null);
});

test('uses the Sunday event date for a cup finishing after midnight', () => {
  const evaluation = evaluationFor(16, {
    eventKey: 'sunday', eventDate: '2026-08-09', finishedAt: '2026-08-09T23:45:00.000Z',
  });
  assert.equal(evaluation.week.weekKey, '2026-W32');
  assert.equal(getWeekWindow(new Date('2026-08-10T00:30:00.000Z')).weekKey, '2026-W33');
});

test('applies every deterministic ranking tiebreaker', () => {
  const base = { points: 10, wins: 0, secondPlaces: 0, thirdPlaces: 0, semifinalOrBetter: 0, cups: 2, latestResultPoints: 1, teamName: 'Beta', teamId: 'b' };
  assert.ok(compareRanking({ ...base, wins: 1 }, base) < 0);
  assert.ok(compareRanking({ ...base, secondPlaces: 1 }, base) < 0);
  assert.ok(compareRanking({ ...base, thirdPlaces: 1 }, base) < 0);
  assert.ok(compareRanking({ ...base, semifinalOrBetter: 1 }, base) < 0);
  assert.ok(compareRanking({ ...base, cups: 1 }, base) < 0);
  assert.ok(compareRanking({ ...base, latestResultPoints: 2 }, base) < 0);
  assert.ok(compareRanking({ ...base, teamName: 'Alpha', teamId: 'a' }, base) < 0);
});

function result(tournamentId, teamId, points, finishedAt, position = null, name = `Team ${teamId}`) {
  return {
    tournamentId, teamId, teamNameSnapshot: name, points, finalPosition: position,
    finalStage: position === 1 ? 'champion' : 'group_or_league', tournamentFinishedAt: finishedAt,
  };
}

test('derives NEU, up, down and unchanged changes from persisted cup chronology', () => {
  const data = createPowerRankingDefault();
  data.tournamentResults.one = {
    tournamentId: 'one', weekKey: '2026-W32', tournamentFinishedAt: '2026-08-03T22:00:00.000Z',
    results: { a: result('one', 'a', 10, '2026-08-03T22:00:00.000Z', 1), b: result('one', 'b', 8, '2026-08-03T22:00:00.000Z', 2), c: result('one', 'c', 6, '2026-08-03T22:00:00.000Z', 3) },
  };
  assert.ok(calculateWeekRanking(data, '2026-W32').teams.every(teamResult => teamResult.changeLabel === 'NEU'));
  data.tournamentResults.two = {
    tournamentId: 'two', weekKey: '2026-W32', tournamentFinishedAt: '2026-08-04T22:00:00.000Z',
    results: { a: result('two', 'a', 1, '2026-08-04T22:00:00.000Z'), b: result('two', 'b', 10, '2026-08-04T22:00:00.000Z', 1), c: result('two', 'c', 1, '2026-08-04T22:00:00.000Z'), d: result('two', 'd', 1, '2026-08-04T22:00:00.000Z') },
  };
  const ranking = new Map(calculateWeekRanking(data, '2026-W32').teams.map(teamResult => [teamResult.teamId, teamResult.changeLabel]));
  assert.match(ranking.get('b'), /^⬆/);
  assert.match(ranking.get('a'), /^⬇/);
  assert.equal(ranking.get('c'), '↔');
  assert.equal(ranking.get('d'), 'NEU');
});

test('keeps stable team IDs across renames and retains deleted-team snapshots', () => {
  const data = createPowerRankingDefault();
  data.tournamentResults.one = { tournamentId: 'one', weekKey: '2026-W32', tournamentFinishedAt: '2026-08-03T22:00:00.000Z', results: { a: result('one', 'a', 10, '2026-08-03T22:00:00.000Z', 1, 'Alter Name'), b: result('one', 'b', 8, '2026-08-03T22:00:00.000Z', 2, 'Gelöschtes Team') } };
  data.tournamentResults.two = { tournamentId: 'two', weekKey: '2026-W32', tournamentFinishedAt: '2026-08-04T22:00:00.000Z', results: { a: result('two', 'a', 8, '2026-08-04T22:00:00.000Z', 2, 'Alter Name') } };
  const current = new Map([['a', { id: 'a', clubName: 'Neuer Name', status: 'active' }], ['b', { id: 'b', clubName: 'Anderer Name', status: 'deleted' }]]);
  const ranking = calculateWeekRanking(data, '2026-W32', current);
  assert.equal(ranking.teams.length, 2);
  assert.equal(ranking.teams.find(entry => entry.teamId === 'a').teamName, 'Neuer Name');
  assert.equal(ranking.teams.find(entry => entry.teamId === 'b').teamName, 'Gelöschtes Team');
});

test('persists idempotently, survives restart, recreates deleted messages and posts one champion with missing logo', async () => {
  const temporary = path.join(__dirname, `.tmp-power-ranking-${process.pid}-${Date.now()}`);
  fs.mkdirSync(temporary, { recursive: true });
  const original = { powerRanking: FILES.powerRanking, settings: FILES.settings, messages: FILES.messages };
  FILES.powerRanking = path.join(temporary, 'power-ranking.json');
  FILES.settings = path.join(temporary, 'settings.json');
  FILES.messages = path.join(temporary, 'messages.json');
  try {
    const settings = createSettingsDefault();
    writeJsonAtomic(FILES.settings, settings);
    const messages = createMessagesDefault();
    messages.powerRanking.messageIds = ['deleted-message'];
    writeJsonAtomic(FILES.messages, messages);
    writeJsonAtomic(FILES.powerRanking, createPowerRankingDefault());

    const evaluation = evaluationFor(16);
    assert.equal(recordTournamentEvaluation(evaluation).created, true);
    assert.equal(isPowerRankingSettled(completedEvent(16)), true, 'gespeicherte Wertung erlaubt späteren Event-Reset');
    assert.equal(recordTournamentEvaluation(evaluation).created, false, 'mehrfacher Abschluss darf keine Duplikate erzeugen');
    const firstDiskState = fs.readFileSync(FILES.powerRanking, 'utf8');
    assert.equal(Object.keys(JSON.parse(firstDiskState).tournamentResults).length, 1);

    let rankingSends = 0;
    let championSends = 0;
    const rankingChannel = {
      id: settings.channels.powerRankingChannelId,
      messages: { fetch: async value => (typeof value === 'object' ? { find: () => null } : null) },
      send: async () => ({ id: `ranking-${++rankingSends}`, edit: async function edit() { return this; }, delete: async () => {} }),
    };
    const championChannel = {
      id: settings.channels.powerRankingChampionChannelId,
      messages: { fetch: async () => ({ find: () => null }) },
      send: async () => ({ id: `champion-${++championSends}` }),
    };
    const client = { channels: { fetch: async id => id === rankingChannel.id ? rankingChannel : championChannel } };
    const refreshed = await refreshRankingMessage(client, evaluation.week.weekKey);
    assert.equal(refreshed.messageIds.length, 1);
    assert.equal(rankingSends, 1, 'gelöschte Ranking-Nachricht wird neu erstellt');

    finalizeWeekData(evaluation.week.weekKey);
    const renderGraphic = async () => ({ buffer: Buffer.from('placeholder-image'), fileName: `power-ranking-champion-${evaluation.week.weekKey}.png` });
    const firstPost = await publishChampionPost(client, evaluation.week.weekKey, { renderGraphic });
    const secondPost = await publishChampionPost(client, evaluation.week.weekKey);
    assert.equal(firstPost.posted, true);
    assert.equal(secondPost.reason, 'already_posted');
    assert.equal(championSends, 1);
    assert.equal(JSON.parse(fs.readFileSync(FILES.powerRanking, 'utf8')).weeks[evaluation.week.weekKey].championPostMessageId, 'champion-1');

    const secondEvent = completedEvent(8, { eventKey: 'tuesday', eventDate: '2026-08-04', finishedAt: '2026-08-04T22:30:00.000Z' });
    await processCompletedTournament({ client: { channels: { fetch: async () => { throw new Error('Discord offline'); } } }, eventKey: 'tuesday', event: secondEvent });
    const afterDiscordFailure = JSON.parse(fs.readFileSync(FILES.powerRanking, 'utf8'));
    assert.ok(afterDiscordFailure.tournamentResults[secondEvent.cycle.cycleKey], 'Discord-Fehler darf gespeicherte Ergebnisse nicht verlieren');
    assert.equal(fs.readFileSync(FILES.powerRanking, 'utf8').includes(evaluation.tournamentId), true, 'Neustart-Lesen verändert keine Daten');
  } finally {
    FILES.powerRanking = original.powerRanking;
    FILES.settings = original.settings;
    FILES.messages = original.messages;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('daily event cleanup has no path that deletes the independent ranking store', () => {
  const cleanupSource = fs.readFileSync(path.join(__dirname, '../src/domain/events/event-cleanup-service.js'), 'utf8');
  assert.equal(cleanupSource.includes('FILES.powerRanking'), false);
});
