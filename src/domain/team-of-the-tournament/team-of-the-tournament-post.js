Exit code: 0
Wall time: 1.3 seconds
Output:
'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault, createTottHistoryDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById, listVisibleTeams } = require('../teams/team-service');
const { resumeRatingCaptures } = require('./team-of-the-tournament-service');

const POST_RETRY_DELAYS_MS = [15000, 120000, 300000, 360000];
const LIVE_CHANNEL_ID = '1533394601220505641';
const TEST_CHANNEL_ID = '1525035287971889173';
const postTimers = new Map();

function renderTeamOfTheTournament(input) {
  // Canvas erst beim tatsaechlichen Rendern laden. So bleibt Bootstrap/Recovery
  // unabhaengig von nativen Grafik-Bindings, bis wirklich ein Bild gebaut wird.
  return require('../../../utils/team-of-the-tournament-renderer').renderTeamOfTheTournament(input);
}

function updatePostState(eventKey, values) {
  updateEventData(eventKey, event => {
    event.ceremony = event.ceremony || {};
    event.ceremony.teamOfTheTournament = event.ceremony.teamOfTheTournament || {};
    Object.assign(event.ceremony.teamOfTheTournament, values, { updatedAt: new Date().toISOString() });
    return event;
  });
}

function aggregatePlayers(performances) {
  const players = new Map();
  for (const row of performances || []) {
    const key = `${row.teamId}:${row.playerId}`;
    const player = players.get(key) || {
      teamId: row.teamId, playerId: row.playerId, playerName: row.playerName, matches: 0,
      ratingTotal: 0, goals: 0, assists: 0, tacklesMade: 0, saves: 0,
      cleanSheets: 0, passesMade: 0, manOfTheMatch: 0,
    };
    player.playerName = row.playerName;
    player.matches += 1;
    player.ratingTotal += Number(row.rating) || 0;
    for (const field of ['goals', 'assists', 'tacklesMade', 'saves', 'cleanSheets', 'passesMade', 'manOfTheMatch']) {
      player[field] += Number(row[field]) || 0;
    }
    players.set(key, player);
  }
  return [...players.values()].filter(player => player.matches >= 3).map(player => ({
    ...player, averageRating: player.ratingTotal / player.matches,
  }));
}

function topPlayer(players, field) {
  const winner = [...players].sort((a, b) => Number(b[field]) - Number(a[field])
    || b.averageRating - a.averageRating || b.matches - a.matches)[0] || null;
  if (winner && field !== 'averageRating' && Number(winner[field]) <= 0) return null;
  return winner;
}

function playerAwardLine(emoji, label, player, field, suffix) {
  if (!player) return `${emoji} **${label}:** nicht vergeben`;
  const teamName = findTeamById(player.teamId)?.clubName || 'Unbekanntes Team';
  const value = field === 'averageRating'
    ? player.averageRating.toFixed(2).replace('.', ',')
    : Number(player[field]) || 0;
  return `${emoji} **${label}:** ${player.playerName} (${teamName}) â€“ ${value} ${suffix}`.trim();
}

function buildAwardsText(performances) {
  const players = aggregatePlayers(performances);
  return [
    'ðŸ”¥ **LOCO NIGHT CUP â€“ SPECIAL AWARDS** ðŸ”¥',
    playerAwardLine('âš½', 'Top-TorschÃ¼tze', topPlayer(players, 'goals'), 'goals', 'Tore'),
    playerAwardLine('ðŸŽ¯', 'Assist-KÃ¶nig', topPlayer(players, 'assists'), 'assists', 'Vorlagen'),
    playerAwardLine('ðŸ§¹', 'Top-AbrÃ¤umer', topPlayer(players, 'tacklesMade'), 'tacklesMade', 'erfolgreiche ZweikÃ¤mpfe'),
    playerAwardLine('ðŸ§¤', 'Sicherste Hand', topPlayer(players, 'saves'), 'saves', 'Paraden'),
    playerAwardLine('ðŸ§±', 'Defensiv-Monster', topPlayer(players, 'cleanSheets'), 'cleanSheets', 'Clean Sheets'),
    playerAwardLine('ðŸª„', 'Pass-Maschine', topPlayer(players, 'passesMade'), 'passesMade', 'erfolgreiche PÃ¤sse'),
    playerAwardLine('ðŸ‘‘', 'MVP der Nacht', topPlayer(players, 'averageRating'), 'averageRating', 'Ã˜-Bewertung'),
    playerAwardLine('â­', 'MOTM-KÃ¶nig', topPlayer(players, 'manOfTheMatch'), 'manOfTheMatch', 'Auszeichnungen'),
  ].join('\n');
}

function buildIntroText({ test = false } = {}) {
  return [
    test ? 'ðŸ§ª **TESTAUSGABE â€“ KEINE ECHTE AUSZEICHNUNG**' : null,
    '@everyone',
    'ðŸ† **TEAM OF THE TOURNAMENT**',
    'Elf Spieler. Eine Nacht. Maximale Aura.',
    '',
    'Herzlichen GlÃ¼ckwunsch an alle Spieler, die es mit ihren Leistungen ins **Team of the Tournament** geschafft haben. Ihr habt abgeliefert, Spiele entschieden und echte **Loco DNA** gezeigt. ðŸ”´âš«',
    '',
    '**Das ist nicht einfach eine Auswahl â€“ das ist die Elite dieser Loco Night.**',
  ].filter(entry => entry !== null).join('\n');
}

function selectionCount(selection) {
  return ['goalkeeper', 'defender', 'midfielder', 'forward']
    .reduce((sum, position) => sum + (selection?.[position]?.length || 0), 0);
}

function closingMatches(event) {
  return ['final', 'third_place'].flatMap(key => event.knockout?.rounds?.[key]?.matches || []);
}

function closingRatingsReady(event) {
  const captured = new Set((event.ceremony?.teamOfTheTournament?.capturedMatches || []).map(entry => String(entry.lncMatchId)));
  return closingMatches(event).every(match => {
    if (match.status !== 'confirmed') return false;
    const linkedCount = [match.home?.teamId, match.away?.teamId]
      .map(findTeamById).filter(team => team?.eaClub?.clubId).length;
    return linkedCount === 0 || captured.has(String(match.id));
  });
}

function reserveSerial(eventKey) {
  let serialNumber;
  updateJson(FILES.tottHistory, createTottHistoryDefault(), history => {
    serialNumber = Number(history.lastSerialNumber || 0) + 1;
    history.lastSerialNumber = serialNumber;
    history.posts = Array.isArray(history.posts) ? history.posts : [];
    history.posts.push({ eventKey, serialNumber, reservedAt: new Date().toISOString() });
    return history;
  });
  return serialNumber;
}

async function getTargetChannel(client, mode = 'live') {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const channelId = mode === 'test'
    ? settings.channels?.teamOfTheTournamentTestChannelId || TEST_CHANNEL_ID
    : settings.channels?.teamOfTheTournamentChannelId || LIVE_CHANNEL_ID;
  return client.channels.fetch(channelId).catch(() => null);
}

async function postTeamOfTheTournament({ client, eventKey, force = false }) {
  const event = readEventData(eventKey);
  const state = event.ceremony?.teamOfTheTournament;
  if (state?.postedAt) return { posted: false, reason: 'already_posted' };
  if (!force && !closingRatingsReady(event)) return { posted: false, reason: 'ratings_pending' };
  if (selectionCount(state?.selection) < 11) return { posted: false, reason: 'not_enough_eligible_players' };
  const channel = await getTargetChannel(client);
  if (!channel?.send) throw new Error('Team-of-the-Tournament-Kanal wurde nicht gefunden.');
  const serialNumber = reserveSerial(eventKey);
  const rendered = await renderTeamOfTheTournament({ selection: state.selection, serialNumber });
  const intro = buildIntroText();
  const imageMessage = await channel.send({
    content: intro, files: [{ attachment: rendered.buffer, name: rendered.fileName }],
    allowedMentions: { parse: ['everyone'] },
  });
  const awardsMessage = await channel.send({ content: buildAwardsText(state.performances), allowedMentions: { parse: [] } });
  updateEventData(eventKey, stored => {
    stored.ceremony.teamOfTheTournament = stored.ceremony.teamOfTheTournament || {};
    Object.assign(stored.ceremony.teamOfTheTournament, {
      postedAt: new Date().toISOString(), serialNumber,
      channelId: channel.id, imageMessageId: imageMessage.id, awardsMessageId: awardsMessage.id,
      postStatus: 'posted', postCompletedAt: new Date().toISOString(), postFailureReason: null,
    });
    return stored;
  });
  return { posted: true, serialNumber, channelId: channel.id, imageMessageId: imageMessage.id, awardsMessageId: awardsMessage.id };
}

function scheduleTeamOfTheTournamentPost({ client, eventKey }) {
  if (postTimers.has(eventKey)) return false;
  updatePostState(eventKey, {
    postStatus: 'pending',
    postStartedAt: new Date().toISOString(),
    postCompletedAt: null,
    postFailureReason: null,
  });
  let attempt = 0;
  const run = async () => {
    try {
      const force = attempt === POST_RETRY_DELAYS_MS.length - 1;
      const result = await postTeamOfTheTournament({ client, eventKey, force });
      if (result.posted || result.reason === 'already_posted') {
        postTimers.delete(eventKey);
        return;
      }
      if (result.reason === 'not_enough_eligible_players' && force) {
        updatePostState(eventKey, {
          postStatus: 'skipped', postCompletedAt: new Date().toISOString(),
          postFailureReason: 'not_enough_eligible_players',
        });
        console.warn(`[tott] ${eventKey}: keine vollstaendige Elf mit mindestens drei Spielen; Post uebersprungen.`);
        postTimers.delete(eventKey);
        return;
      }
    } catch (error) {
      console.warn(`[tott] Abschluss-Post fuer ${eventKey} fehlgeschlagen: ${error.message}`);
      if (attempt === POST_RETRY_DELAYS_MS.length - 1) {
        updatePostState(eventKey, {
          postStatus: 'failed', postCompletedAt: new Date().toISOString(),
          postFailureReason: String(error.message || 'unknown_error').slice(0, 500),
        });
      }
    }
    attempt += 1;
    if (attempt >= POST_RETRY_DELAYS_MS.length) {
      const latest = readEventData(eventKey);
      if (latest.ceremony?.teamOfTheTournament?.postStatus === 'pending') {
        updatePostState(eventKey, {
          postStatus: 'failed', postCompletedAt: new Date().toISOString(),
          postFailureReason: 'retry_limit_reached',
        });
      }
      return postTimers.delete(eventKey);
    }
    const timer = setTimeout(run, POST_RETRY_DELAYS_MS[attempt]);
    if (typeof timer.unref === 'function') timer.unref();
    postTimers.set(eventKey, timer);
  };
  const timer = setTimeout(run, POST_RETRY_DELAYS_MS[0]);
  if (typeof timer.unref === 'function') timer.unref();
  postTimers.set(eventKey, timer);
  return true;
}

async function initTeamOfTheTournament(client) {
  for (const eventKey of EVENT_KEYS) {
    try {
      const event = readEventData(eventKey);
      if (event?.knockout?.status !== 'completed' || event?.ceremony?.teamOfTheTournament?.postedAt) continue;
      const resumed = resumeRatingCaptures(eventKey, event);
      scheduleTeamOfTheTournamentPost({ client, eventKey });
      console.info(`[tott] ${eventKey}: Abschluss nach Neustart fortgesetzt; ${resumed} EA-Abfragen wiederhergestellt.`);
    } catch (error) {
      console.warn(`[tott] Wiederherstellung fuer ${eventKey} fehlgeschlagen; Botstart laeuft weiter: ${error.message}`);
    }
  }
  return true;
}

function randomItem(items, index) {
  return items.length ? items[index % items.length] : null;
}

function buildTestSelection() {
  const teams = listVisibleTeams().filter(team => team.logo?.fileName);
  const names = ['Nox', 'Viper', 'Ragnar', 'Kyro', 'Maverick', 'Nova', 'Ghost', 'Zeno', 'Blaze', 'Lynx', 'Ares'];
  let cursor = 0;
  const make = count => Array.from({ length: count }, () => {
    const team = randomItem(teams, Math.floor(Math.random() * Math.max(teams.length, 1)));
    const player = {
      teamId: team?.id || null, playerId: `test-${cursor}`, playerName: names[cursor], matches: 4,
      averageRating: Number((6.5 + Math.random() * 3.4).toFixed(2)),
    };
    cursor += 1;
    return player;
  });
  return { goalkeeper: make(1), defender: make(3), midfielder: make(5), forward: make(2) };
}

function buildTestPerformances(selection) {
  return Object.values(selection).flat().flatMap((player, playerIndex) => (
    Array.from({ length: 3 }, (_, matchIndex) => ({
      teamId: player.teamId,
      playerId: player.playerId,
      playerName: player.playerName,
      rating: player.averageRating,
      goals: playerIndex % 4 === 0 ? matchIndex + 1 : 0,
      assists: playerIndex % 3 === 0 ? 2 : matchIndex % 2,
      tacklesMade: playerIndex + matchIndex + 2,
      saves: playerIndex === 0 ? 4 + matchIndex : 0,
      cleanSheets: playerIndex < 4 && matchIndex !== 1 ? 1 : 0,
      passesMade: 18 + playerIndex * 3 + matchIndex,
      manOfTheMatch: matchIndex === 0 && playerIndex % 5 === 0 ? 1 : 0,
    }))
  ));
}

async function postTeamOfTheTournamentTest(client) {
  const channel = await getTargetChannel(client, 'test');
  if (!channel?.send) throw new Error('Team-of-the-Tournament-Testkanal wurde nicht gefunden.');
  const serialNumber = 1 + Math.floor(Math.random() * 10);
  const selection = buildTestSelection();
  const performances = buildTestPerformances(selection);
  const rendered = await renderTeamOfTheTournament({ selection, serialNumber });
  const message = await channel.send({
    content: buildIntroText({ test: true }),
    files: [{ attachment: rendered.buffer, name: `test-${rendered.fileName}` }], allowedMentions: { parse: [] },
  });
  const awardsMessage = await channel.send({
    content: `ðŸ§ª **FIKTIVE TESTDATEN**\n${buildAwardsText(performances)}`,
    allowedMentions: { parse: [] },
  });
  return { channelId: channel.id, messageId: message.id, awardsMessageId: awardsMessage.id, serialNumber };
}

module.exports = {
  aggregatePlayers, buildAwardsText, buildIntroText, buildTestPerformances, buildTestSelection, closingRatingsReady,
  initTeamOfTheTournament, postTeamOfTheTournament, postTeamOfTheTournamentTest, scheduleTeamOfTheTournamentPost,
};

