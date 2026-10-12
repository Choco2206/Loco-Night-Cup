'use strict';

const LOG_CHANNEL_ID = '1517040860942962749';

async function postCheckinActivityLog(client, { action, eventKey, result, user, byAdmin = false, now = new Date() }) {
  if (!result.changed) return false;
  const event = result.event;
  const waitlist = (event?.checkin?.waitlistTeamIds || []).map(String);
  const position = waitlist.indexOf(String(result.team.id));
  const lines = [
    action === 'join' ? '⬆️ **Cup-Anmeldung**' : '⬇️ **Cup-Abmeldung**',
    `**Team:** ${result.team.clubName} (ID: ${result.team.id})`,
    `**Person:** <@${user.id}> (${user.tag || user.username || user.id}, ID: ${user.id})`,
    `**Event:** ${event?.label || eventKey}${event?.cycle?.eventDate ? ` · ${event.cycle.eventDate}` : ''} (${eventKey})`,
    `**Zeitpunkt:** <t:${Math.floor(now.getTime() / 1000)}:F>`,
    `**Auslöser:** ${byAdmin ? 'Manuell durch Admin' : 'Durch VM / Co-VM'}`,
  ];
  if (action === 'join' && position >= 0) lines.push(`**Wartelistenplatz:** ${position + 1}`);
  if (result.lateWithdrawal) lines.push('**Hinweis:** Abmeldung nach Anmeldeschluss. Automatische 7-Tage-Sperre und Entfernung aus allen Check-ins.');
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel?.send) throw new Error('Logkanal ist nicht beschreibbar.');
    await channel.send({ content: lines.join('\n'), allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error('[checkin-activity-log] Log konnte nicht gesendet werden', { eventKey, action, teamId: result.team.id, userId: user.id, error: error.message });
    return false;
  }
}

module.exports = { postCheckinActivityLog };
