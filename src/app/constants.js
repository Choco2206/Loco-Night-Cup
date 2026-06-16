'use strict';

const EVENT_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const EVENT_LABELS = {
  monday: 'Montag',
  tuesday: 'Dienstag',
  wednesday: 'Mittwoch',
  thursday: 'Donnerstag',
  friday: 'Freitag',
  saturday: 'Samstag',
  sunday: 'Sonntag',
};

const GROUP_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const KNOCKOUT_ROUNDS = [
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
];

const EVENT_STATUSES = [
  'idle',
  'checkin',
  'groups',
  'knockout',
  'ceremony',
  'completed',
  'cancelled',
  'reset',
];

const TEAM_STATUSES = ['active', 'leaderless', 'suspended', 'deleted'];
const REGISTRATION_STATUSES = ['complete', 'incomplete'];
const BAN_STATUSES = ['active', 'expired', 'revoked'];
const BAN_REASONS = [
  'late_withdrawal',
  'no_show',
  'left_tournament',
  'disrespect',
  'admin_other',
];

const EVENT_PROFILE_BY_KEY = {
  monday: 'early',
  tuesday: 'early',
  wednesday: 'early',
  thursday: 'early',
  friday: 'weekend_night',
  saturday: 'weekend_night',
  sunday: 'early',
};

const DATA_VERSION = 1;

module.exports = {
  BAN_REASONS,
  BAN_STATUSES,
  DATA_VERSION,
  EVENT_KEYS,
  EVENT_LABELS,
  EVENT_PROFILE_BY_KEY,
  EVENT_STATUSES,
  GROUP_KEYS,
  KNOCKOUT_ROUNDS,
  REGISTRATION_STATUSES,
  TEAM_STATUSES,
};
