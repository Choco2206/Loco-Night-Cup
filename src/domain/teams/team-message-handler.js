'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { saveLogoFromMessage } = require('./team-logos');
const { refreshRegisteredTeamsOverview } = require('./team-overview');

async function handleMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  if (!message.attachments || message.attachments.size === 0) return false;

  const settings = readJson(FILES.settings, createSettingsDefault());
  if (!settings.channels.teamRegistrationChannelId) return false;
  if (message.channel.id !== settings.channels.teamRegistrationChannelId) return false;

  try {
    const result = await saveLogoFromMessage(message, settings);
    if (!result) return false;

    await refreshRegisteredTeamsOverview(client);

    await message.delete().catch(() => {});
    const confirmation = await message.channel.send({
      content: `Logo für **${result.team.clubName}** wurde gespeichert. Die Registrierung ist jetzt vollständig.`,
    });

    setTimeout(() => {
      confirmation.delete().catch(() => {});
    }, 8000);

    return true;
  } catch (error) {
    await message.reply(`Fehler: ${error.message}`).catch(() => {});
    return true;
  }
}

module.exports = {
  handleMessage,
};
