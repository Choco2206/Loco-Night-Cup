'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { EVENT_KEYS, EVENT_LABELS, GROUP_KEYS, KNOCKOUT_ROUNDS } = require('../../app/constants');

const CATEGORY_DEFINITIONS = [
  { key: 'checkinCategoryId', name: '📅 Check-ins', mode: 'public' },
  { key: 'groupCategoryId', name: '🏟️ Gruppenphase', mode: 'private' },
  { key: 'knockoutCategoryId', name: '🏆 K.O.-Phase', mode: 'private' },
  { key: 'archiveCategoryId', name: '📦 Archiv', mode: 'admin' },
];

const CORE_CHANNEL_DEFINITIONS = [
  { key: 'welcomeChannelId', name: '📢-ankuendigungen', mode: 'publicInfo' },
  { key: 'roleSelectChannelId', name: '✅-rollen', mode: 'publicInfo' },
  { key: 'teamRegistrationChannelId', name: '📝-teamregistrierung', mode: 'publicInteractive' },
  { key: 'registeredTeamsChannelId', name: '📋-registrierte-teams', mode: 'publicInfo' },
  { key: 'rulesChannelId', name: '📜-regeln', mode: 'publicInfo' },
  { key: 'banlistChannelId', name: '🚫-sperren', mode: 'publicInfo' },
  { key: 'adminPanelChannelId', name: '🛠-admin-panel', mode: 'admin' },
  { key: 'announcementChannelId', name: '📣-turnier-news', mode: 'publicInfo' },
  { key: 'liveScheduleChannelId', name: '📊-live-spielplan', mode: 'publicInfo' },
  { key: 'teamSearchChannelId', name: '🔎-teamsuche', mode: 'publicInteractive' },
  { key: 'helperSearchChannelId', name: '🆘-helfer-suche', mode: 'publicInteractive' },
  { key: 'hallOfFameChannelId', name: '👑-hall-of-fame', mode: 'publicInfo' },
];

const CHECKIN_CHANNEL_NAMES = {
  monday: '✅-montag',
  tuesday: '✅-dienstag',
  wednesday: '✅-mittwoch',
  thursday: '✅-donnerstag',
  friday: '✅-freitag',
  saturday: '✅-samstag',
  sunday: '✅-sonntag',
};

const KNOCKOUT_CHANNEL_NAMES = {
  round_of_16: 'ko-achtelfinale',
  quarter_final: 'ko-viertelfinale',
  semi_final: 'ko-halbfinale',
  third_place: 'ko-platz-3',
  final: 'ko-finale',
};

const KNOCKOUT_ROLE_NAMES = {
  round_of_16: 'LNC K.O. Achtelfinale',
  quarter_final: 'LNC K.O. Viertelfinale',
  semi_final: 'LNC K.O. Halbfinale',
  third_place: 'LNC K.O. Platz 3',
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

function groupChannelName(groupKey) {
  return `gruppe-${String(groupKey).toLowerCase()}`;
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

function overwriteValue(mode, roleIds = []) {
  const baseAllow = {
    ViewChannel: true,
    ReadMessageHistory: true,
  };
  const staffAllow = {
    ...baseAllow,
    SendMessages: true,
    ManageMessages: true,
    AttachFiles: true,
    EmbedLinks: true,
  };
  const interactiveAllow = {
    ...baseAllow,
    SendMessages: true,
    AttachFiles: true,
    EmbedLinks: true,
  };

  if (mode === 'admin' || mode === 'private') {
    return {
      everyone: { ViewChannel: false },
      staff: staffAllow,
      bot: staffAllow,
      extraRoles: roleIds.map(roleId => ({ id: roleId, permissions: baseAllow })),
    };
  }

  if (mode === 'publicInteractive') {
    return {
      everyone: interactiveAllow,
      staff: staffAllow,
      bot: staffAllow,
      extraRoles: [],
    };
  }

  return {
    everyone: { ...baseAllow, SendMessages: false },
    staff: staffAllow,
    bot: staffAllow,
    extraRoles: [],
  };
}

async function applyPermissionOverwrites(target, { guild, mode, adminRoleIds, cupLeadRoleIds, extraRoleIds = [] }) {
  const permissions = overwriteValue(mode, extraRoleIds);
  const staffRoleIds = uniq([...adminRoleIds, ...cupLeadRoleIds]);
  const overwrites = [
    { id: guild.roles.everyone.id, permissions: permissions.everyone },
    ...staffRoleIds.map(roleId => ({ id: roleId, permissions: permissions.staff })),
    { id: guild.client.user.id, permissions: permissions.bot },
    ...permissions.extraRoles,
  ];

  for (const overwrite of overwrites) {
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

async function ensureCategory({ guild, settings, definition, adminRoleIds, cupLeadRoleIds, result }) {
  const configured = await fetchChannel(guild, settings.categories?.[definition.key]);
  const existing = configured?.type === ChannelType.GuildCategory
    ? configured
    : findChannelByName(guild, definition.name, ChannelType.GuildCategory);

  if (existing) {
    result.categories.reused.push({ name: existing.name, id: existing.id });
    await applyPermissionOverwrites(existing, {
      guild,
      mode: definition.mode === 'public' ? 'publicInfo' : definition.mode,
      adminRoleIds,
      cupLeadRoleIds,
    });
    return existing;
  }

  const category = await guild.channels.create({
    name: definition.name,
    type: ChannelType.GuildCategory,
    reason: 'Loco Night Cup Serverstruktur einrichten',
  });
  result.categories.created.push({ name: category.name, id: category.id });
  await applyPermissionOverwrites(category, {
    guild,
    mode: definition.mode === 'public' ? 'publicInfo' : definition.mode,
    adminRoleIds,
    cupLeadRoleIds,
  });
  return category;
}

async function ensureTextChannel({ guild, configuredId, name, parentId, mode, adminRoleIds, cupLeadRoleIds, extraRoleIds = [], result }) {
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
    await applyPermissionOverwrites(existing, { guild, mode, adminRoleIds, cupLeadRoleIds, extraRoleIds });
    return existing;
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: mode === 'admin' || mode === 'private' ? [PermissionFlagsBits.ViewChannel] : [],
        allow: mode !== 'admin' && mode !== 'private' ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] : [],
      },
    ],
    reason: 'Loco Night Cup Serverstruktur einrichten',
  });
  result.channels.created.push({ name: channel.name, id: channel.id });
  await applyPermissionOverwrites(channel, { guild, mode, adminRoleIds, cupLeadRoleIds, extraRoleIds });
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

  const adminRoleIds = [adminRole.id];
  const cupLeadRoleIds = [cupLeadRole.id];
  const categories = {};
  for (const definition of CATEGORY_DEFINITIONS) {
    categories[definition.key] = await ensureCategory({
      guild,
      settings,
      definition,
      adminRoleIds,
      cupLeadRoleIds,
      result,
    });
  }

  const coreChannels = {};
  for (const definition of CORE_CHANNEL_DEFINITIONS) {
    coreChannels[definition.key] = await ensureTextChannel({
      guild,
      configuredId: settings.channels[definition.key],
      name: definition.name,
      parentId: null,
      mode: definition.mode,
      adminRoleIds,
      cupLeadRoleIds,
      result,
    });
  }

  const checkinChannels = {};
  for (const eventKey of EVENT_KEYS) {
    checkinChannels[eventKey] = await ensureTextChannel({
      guild,
      configuredId: settings.channels.checkinChannelIds[eventKey],
      name: CHECKIN_CHANNEL_NAMES[eventKey] || `check-in-${eventKey}`,
      parentId: categories.checkinCategoryId?.id,
      mode: 'publicInfo',
      adminRoleIds,
      cupLeadRoleIds,
      result,
    });
  }

  const groupChannels = {};
  for (const groupKey of GROUP_KEYS) {
    groupChannels[groupKey] = await ensureTextChannel({
      guild,
      configuredId: settings.channels.groupChannelIds[groupKey],
      name: groupChannelName(groupKey),
      parentId: categories.groupCategoryId?.id,
      mode: 'private',
      adminRoleIds,
      cupLeadRoleIds,
      extraRoleIds: [groupRoles[groupKey].id],
      result,
    });
  }

  const knockoutChannels = {};
  const overviewChannel = await ensureTextChannel({
    guild,
    configuredId: settings.channels.knockoutOverviewChannelId,
    name: 'ko-phase',
    parentId: categories.knockoutCategoryId?.id,
    mode: 'admin',
    adminRoleIds,
    cupLeadRoleIds,
    result,
  });
  for (const roundKey of KNOCKOUT_ROUNDS) {
    knockoutChannels[roundKey] = await ensureTextChannel({
      guild,
      configuredId: settings.channels.knockoutChannelIds[roundKey],
      name: KNOCKOUT_CHANNEL_NAMES[roundKey],
      parentId: categories.knockoutCategoryId?.id,
      mode: 'private',
      adminRoleIds,
      cupLeadRoleIds,
      extraRoleIds: [knockoutRoles[roundKey].id],
      result,
    });
  }

  updateJson(FILES.settings, createSettingsDefault(), current => {
    const next = ensureSettingsShape(current);
    next.guild.guildId = guild.id;
    next.roles.adminRoleIds = adminRoleIds;
    next.roles.cupLeadRoleIds = cupLeadRoleIds;
    next.permissions.adminRoleIds = adminRoleIds;
    next.permissions.cupLeadRoleIds = cupLeadRoleIds;
    next.roles.playerRoleId = playerRole.id;
    next.roles.managerRoleId = managerRole.id;
    for (const groupKey of GROUP_KEYS) next.roles.groupRoleIds[groupKey] = groupRoles[groupKey].id;
    for (const roundKey of KNOCKOUT_ROUNDS) next.roles.knockoutRoleIds[roundKey] = knockoutRoles[roundKey].id;
    for (const definition of CATEGORY_DEFINITIONS) next.categories[definition.key] = categories[definition.key].id;
    for (const definition of CORE_CHANNEL_DEFINITIONS) next.channels[definition.key] = coreChannels[definition.key].id;
    for (const eventKey of EVENT_KEYS) next.channels.checkinChannelIds[eventKey] = checkinChannels[eventKey].id;
    for (const groupKey of GROUP_KEYS) next.channels.groupChannelIds[groupKey] = groupChannels[groupKey].id;
    for (const roundKey of KNOCKOUT_ROUNDS) next.channels.knockoutChannelIds[roundKey] = knockoutChannels[roundKey].id;
    next.channels.knockoutOverviewChannelId = overviewChannel.id;
    next.meta = { ...(next.meta || {}), updatedAt: new Date().toISOString() };
    return next;
  });
  result.settings.updated = [
    'guild.guildId',
    'roles.adminRoleIds',
    'roles.cupLeadRoleIds',
    'roles.playerRoleId',
    'roles.managerRoleId',
    'roles.groupRoleIds',
    'roles.knockoutRoleIds',
    'permissions.adminRoleIds',
    'permissions.cupLeadRoleIds',
    'categories.*',
    'channels.*',
    'channels.checkinChannelIds',
    'channels.groupChannelIds',
    'channels.knockoutChannelIds',
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
        ...GROUP_KEYS.map(groupRoleName),
        ...KNOCKOUT_ROUNDS.map(roundKey => KNOCKOUT_ROLE_NAMES[roundKey]),
      ],
      categories: CATEGORY_DEFINITIONS.map(definition => definition.name),
      channels: [
        ...CORE_CHANNEL_DEFINITIONS.map(definition => definition.name),
        ...EVENT_KEYS.map(eventKey => `${EVENT_LABELS[eventKey]}: ${CHECKIN_CHANNEL_NAMES[eventKey]}`),
        ...GROUP_KEYS.map(groupChannelName),
        'ko-phase',
        ...KNOCKOUT_ROUNDS.map(roundKey => KNOCKOUT_CHANNEL_NAMES[roundKey]),
      ],
    },
  };
}

module.exports = {
  ensureServerStructure,
};
