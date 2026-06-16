'use strict';

function requireGuild(interaction) {
  if (!interaction.guild || !interaction.member) {
    throw new Error('Diese Aktion funktioniert nur auf einem Server.');
  }
}

function requireConfiguredChannel(settings, key) {
  const channelId = settings.channels[key];
  if (!channelId) throw new Error(`settings.channels.${key} ist nicht gesetzt.`);
  return channelId;
}

function ensureUserIsNotBot(user) {
  if (!user || user.bot) throw new Error('Bots können keine Teamrolle übernehmen.');
}

module.exports = {
  ensureUserIsNotBot,
  requireConfiguredChannel,
  requireGuild,
};
