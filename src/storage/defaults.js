'use strict';

const {
  DATA_VERSION,
  EVENT_KEYS,
  EVENT_LABELS,
  EVENT_PROFILE_BY_KEY,
  GROUP_KEYS,
  KNOCKOUT_ROUNDS,
  TOURNAMENT_FORMAT_SIZES,
  TOURNAMENT_FORMATS,
} = require('../app/constants');

function emptyTimestampMeta() {
  return {
    createdAt: null,
    updatedAt: null,
  };
}

function emptyPanelMessage() {
  return {
    channelId: null,
    messageId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function createTeamsDefault() {
  return {
    version: DATA_VERSION,
    teams: [],
  };
}

function createTeamHistoryDefault() {
  return {
    titles: {
      gold: 0,
      silver: 0,
      bronze: 0,
    },
  };
}

function createBansDefault() {
  return {
    version: DATA_VERSION,
    bans: [],
  };
}

function createScheduleDefault(eventKey) {
  const profile = EVENT_PROFILE_BY_KEY[eventKey];
  const isLateWeekendNight = profile === 'weekend_late_night';

  return {
    profile,
    deadlineTime: isLateWeekendNight ? '23:45' : '23:30',
    lateWindowUntilTime: isLateWeekendNight ? '00:00' : '23:45',
    drawTime: isLateWeekendNight ? '00:05' : '23:50',
    tournamentStartTime: isLateWeekendNight ? '00:15' : '00:00',
    deadlineIsNextDay: false,
    lateWindowIsNextDay: isLateWeekendNight,
    drawIsNextDay: isLateWeekendNight,
    startIsNextDay: true,
    checkinOpenAt: null,
    deadlineAt: null,
    lateWindowUntil: null,
    drawAt: null,
    tournamentStartAt: null,
    resetAt: null,
  };
}

function createEventDefault(eventKey) {
  return {
    version: DATA_VERSION,
    eventKey,
    label: EVENT_LABELS[eventKey],
    status: 'idle',
    cycle: {
      cycleKey: null,
      eventDate: null,
      timezone: 'Europe/Berlin',
    },
    schedule: createScheduleDefault(eventKey),
    format: {
      minimumRealTeams: 8,
      allowedSizes: [...TOURNAMENT_FORMAT_SIZES],
      size: null,
      realTeamCount: 0,
      byeCount: 0,
      waitlistCount: 0,
      lockedAt: null,
    },
    checkin: {
      isOpen: false,
      openedAt: null,
      closedAt: null,
      entries: [],
      activeTeamIds: [],
      waitlistTeamIds: [],
      lateLeaveBans: [],
    },
    byes: [],
    groups: {
      status: 'not_created',
      drawnAt: null,
      drawnBy: null,
      groups: {},
    },
    leaguePhase: {
      phaseType: null, status: 'not_created', participants: [], slots: [], matchdays: [], standings: [],
      currentMatchday: 0, roleId: null, overviewChannelId: null, resultsChannelId: null,
      transitionStatus: 'not_started', messages: {},
    },
    knockout: {
      status: 'not_created',
      createdAt: null,
      source: {
        qualifiedRule: null,
        avoidSameGroupRematches: true,
      },
      rounds: {},
    },
    ceremony: {
      status: 'not_ready',
      placements: {
        firstTeamId: null,
        secondTeamId: null,
        thirdTeamId: null,
      },
      teamAchievements: {
        appliedAt: null,
        placements: {
          gold: null,
          silver: null,
          bronze: null,
        },
        championPromotion: null,
      },
      teamStats: {
        appliedAt: null,
        participantTeamIds: [],
        matchCount: 0,
      },
      postedAt: null,
      postedMessageIds: [],
      cleanupStatus: null,
      cleanupScheduledAt: null,
      cleanupCompletedAt: null,
      testRuns: [],
    },
    reset: {
      status: 'not_scheduled',
      resetAt: null,
      completedAt: null,
      keepStats: true,
    },
    meta: {
      createdAt: null,
      updatedAt: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancelReason: null,
    },
  };
}

function createEventMap(factory) {
  return Object.fromEntries(EVENT_KEYS.map(eventKey => [eventKey, factory(eventKey)]));
}

function emptyCheckinMessages() {
  return {
    channelId: null,
    mainMessageId: null,
    teamsListMessageIds: [],
    waitlistMessageIds: [],
    warningMessageId: null,
    summaryMessageId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function emptyGroupMessages() {
  return {
    cycleKey: null,
    groups: {},
  };
}

function emptyKnockoutMessages() {
  return {
    cycleKey: null,
    rounds: Object.fromEntries(
      KNOCKOUT_ROUNDS.map(roundKey => [
        roundKey,
        {
          channelId: null,
          messageId: null,
          releaseMessageId: null,
          reminderMessageIds: [],
          createdAt: null,
          updatedAt: null,
        },
      ])
    ),
  };
}

function emptyCeremonyMessages() {
  return {
    cycleKey: null,
    channelId: null,
    imageMessageId: null,
    textMessageId: null,
    testMessageIds: [],
    postedAt: null,
    updatedAt: null,
  };
}

function createMessagesDefault() {
  return {
    version: DATA_VERSION,
    guildId: null,
    setup: {
      welcome: emptyPanelMessage(),
    },
    roles: {
      roleSelect: emptyPanelMessage(),
      roleSelectPanel: emptyPanelMessage(),
    },
    teams: {
      registrationPanel: emptyPanelMessage(),
      myTeamPanel: emptyPanelMessage(),
      registeredTeamsOverview: {
        channelId: null,
        headerMessageId: null,
        listMessageIds: [],
        createdAt: null,
        updatedAt: null,
      },
      teamAchievements: {
        channelId: null,
        messageIds: [],
        createdAt: null,
        updatedAt: null,
      },
    },
    checkins: createEventMap(() => emptyCheckinMessages()),
    liveSchedule: {
      channelId: null,
      currentEventKey: null,
      cycleKey: null,
      phase: null,
      headerMessageId: null,
      groupMessageIds: {},
      knockoutMessageIds: {},
      cleanupStatus: null,
      createdAt: null,
      updatedAt: null,
    },
    groups: createEventMap(() => emptyGroupMessages()),
    leaguePhase: createEventMap(() => ({ cycleKey: null })),
    knockout: createEventMap(() => emptyKnockoutMessages()),
    banlist: {
      channelId: null,
      infoMessageId: null,
      listMessageId: null,
      createdAt: null,
      updatedAt: null,
    },
    admin: {
      panel: emptyPanelMessage(),
      managersWithoutTeam: {
        channelId: null,
        messageIds: [],
        createdAt: null,
        updatedAt: null,
      },
    },
    ceremony: createEventMap(() => emptyCeremonyMessages()),
    meta: emptyTimestampMeta(),
  };
}

function createSettingsDefault() {
  const groupIds = Object.fromEntries(GROUP_KEYS.map(key => [key, null]));
  const knockoutIds = Object.fromEntries(KNOCKOUT_ROUNDS.map(key => [key, null]));
  const eventIds = Object.fromEntries(EVENT_KEYS.map(key => [key, null]));

  return {
    version: DATA_VERSION,
    guild: {
      guildId: null,
    },
    roles: {
      adminRoleIds: [],
      cupLeadRoleIds: [],
      playerRoleId: null,
      managerRoleId: null,
      coManagerRoleId: null,
      championRoleIds: {
        champion: null,
        elite: null,
        master: null,
        legend: null,
        immortal: null,
      },
      groupRoleIds: groupIds,
      knockoutRoleIds: knockoutIds,
    },
    channels: {
      welcomeChannelId: null,
      roleSelectChannelId: null,
      teamRegistrationChannelId: null,
      registeredTeamsChannelId: null,
      rulesChannelId: null,
      banlistChannelId: null,
      adminPanelChannelId: null,
      announcementChannelId: null,
      liveScheduleChannelId: null,
      teamSearchChannelId: null,
      helperSearchChannelId: null,
      hallOfFameChannelId: null,
      logChannelId: null,
      rulebookChannelId: null,
      chatChannelId: null,
      cooperationChannelId: null,
      feedbackChannelId: null,
      managerSupportChannelId: null,
      playerSearchChannelId: null,
      helperAvailableChannelId: null,
      checkinChannelIds: eventIds,
      groupChannelIds: groupIds,
      knockoutOverviewChannelId: null,
      knockoutChannelIds: knockoutIds,
    },
    assets: {
      checkinBannerPath: 'data/assets/check-in.png',
    },
    categories: {
      welcomeCategoryId: null,
      systemCategoryId: null,
      accessCategoryId: null,
      nightHubCategoryId: null,
      managerCategoryId: null,
      publicScheduleCategoryId: null,
      nightEventsCategoryId: null,
      searchCategoryId: null,
      groupsCategoryId: null,
      checkinCategoryId: null,
      groupCategoryId: null,
      knockoutCategoryId: null,
      archiveCategoryId: null,
    },
    permissions: {
      adminRoleIds: [],
      cupLeadRoleIds: [],
      adminActions: {
        teamDetails: ['admin', 'cup_lead'],
        editTeam: ['admin', 'cup_lead'],
        deleteTeam: ['admin'],
        banTeam: ['admin'],
        addBye: ['admin', 'cup_lead'],
        removeBye: ['admin', 'cup_lead'],
        eventStatus: ['admin', 'cup_lead'],
        cancelEvent: ['admin'],
        resetEvent: ['admin'],
        ceremonyTest: ['admin', 'cup_lead'],
      },
    },
    timeProfiles: {
      timezone: 'Europe/Berlin',
      eventProfiles: { ...EVENT_PROFILE_BY_KEY },
      profiles: {
        early: {
          deadlineTime: '23:30',
          lateWindowUntilTime: '23:45',
          drawTime: '23:50',
          tournamentStartTime: '00:00',
          deadlineIsNextDay: false,
          lateWindowIsNextDay: false,
          drawIsNextDay: false,
          startIsNextDay: true,
        },
        weekend_night: {
          deadlineTime: '23:30',
          lateWindowUntilTime: '23:45',
          drawTime: '23:50',
          tournamentStartTime: '00:00',
          deadlineIsNextDay: false,
          lateWindowIsNextDay: false,
          drawIsNextDay: false,
          startIsNextDay: true,
        },
        weekend_late_night: {
          deadlineTime: '23:45',
          lateWindowUntilTime: '00:00',
          drawTime: '00:05',
          tournamentStartTime: '00:15',
          deadlineIsNextDay: false,
          lateWindowIsNextDay: true,
          drawIsNextDay: true,
          startIsNextDay: true,
        },
      },
    },
    tournament: {
      minimumRealTeams: 8,
      allowedSizes: [...TOURNAMENT_FORMAT_SIZES],
      groupSize: 4,
      points: {
        win: 3,
        draw: 1,
        loss: 0,
      },
      qualificationRules: {
        8: TOURNAMENT_FORMATS[8].rule,
        12: TOURNAMENT_FORMATS[12].rule,
        16: TOURNAMENT_FORMATS[16].rule,
        20: TOURNAMENT_FORMATS[20].rule,
        24: TOURNAMENT_FORMATS[24].rule,
        28: TOURNAMENT_FORMATS[28].rule,
        32: TOURNAMENT_FORMATS[32].rule,
      },
      avoidSameGroupRematchesInFirstKoRound: true,
      thirdPlaceMatchRequired: true,
      knockoutDrawsAllowed: false,
      knockoutTiebreaker: ['extra_time', 'penalties'],
    },
    teams: {
      coManagerLimit: 5,
      clubNameMinLength: 2,
      clubNameMaxLength: 30,
      logoRequired: true,
      allowedLogoExtensions: ['png', 'jpg', 'jpeg', 'webp'],
      maxLogoFileSizeMb: 8,
    },
    checkin: {
      allowMultipleEventsPerTeam: true,
      allowDuplicateCheckinPerEvent: false,
      allowManagerCheckin: true,
      allowCoManagerCheckin: true,
      lateWithdrawalCreatesBan: true,
      lateWithdrawalReason: 'late_withdrawal',
      showTeamsPublicly: true,
      showWaitlistPublicly: true,
      waitlistIsInformationalOnly: true,
      noPromotionFromWaitlist: true,
    },
    bans: {
      durationsDays: {
        late_withdrawal: 7,
        no_show: 14,
        left_tournament: 14,
        disrespect: 14,
        admin_other: 14,
      },
      affectsTeam: true,
      affectsManager: true,
      affectsCoManagers: true,
      removeExistingCheckins: true,
    },
    liveSchedule: {
      enabled: true,
      mode: 'mirror_only',
      buttonsEnabled: false,
      showGroupsDuringGroupPhase: true,
      deleteGroupEmbedsWhenKnockoutStarts: true,
      showKnockoutDuringKnockoutPhase: true,
    },
    ceremony: {
      enabled: true,
      postToAnnouncementChannel: true,
      mentionEveryone: false,
      generateImage: true,
      includeTextSummary: true,
      allowTestRun: true,
    },
    teamSearch: {
      enabled: true,
      cooldownsSeconds: {
        teamSearchPost: 21600,
        helperSearchPost: 600,
      },
      autoDeleteAfterMinutes: 120,
    },
    meta: emptyTimestampMeta(),
  };
}

module.exports = {
  createBansDefault,
  createEventDefault,
  createMessagesDefault,
  createSettingsDefault,
  createTeamHistoryDefault,
  createTeamsDefault,
};
