'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, TEAM_LOGOS_DIR } = require('../../storage');
const {
  clearExpiredLogoUploads,
  findPendingLogoUpload,
  setTeamLogo,
} = require('./team-service');

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

function resolveTeamLogoPath(team, { optional = true } = {}) {
  if (!team?.logo?.fileName) {
    if (optional) return null;
    throw new Error(`Team ${team?.clubName || team?.id || '-'} hat kein Logo.`);
  }
  const fileName = path.basename(team.logo.fileName);
  const candidates = [
    team.logo.path && !String(team.logo.path).includes('://') ? path.resolve(ROOT_DIR, team.logo.path) : null,
    path.join(TEAM_LOGOS_DIR, fileName),
  ].filter(Boolean);
  const logoPath = candidates.find(candidate => fs.existsSync(candidate)) || null;
  if (!logoPath && !optional) throw new Error(`Logo-Datei für ${team.clubName} nicht gefunden: ${fileName}`);
  return logoPath;
}

function findExpiredUploadForMessage(expiredUploads, message) {
  const userId = String(message.author.id);
  const channelId = String(message.channel.id);
  return expiredUploads.find(upload => {
    if (String(upload.requestedByUserId) !== userId) return false;
    if (String(upload.channelId) !== channelId) return false;
    return true;
  }) || null;
}

async function saveLogoFromMessage(message, settings) {
  const now = new Date();
  const expiredUploads = clearExpiredLogoUploads(now);
  const expiredUpload = findExpiredUploadForMessage(expiredUploads, message);
  if (expiredUpload) {
    return {
      status: 'expired',
      expiredUpload,
      instructionMessageId: expiredUpload.instructionMessageId || null,
    };
  }

  const team = findPendingLogoUpload({
    userId: message.author.id,
    channelId: message.channel.id,
    now,
  });

  if (!team?.logoUpload) return { status: 'no_pending' };

  const pending = team.logoUpload;
  if (String(pending.teamId) !== String(team.id)) return { status: 'no_pending' };
  if (String(pending.requestedByUserId) !== String(message.author.id)) return { status: 'no_pending' };
  if (String(pending.channelId) !== String(message.channel.id)) return { status: 'no_pending' };

  const attachment = message.attachments.first();
  const ext = validateAttachment(attachment, settings);
  const fileName = `${team.id}.${ext}`;
  const filePath = path.join(TEAM_LOGOS_DIR, fileName);

  if (!fs.existsSync(TEAM_LOGOS_DIR)) {
    fs.mkdirSync(TEAM_LOGOS_DIR, { recursive: true });
  }

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error('Logo konnte nicht heruntergeladen werden.');

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const updatedTeam = setTeamLogo({
    teamId: team.id,
    uploadedByUserId: message.author.id,
    logo: {
      fileName,
      path: `data/teams/logos/${fileName}`,
      uploadedAt: new Date().toISOString(),
      uploadedByUserId: String(message.author.id),
    },
  });

  return {
    status: 'saved',
    team: updatedTeam,
    fileName,
    filePath,
    instructionMessageId: pending.instructionMessageId || null,
  };
}

module.exports = {
  resolveTeamLogoPath,
  saveLogoFromMessage,
};
