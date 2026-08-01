'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
const PermissionFlagsBits = {
  ViewChannel: 1,
  SendMessages: 2,
  ReadMessageHistory: 3,
  ManageChannels: 4,
  ManageMessages: 5,
  AttachFiles: 6,
  EmbedLinks: 7,
};

Module._load = function loadWithDiscordMock(request, parent, isMain) {
  if (request === 'discord.js') {
    return { ChannelType: { GuildText: 0 }, PermissionFlagsBits };
  }
  if (request.endsWith('/teams/team-service')) return { findTeamById: () => null };
  if (request === './group-roles') return { getGroupTeamIds: () => [], getTeamUserIds: () => [] };
  return originalLoad.call(this, request, parent, isMain);
};

const { ensureGroupVideoChannel } = require('../src/domain/groups/group-channels');
Module._load = originalLoad;

function createGuild() {
  const created = [];
  const guild = {
    client: { user: { id: 'bot' } },
    roles: {
      everyone: { id: 'everyone' },
      cache: new Map([['group-role', {}], ['admin-role', {}]]),
    },
    channels: {
      cache: { find: () => null },
      fetch: async () => null,
      create: async options => {
        created.push(options);
        return { id: 'video-channel', name: options.name, type: options.type };
      },
    },
  };
  return { guild, created };
}

test('creates one role-restricted greeting-video channel for a group', async () => {
  const { guild, created } = createGuild();
  const channel = await ensureGroupVideoChannel(guild, {
    roles: { adminRoleIds: ['admin-role'] },
    categories: { groupCategoryId: 'groups-category' },
  }, { groupKey: 'A', roleId: 'group-role', videoChannelId: null });

  assert.equal(channel.id, 'video-channel');
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'gruessenvideo-gruppe-a');
  assert.equal(created[0].parent, 'groups-category');
  assert.ok(created[0].permissionOverwrites.some(overwrite => overwrite.id === 'everyone'));
  assert.ok(created[0].permissionOverwrites.some(overwrite => overwrite.id === 'group-role'));
  assert.ok(created[0].permissionOverwrites.some(overwrite => overwrite.id === 'admin-role'));
  assert.equal(created[0].permissionOverwrites.some(overwrite => overwrite.id === 'individual-user'), false);
});

