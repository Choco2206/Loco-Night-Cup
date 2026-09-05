'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault, createTottHistoryDefault } = require('../../storage/defaults');
const { isBomberXLocoEvent } = require('../events/bomber-x-loco-config');
const { readEventData, updateEventData } = require('../events/event-repository');
const { findTeamById, listVisibleTeams } = require('../teams/team-service');
const {
  capturePendingMatchesNow, confirmedEventMatches, requiresEaCapture, resumeRatingCaptures,
} = require('./team-of-the-tournament-service');

const TOTT_GRACE_PERIOD_MS = 5 * 60 * 1000;
const POST_RETRY_DELAYS_MS = [120000, 120000, 300000, 600000, 900000, 900000, 1200000];
const CONTINUOUS_RETRY_DELAY_MS = 15 * 60 * 1000;
const TOTT_GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;
const LIVE_CHANNEL_ID = '1533394601220505641';
const TEST_CHANNEL_ID = '1525035287971889173';
const postTimers = new Map();

function renderTeamOfTheTournament(input) {
  return require('../../../utils/team-of-the-tournament-renderer').renderTeamOfTheTournament(input);
}

function renderSpecialAwards(input) {
  return require('../../../utils/special-awards-renderer').renderSpecialAwards(input);
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
  return `${emoji} **${label}:** ${player.playerName} (${teamName}) – ${value} ${suffix}`.trim();
}

function buildAwardsText(performances) {
  const players = aggregatePlayers(performances);
  return [
    '🔥 **LOCO NIGHT CUP – SPECIAL AWARDS** 🔥',
    playerAwardLine('⚽', 'Top-Torschütze', topPlayer(players, 'goals'), 'goals', 'Tore'),
    playerAwardLine('🎯', 'Assist-König', topPlayer(players, 'assists'), 'assists', 'Vorlagen'),
    playerAwardLine('🧹', 'Top-Abräumer', topPlayer(players, 'tacklesMade'), 'tacklesMade', 'erfolgreiche Zweikämpfe'),
    playerAwardLine('🧤', 'Sicherste Hand', topPlayer(players, 'saves'), 'saves', 'Paraden'),
    playerAwardLine('🧱', 'Defensiv-Monster', topPlayer(players, 'cleanSheets'), 'cleanSheets', 'Clean Sheets'),
    playerAwardLine('🪄', 'Pass-Maschine', topPlayer(players, 'passesMade'), 'passesMade', 'erfolgreiche Pässe'),
    playerAwardLine('👑', 'MVP der Nacht', topPlayer(players, 'averageRating'), 'averageRating', 'Ø-Bewertung'),
    playerAwardLine('⭐', 'MOTM-König', topPlayer(players, 'manOfTheMatch'), 'manOfTheMatch', 'Auszeichnungen'),
  ].join('\n');
}

function selectSpecialAwards(performances) {
  const players = aggregatePlayers(performances);
  return {
    goals: topPlayer(players, 'goals'), assists: topPlayer(players, 'assists'),
    tacklesMade: topPlayer(players, 'tacklesMade'), saves: topPlayer(players, 'saves'),
    cleanSheets: topPlayer(players, 'cleanSheets'), passesMade: topPlayer(players, 'passesMade'),
    averageRating: topPlayer(players, 'averageRating'), manOfTheMatch: topPlayer(players, 'manOfTheMatch'),
  };
}

function buildIntroText({ test = false, variant = 'default' } = {}) {
  if (variant === 'bomber_x_loco') {
    return [
      test ? '🧪 **TESTAUSGABE – KEINE ECHTE AUSZEICHNUNG**' : null,
      '@everyone',
      '🏆 **BOMBER X LOCO CUP – TEAM OF THE TOURNAMENT**',
      'Zwei Communities. Ein gemeinsamer Cup. Elf Spieler, die diesem besonderen Abend ihren Stempel aufgedrückt haben.',
      '',
      'Herzlichen Glückwunsch an alle Spieler, die es mit ihren Leistungen ins **Team of the Tournament** geschafft haben. Ihr habt Spiele entschieden, Verantwortung übernommen und auf der gemeinsamen Bühne von Bomber Cup und Loco Night Cup abgeliefert. 💣🐺',
      '',
      '**Das ist die beste Elf des Bomber X Loco Cups.**',
    ].filter(entry => entry !== null).join('\n');
  }
  return [
    test ? '🧪 **TESTAUSGABE – KEINE ECHTE AUSZEICHNUNG**' : null,
    '@everyone',
    '🏆 **TEAM OF THE TOURNAMENT**',
    'Elf Spieler. Eine Nacht. Maximale Aura.',
    '',
    'Herzlichen Glückwunsch an alle Spieler, die es mit ihren Leistungen ins **Team of the Tournament** geschafft haben. Ihr habt abgeliefert, Spiele entschieden und echte **Loco DNA** gezeigt. 🔴⚫',
    '',
    '**Das ist nicht einfach eine Auswahl – das ist die Elite dieser Loco Night.**',
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
  const linked = confirmed.filter(requiresEaCapture).filter(match => [match.home?.teamId, match.away?.teamId]
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
  return confirmedEventMatches(event).filter(requiresEaCapture).every(match => {
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

function errorDetails(error) {
  return {
    message: String(error?.message || 'unknown_error'),
    code: error?.code ?? null,
    status: error?.status ?? error?.httpStatus ?? error?.rawError?.status ?? null,
  };
}

async function getTargetChannel(client, mode = 'live') {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const configuredId = mode === 'test'
    ? settings.channels?.teamOfTheTournamentTestChannelId
    : settings.channels?.teamOfTheTournamentChannelId;
  const fallbackId = mode === 'test' ? TEST_CHANNEL_ID : LIVE_CHANNEL_ID;
  const channelId = configuredId || fallbackId;
  const source = configuredId ? 'settings.json' : 'Fallback';

  console.info(`[tott-channel] Zielkanal: ${channelId}; Quelle: ${source}`);
  try {
    const channel = await client.channels.fetch(channelId);
    console.info(`[tott-channel] Kanal gefunden: id=${channel?.id || 'null'}; name=${channel?.name || 'unbekannt'}; `
      + `type=${channel?.type ?? 'unbekannt'}; guildId=${channel?.guildId || channel?.guild?.id || 'unbekannt'}; `
      + `send=${typeof channel?.send === 'function'}`);
    return channel;
  } catch (error) {
    const details = errorDetails(error);
    console.error(`[tott-channel] Fetch fehlgeschlagen: channelId=${channelId}; message=${details.message}; `
      + `code=${details.code ?? 'n/a'}; status=${details.status ?? 'n/a'}`);
    error.tottChannelId = channelId;
    throw error;
  }
}

async function testLiveTottChannel(client) {
  console.info(`[tott-test] Zielkanal: ${LIVE_CHANNEL_ID}`);
  try {
    const channel = await getTargetChannel(client, 'live');
    if (!channel || typeof channel.send !== 'function') {
      const error = new Error(`TOTT-Zielkanal ${LIVE_CHANNEL_ID} unterstützt channel.send() nicht.`);
      error.code = 'TOTT_CHANNEL_NOT_SENDABLE';
      throw error;
    }
    console.info(`[tott-test] Kanal gefunden: id=${channel.id}; name=${channel.name || 'unbekannt'}; type=${channel.type}; `
      + `guildId=${channel.guildId || channel.guild?.id || 'unbekannt'}; send=true`);
    const message = await channel.send({
      content: '🧪 **TOTT-Kanaltest**\n✅ Der Loco Night Cup Bot kann diesen Kanal finden und Nachrichten senden.',
      allowedMentions: { parse: [] },
    });
    console.info(`[tott-test] Nachricht erfolgreich gesendet: messageId ${message.id}`);
    return { channelId: channel.id, messageId: message.id };
  } catch (error) {
    const details = errorDetails(error);
    console.error(`[tott-test] FEHLER: ${details.message}; code=${details.code ?? 'n/a'}; status=${details.status ?? 'n/a'}`);
    throw error;
  }
}

async function postTeamOfTheTournament({ client, eventKey, force = false }) {
  const event = readEventData(eventKey);
  const state = event.ceremony?.teamOfTheTournament;
  if (state?.postedAt) return { posted: false, reason: 'already_posted' };
  if (selectionCount(state?.selection) < 11) return { posted: false, reason: 'not_enough_eligible_players' };
  if (!force && !state?.postGraceCompletedAt) return { posted: false, reason: 'grace_period' };

  const channel = await getTargetChannel(client);
  if (!channel || typeof channel.send !== 'function') {
    const error = new Error('Team-of-the-Tournament-Kanal unterstützt keine Nachrichten.');
    error.code = 'TOTT_CHANNEL_NOT_SENDABLE';
    throw error;
  }

  const bomberXLoco = isBomberXLocoEvent(event);
  const serialNumber = bomberXLoco ? null : reserveSerial(eventKey);
  const rendered = await renderTeamOfTheTournament({
    selection: state.selection,
    serialNumber,
    variant: bomberXLoco ? 'bomber_x_loco' : 'default',
  });
  const awardsRendered = await renderSpecialAwards({
    awards: selectSpecialAwards(state.performances),
    serialNumber,
    variant: bomberXLoco ? 'bomber_x_loco' : 'default',
  });
  const intro = buildIntroText({ variant: bomberXLoco ? 'bomber_x_loco' : 'default' });
  const imageMessage = await channel.send({
    content: intro,
    files: [{ attachment: rendered.buffer, name: rendered.fileName }],
    allowedMentions: { parse: ['everyone'] },
  });
  const awardsMessage = await channel.send({
    files: [{ attachment: awardsRendered.buffer, name: awardsRendered.fileName }], allowedMentions: { parse: [] },
  });

  updateEventData(eventKey, stored => {
    stored.ceremony.teamOfTheTournament = stored.ceremony.teamOfTheTournament || {};
    Object.assign(stored.ceremony.teamOfTheTournament, {
      postedAt: new Date().toISOString(), serialNumber,
      channelId: channel.id, imageMessageId: imageMessage.id, awardsMessageId: awardsMessage.id,
      postStatus: 'posted', postCompletedAt: new Date().toISOString(), postFailureReason: null,
      postNextAttemptAt: null,
    });
    return stored;
  });
  console.info(`[tott] ${eventKey}: TOTT erfolgreich veröffentlicht in Kanal ${channel.id}. Message-ID: ${imageMessage.id}`);
  return { posted: true, serialNumber, channelId: channel.id, imageMessageId: imageMessage.id, awardsMessageId: awardsMessage.id };
}

function scheduleTeamOfTheTournamentPost({ client, eventKey }) {
  if (postTimers.has(eventKey)) return false;
  const initialState = readEventData(eventKey).ceremony?.teamOfTheTournament || {};
  const postStartedAt = initialState.postStartedAt || new Date().toISOString();
  const elapsedAtSchedule = Math.max(0, Date.now() - new Date(postStartedAt).getTime());
  const initialDelay = Math.max(0, TOTT_GRACE_PERIOD_MS - elapsedAtSchedule);

  updatePostState(eventKey, {
    postStatus: 'pending', postStartedAt,
    postCompletedAt: null, postFailureReason: null,
    postNextAttemptAt: new Date(Date.now() + initialDelay).toISOString(),
  });
  console.info(`[tott] ${eventKey}: Siegerehrung abgeschlossen. TOTT-Nachlauf gestartet; erste Prüfung in ${Math.ceil(initialDelay / 60000)} Minute(n).`);

  let attempt = 0;
  const run = async () => {
    try {
      if (attempt === 0) {
        console.info(`[tott] ${eventKey}: kontrollierte EA-Abschlussprüfung wird ausgeführt.`);
        await capturePendingMatchesNow(eventKey, readEventData(eventKey));
      }
      const current = readEventData(eventKey);
      const snapshot = workflowSnapshot(current);
      const resumed = snapshot.selectedPlayers >= 11 ? 0 : resumeRatingCaptures(eventKey, current);
      const now = new Date().toISOString();
      updatePostState(eventKey, {
        postStatus: 'pending', postAttempt: attempt + 1,
        postLastAttemptAt: now, postLastResult: null,
        postSnapshot: snapshot, postGraceCompletedAt: now,
      });

      console.info(`[tott] ${eventKey}: 5-Minuten-Prüfung/Postversuch ${attempt + 1}: `
        + `${snapshot.capturedMatches}/${snapshot.linkedMatches} EA-Spiele erfasst; `
        + `${snapshot.selectedPlayers}/11 Spieler gewählt; ${resumed} EA-Abfragen gestartet.`);

      if (snapshot.selectedPlayers >= 11) {
        if (snapshot.capturedMatches < snapshot.linkedMatches) {
          console.warn(`[tott] ${eventKey}: Vollständige TOTT-Elf vorhanden. `
            + `${snapshot.linkedMatches - snapshot.capturedMatches} EA-Match(es) fehlen weiterhin, blockieren den Post aber nicht.`);
        } else {
          console.info(`[tott] ${eventKey}: Vollständige TOTT-Elf und alle verknüpften EA-Spiele vorhanden.`);
        }
        console.info(`[tott] ${eventKey}: Vollständige TOTT-Elf vorhanden. Veröffentlichung wird gestartet.`);
        const result = await postTeamOfTheTournament({ client, eventKey });
        if (result.posted || result.reason === 'already_posted') {
          postTimers.delete(eventKey);
          return;
        }
      } else {
        console.info(`[tott] ${eventKey}: ${snapshot.selectedPlayers}/11 Spieler gewählt. EA-Nachholversuche laufen weiter.`);
        updatePostState(eventKey, { postLastResult: 'not_enough_eligible_players', postFailureReason: 'not_enough_eligible_players' });
      }

      const elapsed = Date.now() - new Date(postStartedAt).getTime();
      if (elapsed >= TOTT_GIVE_UP_AFTER_MS) {
        const latest = workflowSnapshot(readEventData(eventKey));
        if (latest.selectedPlayers < 11) {
          const reason = `not_enough_eligible_players; ${latest.capturedMatches}/${latest.linkedMatches} `
            + `verknüpfte Spiele erfasst; ${latest.selectedPlayers}/11 Spieler gewählt`;
          updatePostState(eventKey, {
            postStatus: 'skipped', postCompletedAt: new Date().toISOString(),
            postLastResult: 'not_enough_eligible_players', postFailureReason: reason,
            postNextAttemptAt: null, postSnapshot: latest,
          });
          console.warn(`[tott] ${eventKey}: TOTT nach zwei Stunden ohne vollständige Elf aufgegeben: ${reason}. `
            + 'Die Turnierbereinigung ist jetzt freigegeben.');
          postTimers.delete(eventKey);
          return;
        }
      }
    } catch (error) {
      const details = errorDetails(error);
      console.warn(`[tott] Abschluss-Post für ${eventKey} fehlgeschlagen: ${details.message}; `
        + `code=${details.code ?? 'n/a'}; status=${details.status ?? 'n/a'}`);
      updatePostState(eventKey, {
        postStatus: 'pending', postLastResult: 'error',
        postFailureReason: `error: ${details.message}; code=${details.code ?? 'n/a'}; status=${details.status ?? 'n/a'}`.slice(0, 500),
      });

      // Ein Discord-/Kanalfehler darf die TOTT-Daten nicht freigeben oder löschen.
      // Der Workflow bleibt pending und wird auch nach zwei Stunden weiter versucht.
      if (error?.tottChannelId || details.code === 'TOTT_CHANNEL_NOT_SENDABLE' || details.code === 10003 || details.code === 50001 || details.code === 50013) {
        console.warn(`[tott] ${eventKey}: TOTT ist postbereit, aber der Zielkanal ist nicht erreichbar. `
          + 'TOTT bleibt pending; Turnierbereinigung bleibt gesperrt.');
      } else if (Date.now() - new Date(postStartedAt).getTime() >= TOTT_GIVE_UP_AFTER_MS) {
        const snapshot = workflowSnapshot(readEventData(eventKey));
        const reason = `error: ${details.message}; ${snapshot.capturedMatches}/${snapshot.linkedMatches} `
          + `verknüpfte Spiele erfasst; ${snapshot.selectedPlayers}/11 Spieler gewählt`;
        updatePostState(eventKey, {
          postStatus: 'failed', postCompletedAt: new Date().toISOString(),
          postLastResult: 'error', postFailureReason: reason,
          postNextAttemptAt: null, postSnapshot: snapshot,
        });
        console.warn(`[tott] ${eventKey}: TOTT nach zwei Stunden wegen eines nicht-kanalbezogenen Fehlers aufgegeben: ${reason}. `
          + 'Die Turnierbereinigung ist jetzt freigegeben.');
        postTimers.delete(eventKey);
        return;
      }
    }

    attempt += 1;
    const delay = POST_RETRY_DELAYS_MS[attempt - 1] || CONTINUOUS_RETRY_DELAY_MS;
    updatePostState(eventKey, { postNextAttemptAt: new Date(Date.now() + delay).toISOString() });
    const timer = setTimeout(run, delay);
    if (typeof timer.unref === 'function') timer.unref();
    postTimers.set(eventKey, timer);
  };

  const timer = setTimeout(run, initialDelay);
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
      console.warn(`[tott] Wiederherstellung für ${eventKey} fehlgeschlagen; Botstart läuft weiter: ${error.message}`);
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
  if (!channel || typeof channel.send !== 'function') throw new Error('Team-of-the-Tournament-Testkanal wurde nicht gefunden.');
  const serialNumber = 1 + Math.floor(Math.random() * 10);
  const selection = buildTestSelection();
  const performances = buildTestPerformances(selection);
  const rendered = await renderTeamOfTheTournament({ selection, serialNumber });
  const awardsRendered = await renderSpecialAwards({ awards: selectSpecialAwards(performances), serialNumber });
  const message = await channel.send({
    content: buildIntroText({ test: true }),
    files: [{ attachment: rendered.buffer, name: `test-${rendered.fileName}` }], allowedMentions: { parse: [] },
  });
  const awardsMessage = await channel.send({
    content: '🧪 **FIKTIVE TESTDATEN – SPECIAL AWARDS**',
    files: [{ attachment: awardsRendered.buffer, name: `test-${awardsRendered.fileName}` }],
    allowedMentions: { parse: [] },
  });
  return { channelId: channel.id, messageId: message.id, awardsMessageId: awardsMessage.id, serialNumber };
}

module.exports = {
  aggregatePlayers, buildAwardsText, buildIntroText, buildTestPerformances, buildTestSelection, closingRatingsReady, selectSpecialAwards,
  getTargetChannel, initTeamOfTheTournament, postTeamOfTheTournament, postTeamOfTheTournamentTest,
  scheduleTeamOfTheTournamentPost, testLiveTottChannel, workflowSnapshot,
};
