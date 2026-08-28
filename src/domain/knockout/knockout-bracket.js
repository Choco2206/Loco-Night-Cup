'use strict';

const ROUND_LABELS = {
  round_of_32: 'Sechzehntelfinale',
  round_of_16: 'Achtelfinale',
  quarter_final: 'Viertelfinale',
  semi_final: 'Halbfinale',
  third_place: 'Spiel um Platz 3',
  final: 'Finale',
};

function nowIso() {
  return new Date().toISOString();
}

function firstRoundForQualifiedCount(count) {
  if (count === 4) return 'semi_final';
  if (count === 8) return 'quarter_final';
  if (count === 16) return 'round_of_16';
  if (count === 32) return 'round_of_32';
  throw new Error(`Keine K.O.-Runde für ${count} qualifizierte Teams definiert.`);
}

function mainRoundSequence(firstRoundKey) {
  if (firstRoundKey === 'semi_final') return ['semi_final', 'final'];
  if (firstRoundKey === 'quarter_final') return ['quarter_final', 'semi_final', 'final'];
  if (firstRoundKey === 'round_of_16') return ['round_of_16', 'quarter_final', 'semi_final', 'final'];
  return ['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'final'];
}

function createTeamParticipant(team) {
  return {
    type: 'team',
    teamId: String(team.teamId),
    displayName: team.displayName,
    groupKey: team.groupKey,
    groupRank: team.groupRank,
    seed: team.seed,
    participantKey: `team:${team.teamId}`,
  };
}

function createPlaceholder(label) {
  return {
    type: 'placeholder',
    displayName: label,
    participantKey: `placeholder:${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
  };
}

function takeOpponentFor(seed, pool) {
  for (let index = pool.length - 1; index >= 0; index -= 1) {
    if (pool[index].groupKey !== seed.groupKey) return pool.splice(index, 1)[0];
  }
  return pool.pop();
}

function createFirstRoundPairs(qualifiedTeams) {
  const ordered = qualifiedTeams.slice().sort((a, b) => Number(a.seed) - Number(b.seed));
  if (ordered.length === 8 && ordered.every(team => team.groupKey === 'league')) {
    return [[ordered[0], ordered[7]], [ordered[3], ordered[4]], [ordered[1], ordered[6]], [ordered[2], ordered[5]]];
  }
  const topHalf = ordered.slice(0, ordered.length / 2);
  const pool = ordered.slice(ordered.length / 2);

  return topHalf.map(seed => [seed, takeOpponentFor(seed, pool)]);
}

function createMatch({ eventKey, roundKey, matchIndex, home, away, status, createdAt }) {
  return {
    id: `${eventKey}_${roundKey}_${matchIndex}`,
    roundKey,
    matchIndex,
    home,
    away,
    status,
    result: null,
    reports: [],
    winner: null,
    loser: null,
    next: null,
    loserNext: null,
    release: {
      releasedAt: status === 'open' ? createdAt : null,
    },
    meta: {
      createdAt,
      updatedAt: null,
    },
  };
}

function createEmptyRound(roundKey) {
  return {
    roundKey,
    label: ROUND_LABELS[roundKey],
    status: 'locked',
    channelId: null,
    messageId: null,
    matches: [],
  };
}

function linkRound(rounds, fromRoundKey, toRoundKey) {
  const fromMatches = rounds[fromRoundKey].matches;
  const toMatches = rounds[toRoundKey].matches;
  fromMatches.forEach((match, index) => {
    const nextMatchIndex = Math.floor(index / 2);
    const side = index % 2 === 0 ? 'home' : 'away';
    const nextMatch = toMatches[nextMatchIndex];
    if (nextMatch) match.next = { roundKey: toRoundKey, matchId: nextMatch.id, side };
  });
}

function linkSemiFinalLosers(rounds) {
  const semi = rounds.semi_final?.matches || [];
  const thirdPlace = rounds.third_place?.matches?.[0];
  if (!thirdPlace) return;

  semi.forEach((match, index) => {
    match.loserNext = {
      roundKey: 'third_place',
      matchId: thirdPlace.id,
      side: index === 0 ? 'home' : 'away',
    };
  });
}

function buildKnockoutRounds({ eventKey, qualifiedTeams, createdAt = nowIso() }) {
  const firstRoundKey = firstRoundForQualifiedCount(qualifiedTeams.length);
  const mainRounds = mainRoundSequence(firstRoundKey);
  const rounds = Object.fromEntries(
    ['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final']
      .map(roundKey => [roundKey, createEmptyRound(roundKey)])
  );

  const pairs = createFirstRoundPairs(qualifiedTeams);
  rounds[firstRoundKey].status = 'open';
  rounds[firstRoundKey].matches = pairs.map(([home, away], index) => createMatch({
    eventKey,
    roundKey: firstRoundKey,
    matchIndex: index + 1,
    home: createTeamParticipant(home),
    away: createTeamParticipant(away),
    status: 'open',
    createdAt,
  }));

  for (let roundIndex = 1; roundIndex < mainRounds.length; roundIndex += 1) {
    const roundKey = mainRounds[roundIndex];
    const previousRoundKey = mainRounds[roundIndex - 1];
    const matchCount = Math.max(1, rounds[previousRoundKey].matches.length / 2);
    rounds[roundKey].matches = Array.from({ length: matchCount }, (_, index) => createMatch({
      eventKey,
      roundKey,
      matchIndex: index + 1,
      home: createPlaceholder(`Sieger ${ROUND_LABELS[previousRoundKey]} ${index * 2 + 1}`),
      away: createPlaceholder(`Sieger ${ROUND_LABELS[previousRoundKey]} ${index * 2 + 2}`),
      status: 'locked',
      createdAt,
    }));
    linkRound(rounds, previousRoundKey, roundKey);
  }

  rounds.third_place.matches = [createMatch({
    eventKey,
    roundKey: 'third_place',
    matchIndex: 1,
    home: createPlaceholder('Verlierer Halbfinale 1'),
    away: createPlaceholder('Verlierer Halbfinale 2'),
    status: 'locked',
    createdAt,
  })];
  linkSemiFinalLosers(rounds);

  for (const round of Object.values(rounds)) {
    if (round.matches.length && round.roundKey !== firstRoundKey) round.status = 'locked';
    if (!round.matches.length) round.status = 'not_needed';
  }

  return {
    firstRoundKey,
    rounds,
  };
}

module.exports = {
  ROUND_LABELS,
  buildKnockoutRounds,
  firstRoundForQualifiedCount,
};
