'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createMessagesDefault } = require('../../storage/defaults');
const { refreshLiveSchedule } = require('../live-schedule');
const { enqueueCoalesced } = require('../../app/async-coalescer');
const {
  buildLiveTableEmbed,
  buildScheduleEmbed,
  buildTeamOverviewEmbed,
  getLiveTableRows,
  getQualificationText,
} = require('./group-embeds');
const { generateLiveTableImage } = require('../../../utils/generateLiveTableImage');
const { generateBomberXLocoLiveTableImage } = require('../../../utils/generateBomberXLocoLiveTableImage');
const { generateGroupScheduleImage } = require('../../../utils/generateGroupScheduleImage');
const { EVENT_KEYS } = require('../../app/constants');
const { readEventData } = require('../events/event-repository');
const { isBomberXLocoEvent } = require('../events/bomber-x-loco-config');

function nowIso() {
  return new Date().toISOString();
}

function buildHeaderPayload(group) {
  return {
    content: [
      `**${group.name || `Gruppe ${group.groupKey}`}**`,
      '',
      'Dieser Kanal enthält Teamübersicht, Live-Tabelle und Spielplan für die Gruppenphase.',
      'Ergebnisse können über die Buttons unter dem Spielplan gemeldet werden.',
    ].join('\n'),
    allowedMentions: { parse: [] },
  };
}

function buildScheduleButtons(group) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`group_result_open:${group.eventKey}:${group.groupKey}`)
      .setLabel('Ergebnis eintragen')
      .setEmoji('⚽')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`group_admin_result_open:${group.eventKey}:${group.groupKey}`)
      .setLabel('Admin-Ergebnis')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`group_replacement_open:${group.eventKey}:${group.groupKey}`)
      .setLabel('Nachrücker einsetzen')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function upsertMessage(channel, messageId, payload, label, { sendIfMissing = true } = {}) {
  const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (existing) {
    try {
      return await existing.edit(payload);
    } catch (error) {
      console.error(`Gruppe ${label}: vorhandene Message konnte nicht aktualisiert werden.`, error);
      throw error;
    }
  }

  if (messageId && !sendIfMissing) {
    throw new Error(`Gespeicherte Message ${messageId} wurde nicht gefunden; es wird keine Ersatznachricht erstellt.`);
  }

  try {
    return await channel.send(payload);
  } catch (error) {
    console.error(`Gruppe ${label}: Message konnte nicht gesendet werden. Bitte Bot-Berechtigungen prüfen.`, error);
    throw error;
  }
}

async function buildLiveTableImagePayload(group) {
  const event = group.eventKey ? readEventData(group.eventKey) : null;
  const rows = getLiveTableRows(group);
  const image = isBomberXLocoEvent(event)
    ? await generateBomberXLocoLiveTableImage({
        groupKey: group.groupKey,
        rows,
      })
    : await generateLiveTableImage({
        groupKey: group.groupKey,
        rows,
        qualificationText: getQualificationText(group.formatSize),
      });

  return {
    content: null,
    embeds: [],
    attachments: [],
    files: [{
      attachment: image,
      name: `live-table-group-${String(group.groupKey || 'group').toLowerCase()}.png`,
    }],
    allowedMentions: { parse: [] },
  };
}

async function buildScheduleImagePayload(group, { includeResultButtons = true } = {}) {
  const image = await generateGroupScheduleImage({
    group,
    debug: process.env.GROUP_SCHEDULE_DEBUG === 'true',
  });
  return {
    content: null,
    embeds: [new EmbedBuilder().setImage(`attachment://${image.fileName}`)],
    attachments: [],
    files: [{ attachment: image.buffer, name: image.fileName }],
    components: includeResultButtons ? [buildScheduleButtons(group)] : [],
    allowedMentions: { parse: [] },
  };
}

async function upsertGroupPosts(channel, group, refs = {}, resultsChannel = null) {
  const groupWithEvent = {
    ...group,
    eventKey: group.eventKey || refs.eventKey,
  };

  const headerMessageId = refs.headerMessageId || refs.messageId || group.headerMessageId || group.messageId || null;
  const teamsMessageId = refs.teamsMessageId || group.teamsMessageId || null;
  if (headerMessageId && String(headerMessageId) !== String(teamsMessageId || '')) {
    const header = await channel.messages.fetch(headerMessageId).catch(() => null);
    if (header) await header.delete().catch(error => {
      console.warn(`[group-posts] Alte Kopf-Nachricht für Gruppe ${group.groupKey} konnte nicht gelöscht werden: ${error.message}`);
    });
  }
  const teams = await upsertMessage(channel, refs.teamsMessageId || group.teamsMessageId, {
    embeds: [buildTeamOverviewEmbed(group)],
    allowedMentions: { parse: ['users'] },
  }, `${group.groupKey} Teamübersicht`);
  const existingTableMessageId = refs.tableMessageId || group.tableMessageId || null;
  let table = existingTableMessageId ? { id: existingTableMessageId } : null;
  try {
    const tablePayload = await buildLiveTableImagePayload(groupWithEvent);
    table = await upsertMessage(
      channel,
      existingTableMessageId,
      tablePayload,
      `${group.groupKey} Live-Tabelle`,
      { sendIfMissing: !existingTableMessageId }
    );
  } catch (error) {
    console.error(`[live-table] Bild/Discord-Update für Gruppe ${group.groupKey} fehlgeschlagen.`, error);

    if (!existingTableMessageId) {
      table = await upsertMessage(channel, null, {
        embeds: [buildLiveTableEmbed(group)],
        allowedMentions: { parse: [] },
      }, `${group.groupKey} Live-Tabelle Fallback`).catch(fallbackError => {
        console.error(`[live-table] Auch das Text-Fallback für Gruppe ${group.groupKey} ist fehlgeschlagen.`, fallbackError);
        return null;
      });
    }
  }
  const existingScheduleMessageId = refs.scheduleMessageId || group.scheduleMessageId || null;
  let schedule;
  try {
    const matches = (groupWithEvent.matchdays || []).flatMap(matchday => matchday.matches || []);
    console.info('[group-schedule] Spielplan wird aktualisiert.', {
      eventKey: groupWithEvent.eventKey,
      groupKey: groupWithEvent.groupKey,
      scheduleMessageId: existingScheduleMessageId,
      matches: matches.map(match => ({
        matchId: match.id,
        status: match.status,
        releasedAt: match.release?.releasedAt || null,
        result: match.result ? `${match.result.homeGoals}:${match.result.awayGoals}` : null,
        reports: Array.isArray(match.reports) ? match.reports.length : 0,
      })),
    });
    schedule = await upsertMessage(
      channel,
      existingScheduleMessageId,
      await buildScheduleImagePayload(groupWithEvent, { includeResultButtons: false }),
      `${group.groupKey} Spielplan`,
      { sendIfMissing: !existingScheduleMessageId }
    );
    console.info('[group-schedule] Spielplan-Nachricht wurde erfolgreich editiert.', {
      eventKey: groupWithEvent.eventKey,
      groupKey: groupWithEvent.groupKey,
      scheduleMessageId: schedule.id,
    });
  } catch (error) {
    console.error(`[group-schedule] Bild/Discord-Update für Gruppe ${group.groupKey} fehlgeschlagen.`, error);
    schedule = await upsertMessage(channel, existingScheduleMessageId, {
      content: null,
      embeds: [buildScheduleEmbed(group)],
      attachments: [],
      components: [],
      allowedMentions: { parse: [] },
    }, `${group.groupKey} Spielplan Fallback`, { sendIfMissing: !existingScheduleMessageId });
  }

  let resultsTableMessageId = refs.resultsTableMessageId || group.resultsTableMessageId || null;
  let resultsScheduleMessageId = refs.resultsScheduleMessageId || group.resultsScheduleMessageId || null;
  if (resultsChannel) {
    const resultsTable = await upsertMessage(
      resultsChannel,
      resultsTableMessageId,
      await buildLiveTableImagePayload(groupWithEvent),
      `${group.groupKey} Ergebnis-Live-Tabelle`,
      { sendIfMissing: !resultsTableMessageId }
    );
    const resultsSchedule = await upsertMessage(
      resultsChannel,
      resultsScheduleMessageId,
      await buildScheduleImagePayload(groupWithEvent, { includeResultButtons: true }),
      `${group.groupKey} Ergebnis-Spielplan`,
      { sendIfMissing: !resultsScheduleMessageId }
    );
    resultsTableMessageId = resultsTable.id;
    resultsScheduleMessageId = resultsSchedule.id;
  }

  return {
    headerMessageId: null,
    messageId: teams.id,
    teamsMessageId: teams.id,
    tableMessageId: table?.id || existingTableMessageId,
    scheduleMessageId: schedule.id,
    resultsTableMessageId,
    resultsScheduleMessageId,
  };
}

async function performGroupPostsRefresh({ client, eventKey, event, group }) {
  if (!client || !group) return null;

  const persistedEvent = readEventData(eventKey);
  const persistedGroup = persistedEvent.groups?.groups?.[group.groupKey] || group;
  const eventForRefresh = persistedEvent.groups?.groups?.[group.groupKey] ? persistedEvent : event;
  const messages = readJson(FILES.messages, createMessagesDefault());
  const refs = messages.groups?.[eventKey]?.groups?.[group.groupKey] || {};
  const channelId = persistedGroup.channelId || refs.channelId;
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const resultsChannelId = persistedGroup.resultsChannelId || refs.resultsChannelId;
  const resultsChannel = resultsChannelId
    ? await client.channels.fetch(resultsChannelId).catch(() => null)
    : null;

  const messageRefs = await upsertGroupPosts(channel, {
    ...persistedGroup,
    eventKey,
    formatSize: eventForRefresh.format?.size,
  }, {
    eventKey,
    ...refs,
  }, resultsChannel);

  updateGroupMessageRefs(eventKey, eventForRefresh, [{
    groupKey: persistedGroup.groupKey,
    roleId: persistedGroup.roleId || refs.roleId || null,
    channelId,
    resultsChannelId: resultsChannel?.id || resultsChannelId || null,
    ...messageRefs,
  }]);

  await refreshLiveSchedule(client, eventKey, eventForRefresh).catch(error => {
    console.warn(`[live-schedule] Gruppen-Refresh für ${eventKey} fehlgeschlagen: ${error.message}`);
  });

  return messageRefs;
}

function refreshGroupPosts({ client, eventKey, event, group }) {
  const groupKey = group?.groupKey || 'unknown';
  return enqueueCoalesced(`group-posts:${eventKey}:${groupKey}`, () => (
    performGroupPostsRefresh({ client, eventKey, event, group })
  ));
}

async function refreshGroupPostsForTeam(client, teamId) {
  if (!client || !teamId) return [];
  const refreshed = [];
  for (const eventKey of EVENT_KEYS) {
    const event = readEventData(eventKey);
    if ((event.leaguePhase?.slots || []).some(slot => slot?.type === 'team' && String(slot.teamId) === String(teamId))) {
      const { refreshLeaguePhasePosts } = require('../league-phase/league-phase-service');
      await refreshLeaguePhasePosts(client, eventKey);
      refreshed.push({ eventKey, groupKey: 'league' });
    }
    for (const group of Object.values(event.groups?.groups || {})) {
      const containsTeam = (group.slots || []).some(slot => (
        slot?.type === 'team' && String(slot.teamId) === String(teamId)
      ));
      if (!containsTeam) continue;
      await refreshGroupPosts({ client, eventKey, event, group });
      refreshed.push({ eventKey, groupKey: group.groupKey });
    }
  }
  return refreshed;
}

function updateGroupMessageRefs(eventKey, event, groupUpdates) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    messages.groups = messages.groups || {};
    messages.groups[eventKey] = messages.groups[eventKey] || { cycleKey: null, groups: {} };
    messages.groups[eventKey].cycleKey = event.cycle?.cycleKey || null;
    messages.groups[eventKey].groups = messages.groups[eventKey].groups || {};

    for (const update of groupUpdates) {
      const previous = messages.groups[eventKey].groups[update.groupKey] || {};
      messages.groups[eventKey].groups[update.groupKey] = {
        ...previous,
        channelId: update.channelId,
        roleId: update.roleId,
        messageId: update.messageId || update.teamsMessageId,
        headerMessageId: update.headerMessageId || null,
        teamsMessageId: update.teamsMessageId,
        tableMessageId: update.tableMessageId,
        scheduleMessageId: update.scheduleMessageId,
        resultsChannelId: update.resultsChannelId || previous.resultsChannelId || null,
        resultsTableMessageId: update.resultsTableMessageId || previous.resultsTableMessageId || null,
        resultsScheduleMessageId: update.resultsScheduleMessageId || previous.resultsScheduleMessageId || null,
        updatedAt: nowIso(),
      };
    }

    messages.meta = {
      ...(messages.meta || {}),
      updatedAt: nowIso(),
    };

    return messages;
  });
}

module.exports = {
  buildHeaderPayload,
  buildScheduleButtons,
  refreshGroupPosts,
  refreshGroupPostsForTeam,
  updateGroupMessageRefs,
  upsertGroupPosts,
};
