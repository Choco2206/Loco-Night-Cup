'use strict';

const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { setTeamManagerNickname } = require('../nicknames');
const { saveLogoFromMessage } = require('./team-logos');
const { refreshRegisteredTeamsOverview } = require('./team-overview');
const { MY_TEAM_PANEL_CHANNEL_ID } = require('./team-panel');
const { refreshGroupPostsForTeam } = require('../groups/group-posts');

const TEMP_MESSAGE_MS = 8000;

async function sendTemporary(channel, content) {
  const notice = await channel.send({ content }).catch(() => null);
  if (!notice) return null;

  const timeout = setTimeout(() => {
    notice.delete().catch(() => {});
  }, TEMP_MESSAGE_MS);
  if (typeof timeout.unref === 'function') timeout.unref();

  return notice;
}

async function deleteInstructionMessage(channel, messageId) {
  if (!messageId || !channel?.messages?.fetch) return;
  const instruction = await channel.messages.fetch(messageId).catch(() => null);
  if (instruction) await instruction.delete().catch(() => {});
}

async function handleMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  if (!message.attachments || message.attachments.size === 0) return false;

  const settings = readJson(FILES.settings, createSettingsDefault());
  const logoUploadChannelIds = new Set([
    settings.channels.teamRegistrationChannelId,
    MY_TEAM_PANEL_CHANNEL_ID,
  ].filter(Boolean).map(String));
  if (!logoUploadChannelIds.has(String(message.channel.id))) return false;

  try {
    const result = await saveLogoFromMessage(message, settings);

    if (result.status === 'no_pending') {
      await sendTemporary(
        message.channel,
        'Kein offener Logo-Upload gefunden. Bitte registriere zuerst dein Team oder oeffne "Mein Team" -> Logo aendern.'
      );
      return true;
    }

    if (result.status === 'expired') {
      await deleteInstructionMessage(message.channel, result.instructionMessageId);
      await sendTemporary(
        message.channel,
        'Der offene Logo-Upload ist abgelaufen. Bitte oeffne "Mein Team" -> Logo aendern erneut.'
      );
      return true;
    }

    if (result.status !== 'saved') return false;

    if (result.team?.manager?.userId) {
      await setTeamManagerNickname(message.guild, result.team.manager.userId, result.team).catch(() => null);
    }

    await refreshRegisteredTeamsOverview(client);
    await refreshGroupPostsForTeam(client, result.team.id).catch(error => {
      console.warn(`[group-schedule] Gruppen konnten nach Logoaenderung nicht aktualisiert werden: ${error.message}`);
    });
    await deleteInstructionMessage(message.channel, result.instructionMessageId);
    await message.delete().catch(() => {});
    await sendTemporary(
      message.channel,
      `Logo fuer **${result.team.clubName}** wurde gespeichert. Die Registrierung ist jetzt vollstaendig.`
    );

    return true;
  } catch (error) {
    await sendTemporary(message.channel, `Fehler: ${error.message}`);
    return true;
  }
}

module.exports = {
  handleMessage,
};
