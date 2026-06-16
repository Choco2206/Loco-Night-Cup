'use strict';

const fs = require('fs');
const path = require('path');
const { TEAM_LOGOS_DIR } = require('../../storage');
const { setTeamLogo } = require('./team-service');

const pendingLogoUploads = new Map();

function setPendingLogoUpload(userId, teamId, channelId) {
  pendingLogoUploads.set(String(userId), {
    teamId,
    channelId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
}

function getExtension(attachment) {
  const contentType = String(attachment.contentType || '').toLowerCase();
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';

  const cleanUrl = String(attachment.url || '').split('?')[0].toLowerCase();
  const ext = cleanUrl.split('.').pop();
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;

  return null;
}

function validateAttachment(attachment, settings) {
  if (!attachment) throw new Error('Kein Bild gefunden.');

  const ext = getExtension(attachment);
  if (!ext || !settings.teams.allowedLogoExtensions.includes(ext)) {
    throw new Error('Bitte lade ein PNG, JPG oder WEBP hoch.');
  }

  const maxBytes = settings.teams.maxLogoFileSizeMb * 1024 * 1024;
  if (attachment.size && attachment.size > maxBytes) {
    throw new Error(`Das Logo darf maximal ${settings.teams.maxLogoFileSizeMb} MB groß sein.`);
  }

  return ext;
}

async function saveLogoFromMessage(message, settings) {
  const pending = pendingLogoUploads.get(String(message.author.id));
  if (!pending) return null;

  if (pending.channelId !== message.channel.id || Date.now() > pending.expiresAt) {
    pendingLogoUploads.delete(String(message.author.id));
    return null;
  }

  const attachment = message.attachments.first();
  const ext = validateAttachment(attachment, settings);
  const fileName = `${pending.teamId}.${ext}`;
  const filePath = path.join(TEAM_LOGOS_DIR, fileName);

  if (!fs.existsSync(TEAM_LOGOS_DIR)) {
    fs.mkdirSync(TEAM_LOGOS_DIR, { recursive: true });
  }

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error('Logo konnte nicht heruntergeladen werden.');

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const team = setTeamLogo({
    teamId: pending.teamId,
    uploadedByUserId: message.author.id,
    logo: {
      fileName,
      path: `data/teams/logos/${fileName}`,
      uploadedAt: new Date().toISOString(),
      uploadedByUserId: String(message.author.id),
    },
  });

  pendingLogoUploads.delete(String(message.author.id));

  return {
    team,
    fileName,
    filePath,
  };
}

module.exports = {
  saveLogoFromMessage,
  setPendingLogoUpload,
};
