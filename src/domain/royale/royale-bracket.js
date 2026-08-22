'use strict';

const { ROYALE_FORMAT_SIZES } = require('../../app/constants');

function placeholder(label) {
  return { type: 'placeholder', displayName: label };
}

function participant(team) {
  return { type: 'team', teamId: String(team.teamId || team.id), displayName: team.displayName || team.clubName };
}

function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function createMatch(id, roundKey, index, home, away) {
  return {
    id, roundKey, matchIndex: index + 1, home, away,
    status: home?.type === 'team' && away?.type === 'team' ? 'ready' : 'locked',
    result: null, reports: [], winner: null, loser: null, winnerNext: null, loserNext: null,
  };
}

function roundLabel(path, number, isFinal = false) {
  if (path === 'kings') return isFinal ? 'Pfad des Königs – Finale' : `Pfad des Königs – Runde ${number}`;
  return isFinal ? 'Pfad der Schatten – Finale' : `Pfad der Schatten – Runde ${number}`;
}

function link(source, target, field, sourceIndex, targetIndex, side) {
  source.matches[sourceIndex][field] = { roundKey: target.roundKey, matchId: target.matches[targetIndex].id, side };
  target.matches[targetIndex][side] = placeholder('');
}

function linkToDraw(source, target, field) {
  source.matches.forEach(match => { match[field] = { roundKey: target.roundKey, draw: true }; });
}

function makeRound(eventKey, roundKey, label, count, sourceLabel) {
  return {
    roundKey, label, status: 'locked', roleKey: roundKey, pendingParticipants: [], drawnAt: null,
    channelId: null, resultsChannelId: null, videoChannelId: null, messageId: null,
    matches: Array.from({ length: count }, (_, index) => createMatch(
      `${eventKey}_${roundKey}_${index + 1}`, roundKey, index,
      placeholder(''), placeholder('')
    )),
  };
}

function buildRoyaleBracket({ eventKey = 'knockout_royale', teams, createdAt = new Date().toISOString(), random = Math.random }) {
  const size = teams.length;
  if (!ROYALE_FORMAT_SIZES.includes(size)) throw new Error(`Knockout Royale unterstützt nur ${ROYALE_FORMAT_SIZES.join(', ')} Teams.`);
  const depth = Math.log2(size);
  const rounds = {};
  const kings = [];
  const shadows = [];

  for (let index = 1; index <= depth; index += 1) {
    const isFinal = index === depth;
    const key = isFinal ? 'kings_final' : `kings_round_${index}`;
    const round = makeRound(eventKey, key, roundLabel('kings', index, isFinal), size / (2 ** index), 'Sieger');
    rounds[key] = round;
    kings.push(round);
  }

  const first = kings[0];
  const firstRoundTeams = shuffle(teams, random);
  first.matches = Array.from({ length: size / 2 }, (_, index) => createMatch(
    `${eventKey}_${first.roundKey}_${index + 1}`, first.roundKey, index,
    participant(firstRoundTeams[index * 2]), participant(firstRoundTeams[index * 2 + 1])
  ));
  first.status = 'open';
  first.matches.forEach(match => { match.status = 'open'; });

  for (let index = 1; index < kings.length; index += 1) {
    const previous = kings[index - 1];
    const current = kings[index];
    linkToDraw(previous, current, 'winnerNext');
  }

  let shadowNumber = 1;
  const shadowFirst = makeRound(eventKey, `shadows_round_${shadowNumber}`, roundLabel('shadows', shadowNumber), size / 4, 'Verlierer Königsrunde 1');
  rounds[shadowFirst.roundKey] = shadowFirst;
  shadows.push(shadowFirst);
  linkToDraw(first, shadowFirst, 'loserNext');

  let previousShadow = shadowFirst;
  for (let kingsIndex = 1; kingsIndex < kings.length; kingsIndex += 1) {
    const kingsRound = kings[kingsIndex];
    shadowNumber += 1;
    const isLastCross = kingsIndex === kings.length - 1;
    const crossKey = isLastCross ? 'shadows_final' : `shadows_round_${shadowNumber}`;
    const cross = makeRound(eventKey, crossKey, roundLabel('shadows', shadowNumber, isLastCross), kingsRound.matches.length, 'Weiter');
    rounds[cross.roundKey] = cross;
    shadows.push(cross);
    linkToDraw(previousShadow, cross, 'winnerNext');
    linkToDraw(kingsRound, cross, 'loserNext');
    previousShadow = cross;

    if (!isLastCross) {
      shadowNumber += 1;
      const reduction = makeRound(eventKey, `shadows_round_${shadowNumber}`, roundLabel('shadows', shadowNumber), cross.matches.length / 2, 'Sieger Schatten');
      rounds[reduction.roundKey] = reduction;
      shadows.push(reduction);
      linkToDraw(cross, reduction, 'winnerNext');
      previousShadow = reduction;
    }
  }

  const grandFinal = makeRound(eventKey, 'grand_final', 'Grand Finale', 1, 'Pfadsieger');
  const reset = makeRound(eventKey, 'grand_final_reset', 'Grand Finale – Reset', 1, 'Grand-Finale-Team');
  reset.status = 'not_needed';
  rounds.grand_final = grandFinal;
  rounds.grand_final_reset = reset;
  link(kings[kings.length - 1], grandFinal, 'winnerNext', 0, 0, 'home');
  link(shadows[shadows.length - 1], grandFinal, 'winnerNext', 0, 0, 'away');

  const releaseSequence = [kings[0].roundKey, shadows[0].roundKey];
  for (let index = 1; index < kings.length; index += 1) {
    releaseSequence.push(kings[index].roundKey);
    const crossIndex = (index - 1) * 2 + 1;
    if (shadows[crossIndex]) releaseSequence.push(shadows[crossIndex].roundKey);
    const reductionIndex = crossIndex + 1;
    if (index < kings.length - 1 && shadows[reductionIndex]) releaseSequence.push(shadows[reductionIndex].roundKey);
  }
  releaseSequence.push('grand_final', 'grand_final_reset');

  return {
    formatSize: size, createdAt, status: 'created',
    rounds, sequence: releaseSequence,
    losses: Object.fromEntries(teams.map(team => [String(team.teamId || team.id), 0])),
    eliminatedTeamIds: [], championTeamId: null,
  };
}

function teamId(value) {
  return value?.type === 'team' ? String(value.teamId) : null;
}

function findMatch(bracket, roundKey, matchId) {
  const round = bracket.rounds[roundKey];
  const match = round?.matches.find(item => item.id === matchId);
  if (!round || !match) throw new Error('Royal-Spiel wurde nicht gefunden.');
  return { round, match };
}

function playedBefore(bracket, first, second) {
  const firstId = teamId(first); const secondId = teamId(second);
  return Object.values(bracket.rounds).some(round => round.matches.some(match => {
    if (match.status !== 'confirmed') return false;
    const homeId = teamId(match.home); const awayId = teamId(match.away);
    return (homeId === firstId && awayId === secondId) || (homeId === secondId && awayId === firstId);
  }));
}

function strictPairing(bracket, participants, random) {
  if (!participants.length) return [];
  const ordered = shuffle(participants, random);
  const first = ordered[0];
  const candidates = shuffle(ordered.slice(1), random).filter(candidate => !playedBefore(bracket, first, candidate));
  for (const opponent of candidates) {
    const remaining = ordered.slice(1).filter(candidate => teamId(candidate) !== teamId(opponent));
    const rest = strictPairing(bracket, remaining, random);
    if (rest) return [[first, opponent], ...rest];
  }
  return null;
}

function fallbackPairing(bracket, participants, random) {
  let best = null; let bestRepeats = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ordered = shuffle(participants, random);
    const pairs = [];
    let repeats = 0;
    for (let index = 0; index < ordered.length; index += 2) {
      const pair = [ordered[index], ordered[index + 1]];
      if (playedBefore(bracket, pair[0], pair[1])) repeats += 1;
      pairs.push(pair);
    }
    if (repeats < bestRepeats) { best = pairs; bestRepeats = repeats; }
    if (repeats === 0) break;
  }
  return best;
}

function drawRound(bracket, round, random = Math.random) {
  const required = round.matches.length * 2;
  const participants = [...new Map((round.pendingParticipants || []).map(item => [teamId(item), item])).values()];
  if (participants.length !== required) return false;
  const pairs = strictPairing(bracket, participants, random) || fallbackPairing(bracket, participants, random);
  round.matches.forEach((match, index) => {
    match.home = pairs[index][0]; match.away = pairs[index][1]; match.status = 'ready';
  });
  round.pendingParticipants = [];
  round.drawnAt = new Date().toISOString();
  return true;
}

function placeParticipant(bracket, pointer, value) {
  if (!pointer) return;
  if (pointer.draw) {
    const round = bracket.rounds[pointer.roundKey];
    if (!round.pendingParticipants.some(item => teamId(item) === teamId(value))) round.pendingParticipants.push(value);
    drawRound(bracket, round);
    return;
  }
  const target = findMatch(bracket, pointer.roundKey, pointer.matchId).match;
  target[pointer.side] = value;
  if (teamId(target.home) && teamId(target.away)) target.status = 'ready';
}

function activateReadyRounds(bracket) {
  const activated = [];
  for (const key of bracket.sequence) {
    const round = bracket.rounds[key];
    if (!round || ['completed', 'not_needed'].includes(round.status)) continue;
    if (round.status === 'open') continue;
    if (!round.matches.every(match => teamId(match.home) && teamId(match.away))) continue;
    round.status = 'open';
    round.matches.forEach(match => { if (match.status === 'ready') match.status = 'open'; });
    activated.push(round);
  }
  return activated;
}

function recordRoyaleResult(bracket, { roundKey, matchId, homeGoals, awayGoals }) {
  const { round, match } = findMatch(bracket, roundKey, matchId);
  if (!['open', 'pending_confirmation', 'admin_decision_required'].includes(match.status)) throw new Error('Dieses Royal-Spiel ist nicht offen.');
  const home = Number(homeGoals); const away = Number(awayGoals);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) throw new Error('Royal-Ergebnisse müssen einen eindeutigen Sieger haben.');
  const winner = home > away ? match.home : match.away;
  const loser = home > away ? match.away : match.home;
  const winnerId = teamId(winner); const loserId = teamId(loser);
  match.status = 'confirmed'; match.result = { homeGoals: home, awayGoals: away }; match.winner = winner; match.loser = loser; match.confirmation = null;
  bracket.losses[loserId] = Number(bracket.losses[loserId] || 0) + 1;

  if (roundKey === 'grand_final') {
    if (bracket.losses[loserId] < 2) {
      const reset = bracket.rounds.grand_final_reset;
      reset.status = 'open'; reset.matches[0].status = 'open'; reset.matches[0].home = match.home; reset.matches[0].away = match.away;
    } else {
      bracket.eliminatedTeamIds.push(loserId); bracket.championTeamId = winnerId; bracket.status = 'completed';
    }
  } else if (roundKey === 'grand_final_reset') {
    bracket.losses[loserId] = 2;
    bracket.eliminatedTeamIds.push(loserId); bracket.championTeamId = winnerId; bracket.status = 'completed';
  } else {
    placeParticipant(bracket, match.winnerNext, winner);
    if (bracket.losses[loserId] >= 2) bracket.eliminatedTeamIds.push(loserId);
    else placeParticipant(bracket, match.loserNext, loser);
  }

  if (round.matches.every(item => item.status === 'confirmed')) round.status = 'completed';
  if (bracket.status !== 'completed' && roundKey !== 'grand_final') activateReadyRounds(bracket);
  bracket.eliminatedTeamIds = [...new Set(bracket.eliminatedTeamIds)];
  return { winner, loser, eliminated: bracket.losses[loserId] >= 2, resetRequired: bracket.rounds.grand_final_reset.status === 'open' };
}

function submitRoyaleReport(bracket, { roundKey, matchId, reporterTeamId, homeGoals, awayGoals, reportedByUserId = null }) {
  const { match } = findMatch(bracket, roundKey, matchId);
  if (!['open', 'pending_confirmation', 'admin_decision_required'].includes(match.status)) throw new Error('Dieses Royal-Spiel ist nicht meldbar.');
  const reporter = String(reporterTeamId);
  if (![teamId(match.home), teamId(match.away)].includes(reporter)) throw new Error('Das meldende Team gehört nicht zu diesem Spiel.');
  const home = Number(homeGoals); const away = Number(awayGoals);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) throw new Error('Royal-Ergebnisse müssen einen eindeutigen Sieger haben.');
  match.reports = (match.reports || []).filter(report => String(report.reporterTeamId) !== reporter);
  const reportedAt = new Date().toISOString();
  match.reports.push({ participantKey: `team:${reporter}`, reporterTeamId: reporter, reportedByUserId: reportedByUserId ? String(reportedByUserId) : null, homeGoals: home, awayGoals: away, reportedAt, submittedAt: reportedAt });
  if (match.reports.length < 2) {
    match.status = 'pending_confirmation';
    match.confirmation = {
      ...(match.confirmation || {}),
      startedAt: match.confirmation?.startedAt || reportedAt,
      expiresAt: match.confirmation?.expiresAt || new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };
    return { status: 'pending_confirmation', match };
  }
  const confirmationNotice = match.confirmation ? { ...match.confirmation } : null;
  const [first, second] = match.reports;
  if (first.homeGoals !== second.homeGoals || first.awayGoals !== second.awayGoals) {
    match.status = 'admin_decision_required';
    match.confirmation = null;
    return { status: 'admin_decision_required', match, confirmationNotice };
  }
  const outcome = recordRoyaleResult(bracket, { roundKey, matchId, homeGoals: home, awayGoals: away });
  return { status: 'confirmed', match, confirmationNotice, ...outcome };
}

function autoConfirmRoyaleFirstReport(bracket, { roundKey, matchId, now = new Date() }) {
  const { match } = findMatch(bracket, roundKey, matchId);
  const reports = match.reports || [];
  const expiresAt = match.confirmation?.expiresAt ? new Date(match.confirmation.expiresAt) : null;
  if (match.status !== 'pending_confirmation' || reports.length !== 1 || !expiresAt || now < expiresAt) return null;
  const confirmationNotice = { ...(match.confirmation || {}) };
  const report = reports[0];
  const outcome = recordRoyaleResult(bracket, { roundKey, matchId, homeGoals: report.homeGoals, awayGoals: report.awayGoals });
  return { status: 'confirmed', match, confirmationNotice, automatic: true, ...outcome };
}

module.exports = { activateReadyRounds, activateNextRound: activateReadyRounds, autoConfirmRoyaleFirstReport, buildRoyaleBracket, drawRound, recordRoyaleResult, submitRoyaleReport };
