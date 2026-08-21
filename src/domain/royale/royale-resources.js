'use strict';

const { ChannelType } = require('discord.js');
const { FILES, readJson, updateJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { ROYALE_ROLE_KEYS } = require('../../app/constants');

const ROYALE_CHANNEL_CATEGORY_ID = '1527234632406401034';
const SATURDAY_CHECKIN_CHANNEL_ID = '1517070714941866075';

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
  await guild.roles.fetch();
  await guild.channels.fetch();

  const category = await guild.channels.fetch(ROYALE_CHANNEL_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(`Royale-Kategorie ${ROYALE_CHANNEL_CATEGORY_ID} wurde nicht gefunden.`);
  }
  const checkin = await guild.channels.fetch(SATURDAY_CHECKIN_CHANNEL_ID).catch(() => null);
  if (!checkin?.isTextBased?.()) {
    throw new Error(`Samstags-Check-in-Kanal ${SATURDAY_CHECKIN_CHANNEL_ID} wurde nicht gefunden.`);
  }

  const roleIds = {};
  for (const key of ROYALE_ROLE_KEYS) {
    const configured = settings.roles?.knockoutRoyaleRoleIds?.[key];
    let role = configured ? guild.roles.cache.get(String(configured)) : null;
    role = role || guild.roles.cache.find(item => item.name === roleName(key));
    if (!role) role = await guild.roles.create({ name: roleName(key), mentionable: false, reason: 'Knockout Royale einrichten' });
    roleIds[key] = role.id;
  }

  updateJson(FILES.settings, createSettingsDefault(), current => {
    current.categories = current.categories || {};
    current.channels = current.channels || {};
    current.roles = current.roles || {};
    current.categories.knockoutRoyaleCategoryId = ROYALE_CHANNEL_CATEGORY_ID;
    current.channels.knockoutRoyaleCheckinChannelId = SATURDAY_CHECKIN_CHANNEL_ID;
    current.roles.knockoutRoyaleRoleIds = roleIds;
    return current;
  });
  return { guild, category, checkin, roleIds };
}

module.exports = {
  ROYALE_CHANNEL_CATEGORY_ID,
  SATURDAY_CHECKIN_CHANNEL_ID,
  ensureRoyaleBaseResources,
  roleName,
};
