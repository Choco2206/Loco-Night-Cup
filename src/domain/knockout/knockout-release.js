'use strict';

const INVITE_WINDOW_MINUTES = 5;
const ROUND_REMINDER_MINUTES = 20;

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatHm(date) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function isReleasedMatch(match) {
  return match?.home?.type === 'team'
    && match?.away?.type === 'team'
    && ['open', 'pending_confirmation', 'admin_decision_required'].includes(match.status)
    && match.release?.releasedAt;
}

function getRoundReleaseAt(round) {
  return (round?.matches || [])
    .filter(isReleasedMatch)
    .map(match => new Date(match.release.releasedAt))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;
}

function getRoundReminderAt(releasedAt) {
  return addMinutes(releasedAt, ROUND_REMINDER_MINUTES);
}

function isRoundReadyForRelease(event, roundKey) {
  const knockout = event?.knockout || {};
  const round = knockout.rounds?.[roundKey];
  if (!getRoundReleaseAt(round)) return false;
  if (roundKey === knockout.firstRoundKey) return true;
  const prerequisiteByRound = {
    quarter_final: 'round_of_16',
    semi_final: 'quarter_final',
    third_place: 'semi_final',
    final: 'semi_final',
  };
  const prerequisite = prerequisiteByRound[roundKey];
  return !prerequisite || knockout.rounds?.[prerequisite]?.status === 'completed';
}

function buildRoundReleaseContent({ label, releasedAt }) {
  const inviteEnd = addMinutes(releasedAt, INVITE_WINDOW_MINUTES);
  return [
    `📢 **${label} ist freigegeben.**`,
    `Einladezeit: **${formatHm(releasedAt)} Uhr bis ${formatHm(inviteEnd)} Uhr**.`,
    'Bitte ladet eure Gegner innerhalb dieses Zeitfensters ein und startet anschließend eure Partie.',
  ].filter(Boolean).join('\n');
}

module.exports = {
  INVITE_WINDOW_MINUTES,
  ROUND_REMINDER_MINUTES,
  buildRoundReleaseContent,
  getRoundReleaseAt,
  getRoundReminderAt,
  isRoundReadyForRelease,
};

