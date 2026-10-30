'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { HALLOWEEN_EVENT_KEY, HALLOWEEN_CHECKIN_CHANNEL_ID } = require('../events/bomber-x-loco-config');
const { assertEditable, replacementCandidates, replaceHalloweenParticipant, readHalloweenEvent } = require('./halloween-replacement-service');
const { postCheckinActivityLog } = require('./checkin-activity-log');

const PREFIX = 'halloween_replace';
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`${PREFIX}:${id}`).setLabel(label).setStyle(style);
const name = id => findTeamById(id)?.clubName || String(id);

async function assertStaff(interaction) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  if (String(interaction.channelId) !== HALLOWEEN_CHECKIN_CHANNEL_ID) throw new Error('Bitte nutze diesen Button im Halloween-Check-in-Kanal.');
  if (settings.guild?.guildId && String(interaction.guildId) !== String(settings.guild.guildId)) throw new Error('Falscher Server.');
  const member = await interaction.guild?.members.fetch(interaction.user.id);
  const roles = [...(settings.roles?.adminRoleIds || []), ...(settings.roles?.cupLeadRoleIds || []), ...(settings.permissions?.adminRoleIds || []), ...(settings.permissions?.cupLeadRoleIds || [])].map(String);
  if (!member || !(member.permissions?.has(PermissionFlagsBits.Administrator) || roles.some(id => member.roles?.cache?.has(id)))) throw new Error('Nur Admins und Turnierleitung dürfen Teilnehmer ersetzen.');
}

function selection(event, { oldId = '', all = false, page = 0 } = {}) {
  const target = !oldId;
  const teams = target ? (event.checkin.activeTeamIds || []).map(id => ({ id: String(id), clubName: name(id) })) : replacementCandidates(event, all);
  const pageCount = Math.max(1, Math.ceil(teams.length / 25));
  page = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
  const components = [];
  const chunk = teams.slice(page * 25, (page + 1) * 25);
  if (chunk.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:${target ? 'out' : 'in'}:${oldId}`)
    .setPlaceholder(target ? 'Ausscheidendes Team auswählen' : 'Ersatzteam auswählen')
    .addOptions(chunk.map(team => ({ label: team.clubName.slice(0, 100), value: String(team.id), description: target ? 'Aktiver Teilnehmer' : (event.checkin.waitlistTeamIds || []).map(String).includes(String(team.id)) ? 'Warteliste' : 'Registriertes Ersatzteam' })))));
  const nav = [];
  if (page > 0) nav.push(button(`page:${oldId}:${all ? 1 : 0}:${page - 1}`, 'Zurück'));
  if (page + 1 < pageCount) nav.push(button(`page:${oldId}:${all ? 1 : 0}:${page + 1}`, 'Weiter'));
  if (!target) nav.push(button(`page:${oldId}:${all ? 0 : 1}:0`, all ? 'Nur Warteliste' : 'Andere registrierte Teams'));
  nav.push(button('cancel', 'Abbrechen'));
  components.push(new ActionRowBuilder().addComponents(...nav));
  return { content: `${target ? 'Welches Team scheidet aus?' : `**${name(oldId)}** ersetzen: ${all ? 'Registrierte Ersatzteams' : 'Nachrücker von der Warteliste'} auswählen.`}\nSeite ${page + 1}/${pageCount}${!chunk.length ? '\nKeine passenden Teams verfügbar.' : ''}\nEs wird keine Sperre vergeben.`, components };
}

async function handleInteraction(interaction, client) {
  if (!interaction.customId?.startsWith(`${PREFIX}:`)) return false;
  try {
    if (interaction.customId === `${PREFIX}:open`) await interaction.deferReply({ flags: 64 });
    else await interaction.deferUpdate();
    await assertStaff(interaction);
    const [, action, a, b, c] = interaction.customId.split(':');
    if (action === 'cancel') { await interaction.editReply({ content: 'Austausch abgebrochen.', components: [] }); return true; }
    const event = readHalloweenEvent();
    assertEditable(event);
    if (action === 'open') await interaction.editReply(selection(event));
    else if (action === 'page') await interaction.editReply(selection(event, { oldId: a, all: b === '1', page: Number(c) }));
    else if (action === 'out') await interaction.editReply(selection(event, { oldId: interaction.values[0] }));
    else if (action === 'in') {
      const newId = interaction.values[0];
      await interaction.editReply({ content: `**${name(a)} raus → ${name(newId)} rein**\nDer Nachrücker übernimmt den Teilnehmerplatz und gegebenenfalls die Gruppe. Keine Sperre, keine neue Auslosung.`, components: [new ActionRowBuilder().addComponents(button(`confirm:${a}:${newId}`, 'Austausch bestätigen', ButtonStyle.Success), button('cancel', 'Abbrechen'))] });
    } else if (action === 'confirm') {
      const oldTeam = findTeamById(a);
      const outcome = replaceHalloweenParticipant({ oldTeamId: a, newTeamId: b, actorUserId: interaction.user.id });
      // Save first, then update Discord. A display failure must not repeat the exchange.
      const failures = [];
      for (const group of outcome.affectedGroups) {
        try {
          await require('../groups/group-replacements').syncReplacementDiscordResources({ client, eventKey: HALLOWEEN_EVENT_KEY, outcome: { ...outcome, group, oldTeam } });
          await require('../groups/attendance-service').ensureAttendancePost(client, HALLOWEEN_EVENT_KEY, group.groupKey);
        } catch (error) { failures.push(error.message); }
      }
      try { await require('./checkin-panel').refreshCheckinMessage(HALLOWEEN_EVENT_KEY, client); } catch (error) { failures.push(error.message); }
      await postCheckinActivityLog(client, { action: 'leave', eventKey: HALLOWEEN_EVENT_KEY, result: { changed: true, team: oldTeam || { id: a, clubName: outcome.oldParticipant.displayName }, event: outcome.event }, user: interaction.user, byAdmin: true });
      await postCheckinActivityLog(client, { action: 'join', eventKey: HALLOWEEN_EVENT_KEY, result: { changed: true, team: outcome.newTeam, event: outcome.event }, user: interaction.user, byAdmin: true });
      if (failures.length) console.error('[halloween-replacement] Discord-Aktualisierung:', failures);
      await interaction.editReply({ content: `✅ **${oldTeam?.clubName || a}** wurde durch **${outcome.newTeam.clubName}** ersetzt. Es wurde keine Sperre vergeben.${failures.length ? '\nDer Austausch ist gespeichert. Einige Discord-Anzeigen konnten noch nicht aktualisiert werden.' : '\nTeilnehmerliste und vorhandene Gruppenanzeigen wurden aktualisiert.'}`, components: [] });
    } else throw new Error('Unbekannte Austauschaktion.');
  } catch (error) {
    const payload = { content: error.message || 'Austausch fehlgeschlagen.', components: [] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply({ ...payload, flags: 64 }).catch(() => {});
  }
  return true;
}

module.exports = { handleInteraction, selection, assertStaff };
