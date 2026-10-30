'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { AttachmentBuilder, ChannelType } = require('discord.js');
const baseCeremony = require('./ceremony-test-service');
const { FILES, ROOT_DIR, TEAM_LOGOS_DIR, readJson, updateJson } = require('../../storage');
const { createMessagesDefault, createSettingsDefault } = require('../../storage/defaults');
const { readEventData, updateEventData } = require('../events/event-repository');
const { getAutoCleanupScheduledAt, scheduleAutoCleanupForEvent } = require('../events/event-cleanup-service');
const { findTeamById } = require('../teams/team-service');
const { isBomberXLocoEvent } = require('../events/bomber-x-loco-config');
const {
  applyTeamAchievementsForEvent,
  refreshTeamAchievementsRankingMessage,
} = require('../teams/team-achievements');
const { applyTeamStatsForEvent } = require('../teams/team-statistics');
const { syncChampionRolesForTeam } = require('../teams/team-champion-roles');
const halloweenLayout = require('../../../config/bomber-x-loco-halloween-ceremony-layout');
const ceremonyLayout = require('../../../config/bomber-x-loco-ceremony-layout');

const TEMPLATE_PATH = path.join(ROOT_DIR, 'assets', 'bomber-x-loco', 'ceremony.png');
const REFERENCE = ceremonyLayout.reference;
const LOGO_SLOTS = Object.freeze({
  first: Object.freeze({ ...ceremonyLayout.placements.first }),
  second: Object.freeze({ ...ceremonyLayout.placements.second }),
  third: Object.freeze({ ...ceremonyLayout.placements.third }),
});

function findPlacementTeam(teamId, placement) {
  const team = teamId ? findTeamById(teamId) : null;
  if (!team || team.status === 'deleted') throw new Error(`Team für ${placement} wurde nicht gefunden.`);
  return team;
}

function getTeams(event) {
  const placements = event?.ceremony?.placements || event?.knockout?.placements || {};
  return {
    first: findPlacementTeam(placements.firstTeamId, 'Platz 1'),
    second: findPlacementTeam(placements.secondTeamId, 'Platz 2'),
    third: findPlacementTeam(placements.thirdTeamId, 'Platz 3'),
  };
}

function resolveLogoPath(team) {
  if (!team?.logo?.fileName) return null;
  const fileName = path.basename(team.logo.fileName);
  const candidates = [
    team.logo.path && !String(team.logo.path).includes('://') ? path.resolve(ROOT_DIR, team.logo.path) : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

async function logoOverlay(team, slot, scaleX, scaleY) {
  const logoPath = resolveLogoPath(team);
  if (!logoPath) return null;
  const width = Math.round(slot.width * scaleX);
  const height = Math.round(slot.height * scaleY);
  const resized = await sharp(logoPath).resize(width, height, {
    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true,
  }).png().toBuffer();
  const meta = await sharp(resized).metadata();
  return {
    input: resized,
    left: Math.round((slot.centerX * scaleX) - (meta.width / 2)),
    top: Math.round((slot.centerY * scaleY) - (meta.height / 2)),
  };
}

async function renderBomberXLocoCeremonyImage({ teams, eventKey = null }) {
  const layout = eventKey === 'bomber_halloween' ? halloweenLayout : ceremonyLayout;
  const templatePath = eventKey === 'bomber_halloween' ? path.resolve(ROOT_DIR, layout.template) : TEMPLATE_PATH;
  const reference = layout.reference;
  const slots = layout.placements;
  if (!fs.existsSync(templatePath)) throw new Error('Bomber X Loco Siegerehrungsbild wurde nicht gefunden.');
  const meta = await sharp(templatePath).metadata();
  const width = Number(meta.width || reference.width);
  const height = Number(meta.height || reference.height);
  const scaleX = width / reference.width;
  const scaleY = height / reference.height;
  const overlays = (await Promise.all([
    logoOverlay(teams.first, slots.first, scaleX, scaleY),
    logoOverlay(teams.second, slots.second, scaleX, scaleY),
    logoOverlay(teams.third, slots.third, scaleX, scaleY),
  ])).filter(Boolean);
  const buffer = await sharp(templatePath).composite(overlays).png().toBuffer();
  return { buffer, width, height, slots };
}

function teamPings(team) {
  const ids = [team?.manager?.userId, ...(Array.isArray(team?.coManagers) ? team.coManagers.map(manager => manager?.userId) : [])]
    .filter(Boolean).map(String);
  const unique = [...new Set(ids)];
  return unique.length ? unique.map(id => `<@${id}>`).join(' ') : '-';
}

function promotionLines(promotion) {
  if (!promotion?.name) return [];
  return [
    '',
    '🔥 **Aufstieg freigeschaltet!**',
    `Der Turniersieg bringt den neuen Rang: **${promotion.name}**`,
  ];
}

function buildBomberXLocoCeremonyText({ teams, promotion = null, halloween = false }) {
  if (halloween) return [
    '🎃🏆 **BOMBER X LOCO HALLOWEEN CUP • 30.10.2026**', '',
    'Die letzte Begegnung ist gespielt, die Geister können schlafen gehen. Unsere Podiumsplätze stehen fest! 👻', '',
    `🥇 **1. Platz • ${teams.first.clubName}**`,
    `👑 VM / Co-VM: ${teamPings(teams.first)}`,
    ...promotionLines(promotion), '',
    'Eiskalt durch die Halloween-Nacht und am Ende den Pokal geholt. Glückwunsch an unsere Champions! 🏆🔥', '',
    `🥈 **2. Platz • ${teams.second.clubName}**`,
    `👑 VM / Co-VM: ${teamPings(teams.second)}`, '',
    'Bis ins Finale gekämpft und euren Gegnern das Fürchten gelehrt. Starker zweiter Platz! 🦇', '',
    `🥉 **3. Platz • ${teams.third.clubName}**`,
    `👑 VM / Co-VM: ${teamPings(teams.third)}`, '',
    'Im Spiel um Platz 3 noch einmal alles rausgeholt und das Podium gesichert. Glückwunsch! 🎃', '',
    'Ein großes Danke an alle Teams, Manager und Helfer von **Bomber Cup** und **Loco Night Cup**. Ihr habt diese Halloween-Nacht besonders gemacht. 💣🐺', '',
    '**Wenn andere schlafen, spielen wir um Titel. Auch wenn es spukt. 👻🏆**',
  ].join('\n');
  return [
    '🏆 **BOMBER X LOCO CUP • FC 27 OPENING CUP**',
    '',
    'Der erste gemeinsame **Bomber X Loco Cup** ist gespielt und damit steht unsere erste Top 3 fest.',
    '',
    `🥇 **1. Platz • ${teams.first.clubName}**`,
    `👑 VM / Co-VM: ${teamPings(teams.first)}`,
    ...promotionLines(promotion),
    '',
    'Verdient den Titel geholt und über das gesamte Turnier hinweg überzeugt. Herzlichen Glückwunsch zum Turniersieg! 🏆',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥈 **2. Platz • ${teams.second.clubName}**`,
    `👑 VM / Co-VM: ${teamPings(teams.second)}`,
    '',
    'Starke Leistung gezeigt und völlig verdient auf dem Podium gelandet. 👏',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `🥉 **3. Platz • ${teams.third.clubName}**`,
    `👑 VM / Co-VM: ${teamPings(teams.third)}`,
    '',
    'Ebenfalls ein starkes Turnier gespielt und sich den Platz auf dem Treppchen verdient gesichert. 👏',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '❤️ **Danke an alle Teilnehmer**',
    '',
    'Ein fettes Dankeschön an alle Teams, die beim ersten gemeinsamen **Bomber X Loco Cup** dabei waren. ❤️‍🔥',
    '',
    'Gerade an alle, die heute zum ersten Mal bei uns dabei waren: Wir hoffen, ihr konntet einen guten Einblick bekommen, wie unsere Cups ablaufen und hattet genauso viel Spaß am Abend wie wir.',
    '',
    'Wir wünschen euch allen einen geilen Start in **FC 27** und hoffen natürlich, viele von euch auch in Zukunft wiederzusehen.',
    '',
    'Und ihr wisst Bescheid:',
    '**Schön beim Bomber Cup anmelden. 💣**',
    '**Schön beim Loco Night Cup anmelden. 🐺**',
    '',
    'Auf eine geile FC-27-Zeit zusammen! 🔥',
  ].join('\n');
}

function isConfirmed(match) { return match?.status === 'confirmed'; }
function isReady(event) {
  const finalMatch = event?.knockout?.rounds?.final?.matches?.[0];
  const thirdPlaceMatch = event?.knockout?.rounds?.third_place?.matches?.[0];
  return event?.ceremony?.status === 'ready' && isConfirmed(finalMatch) && (!thirdPlaceMatch || isConfirmed(thirdPlaceMatch));
}
function readSettings() { return readJson(FILES.settings, createSettingsDefault()); }

async function ensureHallOfFameChannel(guild) {
  const settings = readSettings();
  const configuredId = settings.channels?.hallOfFameChannelId || null;
  const configured = configuredId ? await guild.channels.fetch(configuredId).catch(() => null) : null;
  if (configured?.type === ChannelType.GuildText) return configured;
  const existing = guild.channels.cache.find(channel => channel.name === baseCeremony.HALL_OF_FAME_CHANNEL_NAME && channel.type === ChannelType.GuildText);
  if (existing) return existing;
  return guild.channels.create({ name: baseCeremony.HALL_OF_FAME_CHANNEL_NAME, type: ChannelType.GuildText, reason: 'Bomber X Loco Cup Siegerehrung' });
}

function getPromotion(event, teams) {
  const promotion = event?.ceremony?.teamAchievements?.championPromotion || null;
  if (!promotion?.name) return null;
  return { ...promotion, teamName: teams.first.clubName };
}

function updateMessageRefs(eventKey, event, channelId, imageMessageId, textMessageId, timestamp) {
  updateJson(FILES.messages, createMessagesDefault(), messages => {
    messages.ceremony = messages.ceremony || {};
    messages.ceremony[eventKey] = { ...(messages.ceremony[eventKey] || {}), cycleKey: event.cycle?.cycleKey || null, channelId, imageMessageId, textMessageId, postedAt: timestamp, updatedAt: timestamp };
    messages.liveSchedule = messages.liveSchedule || {};
    messages.liveSchedule.phase = 'ceremony';
    messages.liveSchedule.currentEventKey = eventKey;
    messages.liveSchedule.updatedAt = timestamp;
    return messages;
  });
}

async function postBomberXLocoCeremony({ guild, eventKey }) {
  if (!guild) throw new Error('Siegerehrung ist nur auf dem Server nutzbar.');
  const event = readEventData(eventKey);
  if (!isBomberXLocoEvent(event)) return baseCeremony.postHallOfFameCeremony({ guild, eventKey });
  if (event?.ceremony?.status === 'posted') throw new Error('Siegerehrung wurde bereits gepostet.');
  if (!isReady(event)) throw new Error('Siegerehrung ist noch nicht bereit. Finale und Spiel um Platz 3 müssen bestätigt sein.');

  const teams = getTeams(event);
  const stats = applyTeamStatsForEvent(eventKey);
  if (stats.applied) console.log(`[team-stats] ${eventKey}: ${stats.appliedTeams.length} Teams final aktualisiert.`);
  const achievements = applyTeamAchievementsForEvent(eventKey);
  const eventWithAchievements = readEventData(eventKey);
  const promotion = getPromotion(eventWithAchievements, teams);
  const image = await renderBomberXLocoCeremonyImage({ teams, eventKey });
  const channel = await ensureHallOfFameChannel(guild);
  const timestamp = new Date().toISOString();

  const imageMessage = await channel.send({ content: '@everyone', files: [new AttachmentBuilder(image.buffer, { name: `bomber-x-loco-ceremony-${Date.now()}.png` })], allowedMentions: { parse: ['everyone'] } });
  const halloween = eventKey === 'bomber_halloween';
  const textMessage = await channel.send({ content: buildBomberXLocoCeremonyText({ teams, promotion, halloween }), allowedMentions: { parse: ['users'] } });

  let updatedEvent;
  updateEventData(eventKey, storedEvent => {
    storedEvent.ceremony = storedEvent.ceremony || {};
    storedEvent.ceremony.status = 'posted';
    storedEvent.ceremony.postedAt = timestamp;
    storedEvent.ceremony.channelId = channel.id;
    storedEvent.ceremony.imageMessageId = imageMessage.id;
    storedEvent.ceremony.textMessageId = textMessage.id;
    storedEvent.ceremony.postedMessageIds = [imageMessage.id, textMessage.id];
    storedEvent.ceremony.cleanupStatus = 'scheduled';
    storedEvent.ceremony.cleanupScheduledAt = getAutoCleanupScheduledAt(timestamp);
    storedEvent.ceremony.cleanupCompletedAt = null;
    storedEvent.meta = { ...(storedEvent.meta || {}), updatedAt: timestamp };
    updatedEvent = storedEvent;
    return storedEvent;
  });

  updateMessageRefs(eventKey, updatedEvent, channel.id, imageMessage.id, textMessage.id, timestamp);

  if (achievements.applied) {
    await refreshTeamAchievementsRankingMessage({ client: guild.client, guild, force: true }).catch(error => console.warn(`[team-achievements] Ranking konnte nicht aktualisiert werden: ${error.message}`));
    await syncChampionRolesForTeam(guild, achievements.placementTeamIds.gold).catch(error => console.warn(`[champion-roles] Gewinnerteam konnte nicht synchronisiert werden: ${error.message}`));
  }

  scheduleAutoCleanupForEvent({ eventKey, guild, scheduledAt: updatedEvent.ceremony.cleanupScheduledAt, client: guild.client });
  return { channelId: channel.id, imageMessageId: imageMessage.id, textMessageId: textMessage.id, teams, dayKey: eventKey, dayLabel: halloween ? 'Bomber X Loco Halloween Cup' : 'Bomber X Loco Cup' };
}

async function maybePostBomberXLocoCeremony({ guild, eventKey }) {
  const event = readEventData(eventKey);
  if (!isBomberXLocoEvent(event)) return baseCeremony.maybePostHallOfFameCeremony({ guild, eventKey });
  if (!guild) return { posted: false, reason: 'missing_guild' };
  if (event?.ceremony?.status === 'posted') return { posted: false, reason: 'already_posted' };
  if (!isReady(event)) return { posted: false, reason: 'not_ready' };
  const result = await postBomberXLocoCeremony({ guild, eventKey });
  return { posted: true, result };
}

module.exports = {
  BOMBER_X_LOCO_CEREMONY_LOGO_SLOTS: LOGO_SLOTS,
  buildBomberXLocoCeremonyText,
  maybePostBomberXLocoCeremony,
  postBomberXLocoCeremony,
  renderBomberXLocoCeremonyImage,
};
