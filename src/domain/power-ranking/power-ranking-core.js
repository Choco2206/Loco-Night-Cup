'use strict';

const { parseDateTime } = require('../checkins/checkin-schedule');

const TIMEZONE = 'Europe/Berlin';
const WEEK_RESET_HOUR = 7;
const STAGE_POINTS = Object.freeze({
  group_or_league: 1,
  round_of_16: 2,
  quarter_final: 3,
  semi_final: 5,
  fourth_place: 5,
  third_place: 6,
  runner_up: 8,
  champion: 10,
});

function zonedDateParts(date, timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function dateValueFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getWeekWindow(date = new Date(), timeZone = TIMEZONE) {
  // Die Ranking-Woche wechselt erst nach dem Sonntagsturnier samt Nachbereitung.
  // Durch den 07:00-Uhr-Cutoff gehört die Nacht von Sonntag auf Montag noch zur Vorwoche.
  const rankingDate = new Date(date.getTime() - WEEK_RESET_HOUR * 60 * 60 * 1000);
  const local = zonedDateParts(rankingDate, timeZone);
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day, 12));
  const weekday = localDate.getUTCDay() || 7;
  const monday = new Date(localDate);
  monday.setUTCDate(monday.getUTCDate() - weekday + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const thursday = new Date(localDate);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4, 12));
  const firstWeekday = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstWeekday);
  const calendarWeek = 1 + Math.round((thursday - firstThursday) / 604800000);
  const weekKey = `${isoYear}-W${String(calendarWeek).padStart(2, '0')}`;
  const mondayValue = dateValueFromUtcDate(monday);
  const sundayValue = dateValueFromUtcDate(sunday);
  const nextMonday = new Date(sunday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 1);
  const nextMondayValue = dateValueFromUtcDate(nextMonday);
  const endMinute = parseDateTime(nextMondayValue, '06:59', false, timeZone);

  return {
    weekKey,
    year: isoYear,
    calendarWeek,
    startsAt: parseDateTime(mondayValue, '07:00', false, timeZone).toISOString(),
    endsAt: new Date(endMinute.getTime() + 59999).toISOString(),
    startDate: mondayValue,
    endDate: sundayValue,
  };
}

function weekWindowForEvent(event, finishedAt = new Date()) {
  const eventDate = event?.cycle?.eventDate;
  const anchor = eventDate
    ? parseDateTime(eventDate, '12:00', false, event.cycle?.timezone || TIMEZONE)
    : new Date(finishedAt);
  return getWeekWindow(anchor || new Date(finishedAt), event.cycle?.timezone || TIMEZONE);
}

function isTeamParticipant(participant) {
  return participant?.type === 'team' && (participant.teamId || participant.id);
}

function participantTeamId(participant) {
  return participant?.teamId || participant?.id || null;
}

function collectRealParticipants(event) {
  const size = Number(event.format?.size || 0);
  const participants = Array.isArray(event.format?.participants)
    ? event.format.participants.slice(0, size || undefined)
    : [];
  const unique = new Map();
  for (const participant of participants) {
    if (!isTeamParticipant(participant)) continue;
    const teamId = String(participantTeamId(participant));
    if (!unique.has(teamId)) unique.set(teamId, participant);
  }
  return unique;
}

function teamIdOf(value) {
  return value?.teamId || value?.id || null;
}

function placementMap(event) {
  const placements = event.ceremony?.placements || event.knockout?.placements || {};
  return new Map([
    [placements.firstTeamId || teamIdOf(placements.first), 1],
    [placements.secondTeamId || teamIdOf(placements.second), 2],
    [placements.thirdTeamId || teamIdOf(placements.third), 3],
    [placements.fourthTeamId || teamIdOf(placements.fourth), 4],
  ].filter(([teamId]) => teamId).map(([teamId, position]) => [String(teamId), position]));
}

function knockoutLosses(event) {
  const losses = new Map();
  for (const roundKey of ['round_of_16', 'quarter_final', 'semi_final', 'final']) {
    for (const match of event.knockout?.rounds?.[roundKey]?.matches || []) {
      if (match.status !== 'confirmed' || !isTeamParticipant(match.loser)) continue;
      losses.set(String(participantTeamId(match.loser)), roundKey);
    }
  }
  return losses;
}

function stageForTeam(teamId, positions, losses) {
  const position = positions.get(String(teamId)) || null;
  if (position === 1) return { finalStage: 'champion', finalPosition: 1, points: STAGE_POINTS.champion };
  if (position === 2) return { finalStage: 'runner_up', finalPosition: 2, points: STAGE_POINTS.runner_up };
  if (position === 3) return { finalStage: 'third_place', finalPosition: 3, points: STAGE_POINTS.third_place };
  if (position === 4) return { finalStage: 'fourth_place', finalPosition: 4, points: STAGE_POINTS.fourth_place };
  const lostRound = losses.get(String(teamId));
  if (lostRound && STAGE_POINTS[lostRound]) return { finalStage: lostRound, finalPosition: null, points: STAGE_POINTS[lostRound] };
  return { finalStage: 'group_or_league', finalPosition: null, points: STAGE_POINTS.group_or_league };
}

function snapshotEvent(event) {
  return JSON.parse(JSON.stringify({
    eventKey: event.eventKey,
    cycle: event.cycle,
    format: { size: event.format?.size, participants: event.format?.participants || [] },
    groups: event.groups,
    leaguePhase: event.leaguePhase,
    knockout: event.knockout,
    ceremony: { placements: event.ceremony?.placements || null },
  }));
}

function evaluateTournament({ eventKey, event, teamsById = new Map(), finishedAt = null }) {
  if (!event || event.knockout?.status !== 'completed') throw new Error('Das Turnier ist noch nicht vollständig abgeschlossen.');
  if (event.meta?.testMode === true) throw new Error('Testturniere werden nicht im Power Ranking gewertet.');
  const tournamentId = String(event.cycle?.cycleKey || '');
  if (!tournamentId) throw new Error('Dem abgeschlossenen Turnier fehlt eine eindeutige cycleKey-Turnier-ID.');
  const finalFinishedAt = finishedAt || event.knockout.completedAt || event.ceremony?.readyAt;
  if (!finalFinishedAt || Number.isNaN(new Date(finalFinishedAt).getTime())) throw new Error('Dem Turnier fehlt ein gültiger Abschlusszeitpunkt.');

  const participants = collectRealParticipants(event);
  if (!participants.size) throw new Error('Das abgeschlossene Turnier enthält keine echten Teilnehmer.');
  const positions = placementMap(event);
  if (![1, 2, 3].every(position => [...positions.values()].includes(position))) {
    throw new Error('Die finalen Plätze 1 bis 3 sind noch nicht eindeutig vorhanden.');
  }
  const losses = knockoutLosses(event);
  const week = weekWindowForEvent(event, finalFinishedAt);
  const results = {};

  for (const [teamId, participant] of participants) {
    const currentTeam = teamsById.get(String(teamId)) || null;
    const stage = stageForTeam(teamId, positions, losses);
    results[teamId] = {
      tournamentId,
      teamId,
      teamNameSnapshot: currentTeam?.clubName || participant.displayName || `Team ${teamId}`,
      teamLogoSnapshot: currentTeam?.logo ? JSON.parse(JSON.stringify(currentTeam.logo)) : null,
      tournamentFinishedAt: new Date(finalFinishedAt).toISOString(),
      weekKey: week.weekKey,
      year: week.year,
      calendarWeek: week.calendarWeek,
      finalStage: stage.finalStage,
      finalPosition: stage.finalPosition,
      points: stage.points,
    };
  }

  return {
    tournamentId,
    eventKey,
    tournamentDate: event.cycle?.eventDate || null,
    tournamentFinishedAt: new Date(finalFinishedAt).toISOString(),
    week,
    results,
    sourceSnapshot: snapshotEvent(event),
  };
}

function emptyAggregate(result) {
  return {
    teamId: String(result.teamId), teamName: result.teamNameSnapshot, points: 0, cups: 0,
    wins: 0, finalAppearances: 0, secondPlaces: 0, thirdPlaces: 0,
    semifinalOrBetter: 0, latestResultPoints: 0, latestFinishedAt: null,
  };
}

function aggregateTournamentBuckets(buckets, currentTeamsById = new Map()) {
  const aggregate = new Map();
  for (const bucket of buckets) {
    for (const result of Object.values(bucket.results || {})) {
      const item = aggregate.get(String(result.teamId)) || emptyAggregate(result);
      const currentTeam = currentTeamsById.get(String(result.teamId));
      item.teamName = currentTeam && currentTeam.status !== 'deleted' ? currentTeam.clubName : result.teamNameSnapshot || item.teamName;
      item.points += Number(result.points || 0);
      item.cups += 1;
      if (result.finalPosition === 1) item.wins += 1;
      if ([1, 2].includes(result.finalPosition)) item.finalAppearances += 1;
      if (result.finalPosition === 2) item.secondPlaces += 1;
      if (result.finalPosition === 3) item.thirdPlaces += 1;
      if (result.finalPosition && result.finalPosition <= 4) item.semifinalOrBetter += 1;
      item.latestResultPoints = Number(result.points || 0);
      item.latestFinishedAt = result.tournamentFinishedAt;
      aggregate.set(item.teamId, item);
    }
  }
  return [...aggregate.values()];
}

function compareRanking(left, right) {
  return right.points - left.points
    || right.wins - left.wins
    || right.secondPlaces - left.secondPlaces
    || right.thirdPlaces - left.thirdPlaces
    || right.semifinalOrBetter - left.semifinalOrBetter
    || left.cups - right.cups
    || right.latestResultPoints - left.latestResultPoints
    || left.teamName.localeCompare(right.teamName, 'de', { sensitivity: 'base' })
    || left.teamId.localeCompare(right.teamId);
}

function rankBuckets(buckets, currentTeamsById = new Map()) {
  return aggregateTournamentBuckets(buckets, currentTeamsById)
    .sort(compareRanking)
    .map((team, index) => ({ ...team, rank: index + 1 }));
}

function calculateWeekRanking(data, weekKey, currentTeamsById = new Map()) {
  const buckets = Object.values(data.tournamentResults || {})
    .filter(bucket => bucket.weekKey === weekKey)
    .sort((a, b) => String(a.tournamentFinishedAt).localeCompare(String(b.tournamentFinishedAt)) || a.tournamentId.localeCompare(b.tournamentId));
  const current = rankBuckets(buckets, currentTeamsById);
  const previous = rankBuckets(buckets.slice(0, -1), currentTeamsById);
  const previousRanks = new Map(previous.map(team => [team.teamId, team.rank]));
  return {
    weekKey,
    cups: buckets.length,
    lastUpdatedAt: buckets.at(-1)?.tournamentFinishedAt || null,
    teams: current.map(team => ({
      ...team,
      change: previousRanks.has(team.teamId) ? previousRanks.get(team.teamId) - team.rank : null,
      changeLabel: previousRanks.has(team.teamId)
        ? (previousRanks.get(team.teamId) === team.rank ? '↔' : previousRanks.get(team.teamId) > team.rank ? `⬆ ${previousRanks.get(team.teamId) - team.rank}` : `⬇ ${team.rank - previousRanks.get(team.teamId)}`)
        : 'NEU',
    })),
  };
}

module.exports = {
  STAGE_POINTS,
  WEEK_RESET_HOUR,
  calculateWeekRanking,
  collectRealParticipants,
  compareRanking,
  evaluateTournament,
  getWeekWindow,
  rankBuckets,
  stageForTeam,
  weekWindowForEvent,
};
