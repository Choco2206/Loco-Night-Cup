'use strict';

const { EVENT_KEYS } = require('../../app/constants');
const { checkInTeam, withdrawTeam } = require('./checkin-service');
const { refreshCheckinMessage, refreshCheckinMessages } = require('./checkin-panel');

const EPHEMERAL = 64;

function parseCheckinButton(customId) {
  if (!customId || typeof customId !== 'string') return null;
  const [action, eventKey] = customId.split(':');
  if (!['checkin_join', 'checkin_leave'].includes(action)) return null;
  if (!EVENT_KEYS.includes(eventKey)) return null;
  return { action, eventKey };
}

async function handleJoin(interaction, client, eventKey) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const result = checkInTeam({ eventKey, userId: interaction.user.id });
  await refreshCheckinMessage(eventKey, client);

  if (result.alreadyCheckedIn) {
    await interaction.editReply('Dein Team ist fuer dieses Event bereits eingecheckt. Es wurde kein Duplikat erzeugt.');
    return true;
  }

  await interaction.editReply(`${result.team.clubName} wurde eingecheckt.`);
  return true;
}

async function handleLeave(interaction, client, eventKey) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const result = withdrawTeam({ eventKey, userId: interaction.user.id });

  if (!result.wasCheckedIn) {
    await refreshCheckinMessage(eventKey, client);
    await interaction.editReply('Dein Team war fuer dieses Event nicht eingecheckt.');
    return true;
  }

  if (result.lateWithdrawal) {
    await refreshCheckinMessages(result.affectedEventKeys, client);
    await interaction.editReply('Abmeldung nach Deadline: Es wurde eine 7-Tage-Sperre erstellt und das Team aus allen Check-ins entfernt.');
    return true;
  }

  await refreshCheckinMessage(eventKey, client);
  await interaction.editReply(`${result.team.clubName} wurde vom Event abgemeldet.`);
  return true;
}

async function handleInteraction(interaction, client) {
  if (!interaction.isButton()) return false;

  const parsed = parseCheckinButton(interaction.customId);
  if (!parsed) return false;

  try {
    if (parsed.action === 'checkin_join') return await handleJoin(interaction, client, parsed.eventKey);
    if (parsed.action === 'checkin_leave') return await handleLeave(interaction, client, parsed.eventKey);
    return false;
  } catch (error) {
    const message = error?.message || 'Check-in konnte nicht verarbeitet werden.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({ content: message, flags: EPHEMERAL }).catch(() => {});
    }
    return true;
  }
}

module.exports = {
  handleInteraction,
  parseCheckinButton,
};
