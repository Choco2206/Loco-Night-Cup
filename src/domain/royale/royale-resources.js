'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { ROYALE_ROLE_KEYS } = require('../../app/constants');

function titlePart(key) {
  if (key === 'grand_final') return 'Grand Finale';
  if (key === 'grand_final_reset') return 'Grand Finale Reset';
  const [path, type, number] = key.split('_');
  const pathLabel = path === 'kings' ? 'König' : 'Schatten';
  return type === 'final' ? `${pathLabel} Finale` : `${pathLabel} Runde ${number}`;
}

function roleName(key) { return `LKR ${titlePart(key)}`; }

async function ensureRoyaleBaseResources(client) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const guildId = settings.guild?.guildId;
  const guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : client.guilds.cache.first();
  if (!guild) throw new Error('Discord-Server für die Knockout Royale wurde nicht gefunden.');
  await guild.roles.fetch(); await guild.channels.fetch();

  const categoryName = '🐺 LOCO KNOCKOUT ROYALE';
  let category = settings.categories?.knockoutRoyaleCategoryId
    ? await guild.channels.fetch(settings.categories.knockoutRoyaleCategoryId).catch(() => null)
    : null;
  category = category || guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === categoryName);
  if (!category) category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, reason: 'Knockout Royale einrichten' });

  const roleIds = {};
  for (const key of ROYALE_ROLE_KEYS) {
    const configured = settings.roles?.knockoutRoyaleRoleIds?.[key];
    let role = configured ? guild.roles.cache.get(String(configured)) : null;
    role = role || guild.roles.cache.find(item => item.name === roleName(key));
    if (!role) role = await guild.roles.create({ name: roleName(key), mentionable: false, reason: 'Knockout Royale einrichten' });
    roleIds[key] = role.id;
  }

  const checkinName = '🐺│knockout-royale-check-in';
  let checkin = settings.channels?.knockoutRoyaleCheckinChannelId
    ? await guild.channels.fetch(settings.channels.knockoutRoyaleCheckinChannelId).catch(() => null)
    : null;
  checkin = checkin || guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === checkinName);
  if (!checkin) {
    checkin = await guild.channels.create({
      name: checkinName, type: ChannelType.GuildText, parent: category.id,
      permissionOverwrites: [{
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages],
      }],
      reason: 'Knockout Royale Check-in einrichten',
    });
  } else if (checkin.parentId !== category.id) await checkin.setParent(category.id, { lockPermissions: false }).catch(() => null);

  updateJson(FILES.settings, createSettingsDefault(), current => {
    current.categories = current.categories || {}; current.channels = current.channels || {}; current.roles = current.roles || {};
    current.categories.knockoutRoyaleCategoryId = category.id;
    current.channels.knockoutRoyaleCheckinChannelId = checkin.id;
    current.roles.knockoutRoyaleRoleIds = roleIds;
    return current;
  });
  return { guild, category, checkin, roleIds };
}

module.exports = { ensureRoyaleBaseResources, roleName };
