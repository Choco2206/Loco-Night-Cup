'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('./event-repository');
const { buildLockedParticipantField } = require('./event-format');
const { createGroups } = require('../groups/group-draw');
const { assertCanLockEvent, assertGroupsHaveFourSlots } = require('../groups/group-validation');
const { assignGroupRoles } = require('../groups/group-roles');
const { prepareGroupChannels } = require('../groups/group-channels');

function nowIso(now = new Date()) {
  return now.toISOString();
}

function lockEventAndCreateGroups({ eventKey, actorUserId = null, client = null, now = new Date() }) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const timestamp = nowIso(now);
  let lockedEvent;
  let field;

  updateEventData(eventKey, event => {
    assertCanLockEvent(event);
    field = buildLockedParticipantField(event, now);

    const groups = createGroups({
      eventKey,
      field,
      settings,
      createdAt: timestamp,
    });
    assertGroupsHaveFourSlots(groups);

    event.status = 'groups';
    event.format = {
      ...event.format,
      minimumRealTeams: field.minimumRealTeams,
      allowedSizes: field.allowedSizes,
      size: field.size,
      realTeamCount: field.realTeamCount,
      byeCount: field.byeCount,
      waitlistCount: field.waitlistTeams.length,
      lockedAt: timestamp,
    };

    event.checkin = {
      ...event.checkin,
      isOpen: false,
      closedAt: event.checkin?.closedAt || timestamp,
      entries: event.checkin?.entries || [],
      activeTeamIds: field.activeTeams.map(team => String(team.id)),
      waitlistTeamIds: field.waitlistTeams.map(team => String(team.id)),
      lateLeaveBans: event.checkin?.lateLeaveBans || [],
    };

    event.groups = {
      status: 'active',
      drawnAt: timestamp,
      drawnBy: actorUserId ? String(actorUserId) : null,
      groups,
      meta: {
        skippedCheckins: field.skipped,
      },
    };

    event.meta = {
      ...event.meta,
      updatedAt: timestamp,
    };

    lockedEvent = event;
    return event;
  });

  return Promise.resolve()
    .then(async () => {
      const roleResult = await assignGroupRoles({ client, event: lockedEvent });
      const channelResult = await prepareGroupChannels({ client, event: lockedEvent });
      return {
        event: lockedEvent,
        field,
        roles: roleResult,
        channels: channelResult,
      };
    });
}

function getLockedEventPreview(eventKey, now = new Date()) {
  const event = readEventData(eventKey);
  const field = buildLockedParticipantField(event, now);
  return {
    eventKey,
    formatSize: field.size,
    activeTeamIds: field.activeTeams.map(team => String(team.id)),
    waitlistTeamIds: field.waitlistTeams.map(team => String(team.id)),
    usedByeIds: field.activeByes.map(bye => String(bye.id)),
    skippedCheckins: field.skipped,
  };
}

module.exports = {
  getLockedEventPreview,
  lockEventAndCreateGroups,
};
