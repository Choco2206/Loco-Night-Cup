'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { EVENT_KEYS, EVENT_LABELS, GROUP_KEYS, KNOCKOUT_ROUNDS } = require('../../app/constants');

const CATEGORY_DEFINITIONS = [
  { keys: ['welcomeCategoryId'], name: '👋 WELCOME', mode: 'readOnlyPublic' },
  { keys: ['systemCategoryId'], name: '⚙️ SYSTEM', mode: 'staffOnly' },
  { keys: ['accessCategoryId'], name: '🎭 ZUGANG', mode: 'readOnlyPublic' },
  { keys: ['nightHubCategoryId'], name: '🌙 NIGHT HUB', mode: 'readOnlyPublic' },
  { keys: ['managerCategoryId'], name: '👔 MANAGER BEREICH', mode: 'managerOnly' },
  { keys: ['publicScheduleCategoryId'], name: '📊 ÖFFENTLICHER SPIELPLAN', mode: 'readOnlyPublic' },
  { keys: ['nightEventsCategoryId', 'checkinCategoryId'], name: '🎮 NIGHT EVENTS', mode: 'readOnlyPublic' },
  { keys: ['searchCategoryId'], name: '🔍 AUSHILFEN & TEAMSUCHE', mode: 'publicInteractive' },
  { keys: ['groupsCategoryId', 'groupCategoryId'], name: '🏟️ GRUPPENPHASE', mode: 'staffOnly' },
  { keys: ['knockoutCategoryId'], name: '🏆 K.O.-PHASE', mode: 'staffOnly' },
];

const CHANNEL_DEFINITIONS = [
  { key: 'welcomeChannelId', name: '👋│willkommen', categoryKey: 'welcomeCategoryId', mode: 'readOnlyPublic' },
  { key: 'rulebookChannelId', name: '📜│regelwerk', categoryKey: 'welcomeCategoryId', mode: 'readOnlyPublic' },
  { key: 'adminPanelChannelId', name: '🤖│bot-steuerung', categoryKey: 'systemCategoryId', mode: 'staffOnly' },
  { key: 'logChannelId', name: '📋│logs', categoryKey: 'systemCategoryId', mode: 'staffOnly' },
  { key: 'roleSelectChannelId', name: '🎭│rolle-wählen', categoryKey: 'accessCategoryId', mode: 'readOnlyPublic' },
  { key: 'announcementChannelId', name: '📢│ankündigungen', categoryKey: 'nightHubCategoryId', mode: 'readOnlyPublic' },
  { key: 'chatChannelId', name: '💬│chat', categoryKey: 'nightHubCategoryId', mode: 'publicInteractive' },
  { key: 'hallOfFameChannelId', name: '🏆│hall-of-fame', categoryKey: 'nightHubCategoryId', mode: 'readOnlyPublic' },
  { key: 'registeredTeamsChannelId', name: '📋│registrierte-teams', categoryKey: 'nightHubCategoryId', mode: 'readOnlyPublic' },
  { key: 'rulesChannelId', name: '📖│regeln', categoryKey: 'nightHubCategoryId', mode: 'readOnlyPublic' },
  { key: 'cooperationChannelId', name: '🤝│kooperationen', categoryKey: 'nightHubCategoryId', mode: 'readOnlyPublic' },
  { key: 'feedbackChannelId', name: '💡│feedback', categoryKey: 'nightHubCategoryId', mode: 'managerOnly' },
  { key: 'banlistChannelId', name: '🚫│sperrliste', categoryKey: 'nightHubCategoryId', mode: 'readOnlyPublic' },
  { key: 'teamRegistrationChannelId', name: '📝│team-registrieren', categoryKey: 'managerCategoryId', mode: 'managerOnly' },
  { key: 'managerSupportChannelId', name: '🆘│manager-support', categoryKey: 'managerCategoryId', mode: 'managerOnly' },
  { key: 'liveScheduleChannelId', name: '📈│live-spielplan', categoryKey: 'publicScheduleCategoryId', mode: 'readOnlyPublic' },
  { key: 'teamSearchChannelId', name: '🔎│team-sucht-spieler', categoryKey: 'searchCategoryId', mode: 'publicInteractive' },
  { key: 'playerSearchChannelId', name: '👤│spieler-sucht-team', categoryKey: 'searchCategoryId', mode: 'publicInteractive' },
  { key: 'helperSearchChannelId', name: '🤝│aushilfe-gesucht', categoryKey: 'searchCategoryId', mode: 'publicInteractive' },
  { key: 'helperAvailableChannelId', name: '✅│aushilfe-verfügbar', categoryKey: 'searchCategoryId', mode: 'publicInteractive' },
];

const CHECKIN_CHANNEL_NAMES = {
  monday: '🌙│montag-check-in',
  tuesday: '🌙│dienstag-check-in',
  wednesday: '🌙│mittwoch-check-in',
  thursday: '🌙│donnerstag-check-in',
  friday: '🌙│freitag-check-in',
  saturday: '🌙│samstag-check-in',
  sunday: '🌙│sonntag-check-in',
};

const KNOCKOUT_ROLE_NAMES = {
  round_of_16: 'LNC K.O. Achtelfinale',
  quarter_final: 'LNC K.O. Viertelfinale',
  semi_final: 'LNC K.O. Halbfinale',
  third_place: 'LNC K.O. Spiel um Platz 3',
  final: 'LNC K.O. Finale',
};

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function groupRoleName(groupKey) {
  return `LNC Gruppe ${groupKey}`;
}

function getRoleById(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(String(roleId)) || null;
}

function findRoleByName(guild, name) {
  return guild.roles.cache.find(role => role.name === name) || null;
}

async function ensureRole({ guild, configuredIds = [], name, reason, result }) {
  const configured = uniq(configuredIds)
    .map(roleId => getRoleById(guild, roleId))
    .find(Boolean);

  if (configured) {
    result.roles.reused.push({ name: configured.name, id: configured.id });
    return configured;
  }

  const existing = findRoleByName(guild, name);
  if (existing) {
    result.roles.reused.push({ name: existing.name, id: existing.id });
    return existing;
  }

  const role = await guild.roles.create({
    name,
    mentionable: false,
    reason,
  });
  result.roles.created.push({ name: role.name, id: role.id });
  return role;
}

function rolePermissionTargets(context) {
  return {
    staff: uniq([...context.adminRoleIds, ...context.cupLeadRoleIds]),
    managers: uniq([context.managerRoleId, context.coManagerRoleId]),
  };
}

function overwritesForMode(guild, mode, context) {
  const staffAllow = {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    ManageMessages: true,
    AttachFiles: true,
    EmbedLinks: true,
  };
  const publicRead = {
    ViewChannel: true,
    SendMessages: false,
    ReadMessageHistory: true,
  };
  const publicWrite = {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
  };
  const managerWrite = {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
  };
  const { staff, managers } = rolePermissionTargets(context);
  const overwrites = [];

  if (mode === 'staffOnly') {
    overwrites.push({ id: guild.roles.everyone.id, permissions: { ViewChannel: false } });
  } else if (mode === 'managerOnly') {
    overwrites.push({ id: guild.roles.everyone.id, permissions: { ViewChannel: false } });
    overwrites.push(...managers.map(roleId => ({ id: roleId, permissions: managerWrite })));
  } else if (mode === 'publicInteractive') {
    overwrites.push({ id: guild.roles.everyone.id, permissions: publicWrite });
  } else {
    overwrites.push({ id: guild.roles.everyone.id, permissions: publicRead });
  }

  overwrites.push(...staff.map(roleId => ({ id: roleId, permissions: staffAllow })));
  overwrites.push({ id: guild.client.user.id, permissions: staffAllow });

  return overwrites;
}

async function applyPermissionOverwrites(target, { guild, mode, context }) {
  for (const overwrite of overwritesForMode(guild, mode, context)) {
    await target.permissionOverwrites.edit(overwrite.id, overwrite.permissions, {
      reason: 'Loco Night Cup Serverstruktur einrichten',
    }).catch(() => null);
  }
}

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.fetch(String(channelId)).catch(() => null);
}

function findChannelByName(guild, name, type) {
  return guild.channels.cache.find(channel => channel.name === name && channel.type === type) || null;
}

async function fetchConfiguredCategory(guild, settings, keys) {
  for (const key of keys) {
    const configured = await fetchChannel(guild, settings.categories?.[key]);
    if (configured?.type === ChannelType.GuildCategory) return configured;
  }
  return null;
}

async function ensureCategory({ guild, settings, definition, context, result }) {
  const configured = await fetchConfiguredCategory(guild, settings, definition.keys);
  const existing = configured || findChannelByName(guild, definition.name, ChannelType.GuildCategory);

  if (existing) {
    result.categories.reused.push({ name: existing.name, id: existing.id });
    await applyPermissionOverwrites(existing, { guild, mode: definition.mode, context });
    return existing;
  }

  const category = await guild.channels.create({
    name: definition.name,
    type: ChannelType.GuildCategory,
    reason: 'Loco Night Cup Serverstruktur einrichten',
  });
  result.categories.created.push({ name: category.name, id: category.id });
  await applyPermissionOverwrites(category, { guild, mode: definition.mode, context });
  return category;
}

async function ensureTextChannel({ guild, configuredId, name, parentId, mode, context, result }) {
  const configured = await fetchChannel(guild, configuredId);
  const existing = configured?.type === ChannelType.GuildText
    ? configured
    : findChannelByName(guild, name, ChannelType.GuildText);

  if (existing) {
    result.channels.reused.push({ name: existing.name, id: existing.id });
    if (parentId && existing.parentId !== parentId) {
      await existing.setParent(parentId, {
        lockPermissions: false,
        reason: 'Loco Night Cup Serverstruktur einrichten',
      }).catch(() => null);
    }
    await applyPermissionOverwrites(existing, { guild, mode, context });
    return existing;
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: mode === 'staffOnly' || mode === 'managerOnly' ? [PermissionFlagsBits.ViewChannel] : [],
        allow: mode !== 'staffOnly' && mode !== 'managerOnly' ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] : [],
      },
    ],
    reason: 'Loco Night Cup Serverstruktur einrichten',
  });
  result.channels.created.push({ name: channel.name, id: channel.id });
  await applyPermissionOverwrites(channel, { guild, mode, context });
  return channel;
}

async function assignActorAdminRole({ guild, actorUserId, role, result }) {
  if (!actorUserId || !role) return;
  const member = await guild.members.fetch(String(actorUserId)).catch(() => null);
  if (!member || member.roles.cache.has(role.id)) return;

  await member.roles.add(role, 'Loco Night Cup Serverstruktur einrichten').then(() => {
    result.roles.assigned.push({ name: role.name, id: role.id, userId: String(actorUserId) });
  }).catch(() => null);
}

function ensureSettingsShape(settings) {
  settings.guild = settings.guild || {};
  settings.roles = settings.roles || {};
  settings.roles.groupRoleIds = settings.roles.groupRoleIds || {};
  settings.roles.knockoutRoleIds = settings.roles.knockoutRoleIds || {};
  settings.channels = settings.channels || {};
  settings.channels.checkinChannelIds = settings.channels.checkinChannelIds || {};
  settings.channels.groupChannelIds = settings.channels.groupChannelIds || {};
  settings.channels.knockoutChannelIds = settings.channels.knockoutChannelIds || {};
  settings.categories = settings.categories || {};
  settings.permissions = settings.permissions || {};
  return settings;
}

async function ensureServerStructure({ guild, actorUserId }) {
  if (!guild) throw new Error('Serverstruktur kann nur auf einem Discord-Server eingerichtet werden.');

  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const settings = ensureSettingsShape(readSettings());
  const result = {
    roles: { created: [], reused: [], assigned: [] },
    categories: { created: [], reused: [] },
    channels: { created: [], reused: [] },
    settings: { updated: [] },
  };

  const adminRole = await ensureRole({
    guild,
    configuredIds: [...(settings.roles.adminRoleIds || []), ...(settings.permissions?.adminRoleIds || [])],
    name: 'LNC Admin',
    reason: 'Loco Night Cup Serverstruktur einrichten',
    result,
  });
  const cupLeadRole = await ensureRole({
    guild,
    configuredIds: [...(settings.roles.cupLeadRoleIds || []), ...(settings.permissions?.cupLeadRoleIds || [])],
    name: 'LNC Turnierleitung',
    reason: 'Loco Night Cup Serverstruktur einrichten',
    result,
  });
  const playerRole = await ensureRole({
    guild,
    configuredIds: [settings.roles.playerRoleId],
    name: 'LNC Spieler',
    reason: 'Loco Night Cup Serverstruktur einrichten',
    result,
  });
  const managerRole = await ensureRole({
    guild,
    configuredIds: [settings.roles.managerRoleId],
    name: 'LNC Manager',
    reason: 'Loco Night Cup Serverstruktur einrichten',
    result,
  });
  const coManagerRole = await ensureRole({
    guild,
    configuredIds: [settings.roles.coManagerRoleId],
    name: 'LNC Co-Manager',
    reason: 'Loco Night Cup Serverstruktur einrichten',
    result,
  });

  await assignActorAdminRole({ guild, actorUserId, role: adminRole, result });

  const groupRoles = {};
  for (const groupKey of GROUP_KEYS) {
    groupRoles[groupKey] = await ensureRole({
      guild,
      configuredIds: [settings.roles.groupRoleIds[groupKey]],
      name: groupRoleName(groupKey),
      reason: 'Loco Night Cup Serverstruktur einrichten',
      result,
    });
  }

  const knockoutRoles = {};
  for (const roundKey of KNOCKOUT_ROUNDS) {
    knockoutRoles[roundKey] = await ensureRole({
      guild,
      configuredIds: [settings.roles.knockoutRoleIds[roundKey]],
      name: KNOCKOUT_ROLE_NAMES[roundKey],
      reason: 'Loco Night Cup Serverstruktur einrichten',
      result,
    });
  }

  const context = {
    adminRoleIds: [adminRole.id],
    cupLeadRoleIds: [cupLeadRole.id],
    managerRoleId: managerRole.id,
    coManagerRoleId: coManagerRole.id,
  };

  const categories = {};
  for (const definition of CATEGORY_DEFINITIONS) {
    const category = await ensureCategory({ guild, settings, definition, context, result });
    for (const key of definition.keys) categories[key] = category;
  }

  const coreChannels = {};
  for (const definition of CHANNEL_DEFINITIONS) {
    coreChannels[definition.key] = await ensureTextChannel({
      guild,
      configuredId: settings.channels[definition.key],
      name: definition.name,
      parentId: categories[definition.categoryKey]?.id || null,
      mode: definition.mode,
      context,
      result,
    });
  }

  const checkinChannels = {};
  for (const eventKey of EVENT_KEYS) {
    checkinChannels[eventKey] = await ensureTextChannel({
      guild,
      configuredId: settings.channels.checkinChannelIds[eventKey],
      name: CHECKIN_CHANNEL_NAMES[eventKey],
      parentId: categories.nightEventsCategoryId?.id || null,
      mode: 'readOnlyPublic',
      context,
      result,
    });
  }

  updateJson(FILES.settings, createSettingsDefault(), current => {
    const next = ensureSettingsShape(current);
    next.guild.guildId = guild.id;
    next.roles.adminRoleIds = context.adminRoleIds;
    next.roles.cupLeadRoleIds = context.cupLeadRoleIds;
    next.permissions.adminRoleIds = context.adminRoleIds;
    next.permissions.cupLeadRoleIds = context.cupLeadRoleIds;
    next.roles.playerRoleId = playerRole.id;
    next.roles.managerRoleId = managerRole.id;
    next.roles.coManagerRoleId = coManagerRole.id;
    for (const groupKey of GROUP_KEYS) next.roles.groupRoleIds[groupKey] = groupRoles[groupKey].id;
    for (const roundKey of KNOCKOUT_ROUNDS) next.roles.knockoutRoleIds[roundKey] = knockoutRoles[roundKey].id;
    for (const definition of CATEGORY_DEFINITIONS) {
      for (const key of definition.keys) next.categories[key] = categories[key].id;
    }
    for (const definition of CHANNEL_DEFINITIONS) next.channels[definition.key] = coreChannels[definition.key].id;
    for (const eventKey of EVENT_KEYS) next.channels.checkinChannelIds[eventKey] = checkinChannels[eventKey].id;
    next.meta = { ...(next.meta || {}), updatedAt: new Date().toISOString() };
    return next;
  });
  result.settings.updated = [
    'guild.guildId',
    'roles.adminRoleIds',
    'roles.cupLeadRoleIds',
    'roles.playerRoleId',
    'roles.managerRoleId',
    'roles.coManagerRoleId',
    'roles.groupRoleIds',
    'roles.knockoutRoleIds',
    'permissions.adminRoleIds',
    'permissions.cupLeadRoleIds',
    'categories.*',
    'channels.*',
    'channels.checkinChannelIds',
    'channels.hallOfFameChannelId',
  ];

  return {
    ...result,
    expected: {
      roles: [
        'LNC Admin',
        'LNC Turnierleitung',
        'LNC Spieler',
        'LNC Manager',
        'LNC Co-Manager',
        ...GROUP_KEYS.map(groupRoleName),
        ...KNOCKOUT_ROUNDS.map(roundKey => KNOCKOUT_ROLE_NAMES[roundKey]),
      ],
      categories: CATEGORY_DEFINITIONS.map(definition => definition.name),
      channels: [
        ...CHANNEL_DEFINITIONS.map(definition => definition.name),
        ...EVENT_KEYS.map(eventKey => `${EVENT_LABELS[eventKey]}: ${CHECKIN_CHANNEL_NAMES[eventKey]}`),
      ],
    },
  };
}

module.exports = {
  ensureServerStructure,
};
