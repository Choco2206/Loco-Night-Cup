'use strict';

function participantKey(participant) {
  if (participant?.participantKey) return String(participant.participantKey);
  if (participant?.type === 'team') return `team:${participant.teamId || participant.id}`;
  if (participant?.type === 'bye') return `bye:${participant.byeId || participant.id}`;
  return null;
}

function shuffled(values, random = Math.random) {
  const copy = values.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function createLeaguePhaseDraw({ eventKey, participants, createdAt = new Date().toISOString(), random = Math.random }) {
  if (!Array.isArray(participants) || participants.length !== 20) {
    throw new Error('Die 20er-Ligaphase benoetigt exakt 20 persistierte Startplaetze.');
  }
  const normalized = shuffled(participants, random).map((participant, index) => ({
    ...participant,
    slot: participant.slot || index + 1,
    participantKey: participantKey(participant),
  }));
  if (new Set(normalized.map(participantKey)).size !== 20) {
    throw new Error('Die Ligaphasen-Teilnehmer enthalten doppelte oder ungueltige Startplaetze.');
  }

  const fixed = normalized[0];
  const rotating = normalized.slice(1);
  const matchdays = [];
  for (let round = 0; round < 4; round += 1) {
    const order = [fixed, ...rotating];
    const matches = [];
    for (let index = 0; index < 10; index += 1) {
      const left = order[index];
      const right = order[19 - index];
      const swap = (round + index) % 2 === 1;
      matches.push({
        id: `${eventKey}_league_${round + 1}_${index + 1}`,
        matchday: round + 1,
        matchIndex: index + 1,
        home: { ...(swap ? right : left) },
        away: { ...(swap ? left : right) },
        status: 'locked',
        result: null,
        reports: [],
        release: { slot: round + 1, releasedAt: null },
        meta: { createdAt, updatedAt: null },
      });
    }
    matchdays.push({ matchday: round + 1, status: 'locked', releasedAt: null, completedAt: null, matches });
    rotating.unshift(rotating.pop());
  }
  const phase = {
    phaseType: 'league', groupKey: 'league', name: 'Ligaphase', status: 'created',
    createdAt, completedAt: null, currentMatchday: 0, roleId: null,
    overviewChannelId: null, resultsChannelId: null, slots: normalized,
    participants: normalized, matchdays, standings: [], transitionStatus: 'not_started',
    messages: { overviewTableMessageId: null, overviewScheduleMessageId: null, resultsTableMessageId: null, resultsScheduleMessageId: null, releaseMessageId: null },
  };
  validateLeaguePhaseDraw(phase);
  return phase;
}

function validateLeaguePhaseDraw(phase) {
  const days = phase?.matchdays || [];
  if (days.length !== 4) throw new Error('Ligaphase: Es muessen exakt 4 Spieltage existieren.');
  const total = new Map((phase.slots || []).map(slot => [participantKey(slot), 0]));
  const pairs = new Set();
  for (const [dayIndex, day] of days.entries()) {
    if (day.matches?.length !== 10) throw new Error(`Ligaphase: Spieltag ${dayIndex + 1} benoetigt exakt 10 Spiele.`);
    const appearances = new Map();
    for (const match of day.matches) {
      const home = participantKey(match.home);
      const away = participantKey(match.away);
      if (!home || !away || home === away) throw new Error('Ligaphase: Selbst- oder ungueltige Paarung erkannt.');
      appearances.set(home, (appearances.get(home) || 0) + 1);
      appearances.set(away, (appearances.get(away) || 0) + 1);
      total.set(home, (total.get(home) || 0) + 1);
      total.set(away, (total.get(away) || 0) + 1);
      const pair = [home, away].sort().join('|');
      if (pairs.has(pair)) throw new Error(`Ligaphase: Doppelte Paarung ${pair}.`);
      pairs.add(pair);
    }
    if (appearances.size !== 20 || [...appearances.values()].some(count => count !== 1)) {
      throw new Error(`Ligaphase: Jeder Startplatz muss an Spieltag ${dayIndex + 1} exakt einmal spielen.`);
    }
  }
  if (pairs.size !== 40 || [...total.values()].some(count => count !== 4)) {
    throw new Error('Ligaphase: Erwartet werden 40 Spiele und exakt 4 Spiele pro Startplatz.');
  }
  return true;
}

module.exports = { createLeaguePhaseDraw, participantKey, validateLeaguePhaseDraw };
