'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault, createTottHistoryDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById, listVisibleTeams } = require('../teams/team-service');
const { confirmedEventMatches, resumeRatingCaptures } = require('./team-of-the-tournament-service');

const POST_RETRY_DELAYS_MS = [15000, 120000, 300000, 600000, 900000, 900000, 1200000];
const CONTINUOUS_RETRY_DELAY_MS = 15 * 60 * 1000;
const TOTT_GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;
const LIVE_CHANNEL_ID = '1533394601220505641';
const TEST_CHANNEL_ID = '1525035287971889173';
const postTimers = new Map();

function renderTeamOfTheTournament(input) {
  // Canvas erst beim tatsÇÏchlichen Rendern laden. So bleibt Bootstrap/Recovery
  // unabhÇÏngig von nativen Grafik-Bindings, bis wirklich ein Bild gebaut wird.
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
  return `${emoji} **${label}:** ${player.playerName} (${teamName}) ƒ?" ${value} ${suffix}`.trim();
}

function buildAwardsText(performances) {
  const players = aggregatePlayers(performances);
  return [
    'ÐY"¾ **LOCO NIGHT CUP ƒ?" SPECIAL AWARDS** ÐY"¾',
    playerAwardLine('ƒs«', 'Top-TorschÇ¬tze', topPlayer(players, 'goals'), 'goals', 'Tore'),
    playerAwardLine('ÐYZî', 'Assist-KÇônig', topPlayer(players, 'assists'), 'assists', 'Vorlagen'),
    playerAwardLine('ÐYõû', 'Top-AbrÇÏumer', topPlayer(players, 'tacklesMade'), 'tacklesMade', 'erfolgreiche ZweikÇÏmpfe'),
    playerAwardLine('ÐYõÏ', 'Sicherste Hand', topPlayer(players, 'saves'), 'saves', 'Paraden'),
    playerAwardLine('ÐYõñ', 'Defensiv-Monster', topPlayer(players, 'cleanSheets'), 'cleanSheets', 'Clean Sheets'),
    playerAwardLine('ÐY¦"', 'Pass-Maschine', topPlayer(players, 'passesMade'), 'passesMade', 'erfolgreiche PÇÏsse'),
    playerAwardLine('ÐY''', 'MVP der Nacht', topPlayer(players, 'averageRating'), 'averageRating', 'Ç~-Bewertung'),
    playerAwardLine('ƒð?', 'MOTM-KÇônig', topPlayer(players, 'manOfTheMatch'), 'manOfTheMatch', 'Auszeichnungen'),
  ].join('\n');
}

function buildIntroText({ test = false } = {}) {
  return [
    test ? 'ÐYõ¦ **TESTAUSGABE ƒ?" KEINE ECHTE AUSZEICHNUNG**' : null,
    '@everyone',
    'ÐY?Å **TEAM OF THE TOURNAMENT**',
    'Elf Spieler. Eine Nacht. Maximale Aura.',
    '',
    'Herzlichen GlÇ¬ckwunsch an alle Spieler, die es mit ihren Leistungen ins **Team of the Tournament** geschafft haben. Ihr habt abgeliefert, Spiele entschieden und echte **Loco DNA** gezeigt. ÐY"ïƒs®',
    '',
    '**Das ist nicht einfach eine Auswahl ƒ?" das ist die Elite dieser Loco Night.**',
  ].filter(entry => entry !== null).join('\n');
}

function selectionCount(selection) {
  return ['goalkeeper', 'defender', 'midfielder', 'forward']
    .reduce((sum, position) => sum + (selection?.[position]?.length || 0), 0);
}

function workflowSnapshot(event) {
  const state = event.ceremony?.teamOfTheTournament || {};
  const confirmed = confirmedEventMatches(event);
  const capturedIds = new Set((state.capturedMatches || []).map(entry => String(entry.lncMatchId)));
  const linked = confirmed.filter(match => [match.home?.teamId, match.away?.teamId]
    .map(findTeamById).some(team => team?.eaClub?.clubId));
  return {
    confirmedMatches: confirmed.length,
    linkedMatches: linked.length,
    capturedMatches: linked.filter(match => capturedIds.has(String(match.id))).length,
    performances: (state.performances || []).length,
    selectedPlayers: selectionCount(state.selection),
  };
}

function closingRatingsReady(event) {
  const captured = new Set((event.ceremony?.teamOfTheTournament?.capturedMatches || []).map(entry => String(entry.lncMatchId)));
  return confirmedEventMatches(event).every(match => {
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

function legacyScheduleTeamOfTheTournamentPost({ client, eventKey }) {
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
        console.warn(`[tott] ${eventKey}: keine vollstÇÏndige Elf mit mindestens drei Spielen; Post Ç¬bersprungen.`);
        postTimers.delete(eventKey);
        return;
      }
    } catch (error) {
      console.warn(`[tott] Abschluss-Post fÇ¬r ${eventKey} fehlgeschlagen: ${error.message}`);
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

function scheduleTeamOfTheTournamentPost({ client, eventKey }) {
  if (postTimers.has(eventKey)) return false;
  const initialState = readEventData(eventKey).ceremony?.teamOfTheTournament || {};
  const postStartedAt = initialState.postStartedAt || new Date().toISOString();
  updatePostState(eventKey, {
    postStatus: 'pending', postStartedAt,
    postCompletedAt: null, postFailureReason: null,
  });
  let attempt = 0;
  const run = async () => {
    try {
      const current = readEventData(eventKey);
      const resumed = resumeRatingCaptures(eventKey, current);
      const snapshot = workflowSnapshot(current);
      updatePostState(eventKey, {
        postStatus: 'pending', postAttempt: attempt + 1,
        postLastAttemptAt: new Date().toISOString(), postLastResult: null,
        postSnapshot: snapshot,
      });
      console.info(`[tott] ${eventKey}: Postversuch ${attempt + 1}; `
        + `${snapshot.capturedMatches}/${snapshot.linkedMatches} verknÇ¬pfte Spiele erfasst, `
        + `${snapshot.selectedPlayers}/11 Spieler gewÇÏhlt, ${resumed} EA-Abfragen gestartet.`);
      const result = await postTeamOfTheTournament({ client, eventKey });
      if (result.posted || result.reason === 'already_posted') {
        postTimers.delete(eventKey);
        return;
      }
      updatePostState(eventKey, { postLastResult: result.reason, postFailureReason: result.reason });
      const elapsed = Date.now() - new Date(postStartedAt).getTime();
      if (elapsed >= TOTT_GIVE_UP_AFTER_MS) {
        const reason = `${result.reason}; ${snapshot.capturedMatches}/${snapshot.linkedMatches} `
          + `verknÇ¬pfte Spiele erfasst; ${snapshot.selectedPlayers}/11 Spieler gewÇÏhlt`;
        updatePostState(eventKey, {
          postStatus: 'skipped', postCompletedAt: new Date().toISOString(),
          postLastResult: result.reason, postFailureReason: reason,
          postNextAttemptAt: null, postSnapshot: snapshot,
        });
        console.warn(`[tott] ${eventKey}: TOTT nach zwei Stunden aufgegeben: ${reason}. `
          + 'Die Turnierbereinigung ist jetzt freigegeben.');
        postTimers.delete(eventKey);
        return;
      }
    } catch (error) {
      console.warn(`[tott] Abschluss-Post fÇ¬r ${eventKey} fehlgeschlagen: ${error.message}`);
      updatePostState(eventKey, {
        postStatus: 'pending', postLastResult: 'error',
        postFailureReason: String(error.message || 'unknown_error').slice(0, 500),
      });
      if (Date.now() - new Date(postStartedAt).getTime() >= TOTT_GIVE_UP_AFTER_MS) {
        const snapshot = workflowSnapshot(readEventData(eventKey));
        const reason = `error: ${String(error.message || 'unknown_error').slice(0, 300)}; `
          + `${snapshot.capturedMatches}/${snapshot.linkedMatches} verknÇ¬pfte Spiele erfasst; `
          + `${snapshot.selectedPlayers}/11 Spieler gewÇÏhlt`;
        updatePostState(eventKey, {
          postStatus: 'failed', postCompletedAt: new Date().toISOString(),
          postLastResult: 'error', postFailureReason: reason,
          postNextAttemptAt: null, postSnapshot: snapshot,
        });
        console.warn(`[tott] ${eventKey}: TOTT nach zwei Stunden wegen eines Fehlers aufgegeben: ${reason}. `
          + 'Die Turnierbereinigung ist jetzt freigegeben.');
        postTimers.delete(eventKey);
        return;
      }
    }
    attempt += 1;
    const delay = POST_RETRY_DELAYS_MS[attempt] || CONTINUOUS_RETRY_DELAY_MS;
    updatePostState(eventKey, { postNextAttemptAt: new Date(Date.now() + delay).toISOString() });
    const timer = setTimeout(run, delay);
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
      console.warn(`[tott] Wiederherstellung fÇ¬r ${eventKey} fehlgeschlagen; Botstart lÇÏuft weiter: ${error.message}`);
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
    content: `ÐYõ¦ **FIKTIVE TESTDATEN**\n${buildAwardsText(performances)}`,
    allowedMentions: { parse: [] },
  });
  return { channelId: channel.id, messageId: message.id, awardsMessageId: awardsMessage.id, serialNumber };
}

module.exports = {
  aggregatePlayers, buildAwardsText, buildIntroText, buildTestPerformances, buildTestSelection, closingRatingsReady,
  initTeamOfTheTournament, postTeamOfTheTournament, postTeamOfTheTournamentTest, scheduleTeamOfTheTournamentPost,
  workflowSnapshot,
};

