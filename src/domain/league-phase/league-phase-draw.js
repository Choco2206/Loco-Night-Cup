'use strict';

const { LEAGUE_PHASE_FORMATS, isLeaguePhaseFormat } = require('../../app/constants');

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
  const size = participants?.length;
  const config = LEAGUE_PHASE_FORMATS[size];
  if (!Array.isArray(participants) || !isLeaguePhaseFormat(size)) {
    throw new Error('Die Ligaphase benötigt exakt 14, 18 oder 20 persistierte Startplätze.');
  }
  const normalized = shuffled(participants, random).map((participant, index) => ({
    ...participant,
    slot: participant.slot || index + 1,
    participantKey: participantKey(participant),
  }));
  if (new Set(normalized.map(participantKey)).size !== size) {
    throw new Error('Die Ligaphasen-Teilnehmer enthalten doppelte oder ungültige Startplätze.');
  }

  const fixed = normalized[0];
  const rotating = normalized.slice(1);
  const matchdays = [];
  for (let round = 0; round < config.matchdays; round += 1) {
    const order = [fixed, ...rotating];
    const matches = [];
    for (let index = 0; index < config.matchesPerDay; index += 1) {
      const left = order[index];
      const right = order[size - 1 - index];
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
    phaseType: 'league', formatSize: size, config: { ...config }, groupKey: 'league', name: 'Ligaphase', status: 'created',
    createdAt, completedAt: null, currentMatchday: 0, roleId: null,
    overviewChannelId: null, resultsChannelId: null, videoChannelId: null, slots: normalized,
    participants: normalized, matchdays, standings: [], transitionStatus: 'not_started',
    calculationChannelId: null, qualificationAuditMessageId: null, qualificationAuditPostedAt: null,
    messages: { overviewTableMessageId: null, overviewScheduleMessageId: null, resultsTableMessageId: null, resultsScheduleMessageId: null, releaseMessageId: null },
  };
  validateLeaguePhaseDraw(phase);
  return phase;
}

function validateLeaguePhaseDraw(phase) {
  const size = Number(phase?.formatSize || phase?.slots?.length);
  const config = LEAGUE_PHASE_FORMATS[size];
  if (!config) throw new Error('Ligaphase: Unbekanntes Format.');
  const days = phase?.matchdays || [];
  if (days.length !== config.matchdays) throw new Error(`Ligaphase: Es müssen exakt ${config.matchdays} Spieltage existieren.`);
  const total = new Map((phase.slots || []).map(slot => [participantKey(slot), 0]));
  const pairs = new Set();
  for (const [dayIndex, day] of days.entries()) {
    if (day.matches?.length !== config.matchesPerDay) throw new Error(`Ligaphase: Spieltag ${dayIndex + 1} benötigt exakt ${config.matchesPerDay} Spiele.`);
    const appearances = new Map();
    for (const match of day.matches) {
      const home = participantKey(match.home);
      const away = participantKey(match.away);
      if (!home || !away || home === away) throw new Error('Ligaphase: Selbst- oder ungültige Paarung erkannt.');
      appearances.set(home, (appearances.get(home) || 0) + 1);
      appearances.set(away, (appearances.get(away) || 0) + 1);
      total.set(home, (total.get(home) || 0) + 1);
      total.set(away, (total.get(away) || 0) + 1);
      const pair = [home, away].sort().join('|');
      if (pairs.has(pair)) throw new Error(`Ligaphase: Doppelte Paarung ${pair}.`);
      pairs.add(pair);
    }
    if (appearances.size !== size || [...appearances.values()].some(count => count !== 1)) {
      throw new Error(`Ligaphase: Jeder Startplatz muss an Spieltag ${dayIndex + 1} exakt einmal spielen.`);
    }
  }
  if (pairs.size !== config.totalMatches || [...total.values()].some(count => count !== config.matchdays)) {
    throw new Error(`Ligaphase: Erwartet werden ${config.totalMatches} Spiele und exakt ${config.matchdays} Spiele pro Startplatz.`);
  }
  return true;
}

module.exports = { createLeaguePhaseDraw, participantKey, validateLeaguePhaseDraw };
