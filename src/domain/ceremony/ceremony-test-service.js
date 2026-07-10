'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AttachmentBuilder, ChannelType } = require('discord.js');
const { FILES, ROOT_DIR, TEAM_LOGOS_DIR, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { getAutoCleanupScheduledAt, scheduleAutoCleanupForEvent } = require('../events/event-cleanup-service');
const { findTeamById } = require('../teams/team-service');
const {
  applyTeamAchievementsForEvent,
  refreshTeamAchievementsRankingMessage,
} = require('../teams/team-achievements');
const { applyTeamStatsForEvent } = require('../teams/team-statistics');
const { syncChampionRolesForTeam } = require('../teams/team-champion-roles');

const HALL_OF_FAME_CHANNEL_NAME = '👑-hall-of-fame';
const HALL_OF_FAME_TEST_CHANNEL_ID = '1525035287971889173';
const CEREMONY_LOGO_SCALE = 1.75;
const CEREMONY_LOGO_Y_OFFSET = -50;
const CEREMONY_BANNER_DIR = path.join(ROOT_DIR, 'assets', 'ceremony');

const CEREMONY_DAY_LABELS = {
  monday: 'Montag',
  tuesday: 'Dienstag',
  wednesday: 'Mittwoch',
  thursday: 'Donnerstag',
  friday: 'Freitag',
  saturday: 'Samstag',
  sunday: 'Sonntag',
};

const CEREMONY_BANNERS = {
  monday: 'montag-banner.png',
  tuesday: 'dienstag-banner.png',
  wednesday: 'mittwoch-banner.png',
  thursday: 'donnerstag-banner.png',
  friday: 'freitag-banner.png',
  saturday: 'samstag-banner.png',
  sunday: 'sonntag-banner.png',
};

const DEFAULT_LOGO_POSITIONS = {
  first: { x: 728, y: 778, width: 216, height: 82 },
  second: { x: 286, y: 792, width: 214, height: 66 },
  third: { x: 1178, y: 792, width: 214, height: 66 },
};

function createDefaultLogoPositions() {
  return {
    first: { ...DEFAULT_LOGO_POSITIONS.first },
    second: { ...DEFAULT_LOGO_POSITIONS.second },
    third: { ...DEFAULT_LOGO_POSITIONS.third },
  };
}

const CEREMONY_LOGO_POSITIONS = {
  monday: {
    first: { x: 663, y: 752, width: 356, height: 136 },
    second: { x: 305, y: 761, width: 317, height: 99 },
    third: { x: 1046, y: 776, width: 317, height: 99 },
  },
  tuesday: {
    first: { x: 658, y: 801, width: 356, height: 136 },
    second: { x: 275, y: 816, width: 317, height: 99 },
    third: { x: 1087, y: 806, width: 317, height: 99 },
  },
  wednesday: {
    first: { x: 653, y: 797, width: 356, height: 136 },
    second: { x: 235, y: 810, width: 317, height: 99 },
    third: { x: 1077, y: 820, width: 317, height: 99 },
  },
  thursday: {
    first: { x: 658, y: 783, width: 356, height: 136 },
    second: { x: 275, y: 810, width: 317, height: 99 },
    third: { x: 1077, y: 810, width: 317, height: 99 },
  },
  friday: {
    first: { x: 648, y: 783, width: 356, height: 136 },
    second: { x: 255, y: 808, width: 317, height: 99 },
    third: { x: 1097, y: 798, width: 317, height: 99 },
  },
  saturday: {
    first: { x: 658, y: 813, width: 356, height: 136 },
    second: { x: 275, y: 828, width: 317, height: 99 },
    third: { x: 1082, y: 838, width: 317, height: 99 },
  },
  sunday: {
    first: { x: 658, y: 809, width: 356, height: 136 },
    second: { x: 285, y: 824, width: 317, height: 99 },
    third: { x: 1067, y: 824, width: 317, height: 99 },
  },
}

