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
const TOURNAMENT_FORMAT_SIZES = [8, 12, 16, 20, 24, 28, 32];

const TOURNAMENT_FORMATS = {
  8: { groupCount: 2, qualifiedCount: 4, bestThirds: 0, firstRoundKey: 'semi_final', rule: 'top2' },
  12: { groupCount: 3, qualifiedCount: 8, bestThirds: 2, firstRoundKey: 'quarter_final', rule: 'top2_plus_2_best_thirds' },
  16: { groupCount: 4, qualifiedCount: 8, bestThirds: 0, firstRoundKey: 'quarter_final', rule: 'top2' },
  20: { groupCount: 0, qualifiedCount: 8, bestThirds: 0, firstRoundKey: 'quarter_final', rule: 'league_top_8', phaseType: 'league' },
  24: { groupCount: 6, qualifiedCount: 16, bestThirds: 4, firstRoundKey: 'round_of_16', rule: 'top2_plus_4_best_thirds' },
  28: { groupCount: 7, qualifiedCount: 16, bestThirds: 2, firstRoundKey: 'round_of_16', rule: 'top2_plus_2_best_thirds' },
  32: { groupCount: 8, qualifiedCount: 16, bestThirds: 0, firstRoundKey: 'round_of_16', rule: 'top2' },
};

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
  'checkin_open',
  'deadline_reached',
  'checkin_closed',
  'draw_ready',
  'groups',
  'groups_running',
  'league_phase',
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
  monday: 'weekend_night',
  tuesday: 'weekend_night',
  wednesday: 'weekend_night',
  thursday: 'weekend_night',
  friday: 'weekend_late_night',
  saturday: 'weekend_late_night',
  sunday: 'weekend_night',
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
  TOURNAMENT_FORMAT_SIZES,
  TOURNAMENT_FORMATS,
};
