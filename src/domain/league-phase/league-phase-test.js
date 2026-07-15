'use strict';

const { EmbedBuilder } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { readAllEvents } = require('../checkins/checkin-repository');
const { listVisibleTeams, findTeamById } = require('../teams/team-service');
const { getTeamUserIds } = require('../groups/group-roles');
const { recalculateGroupStandings } = require('../groups/group-results');
const { LEAGUE_PHASE_FORMATS } = require('../../app/constants');
const { createLeaguePhaseDraw, validateLeaguePhaseDraw } = require('./league-phase-draw');
const {
  LEAGUE_PHASE_CATEGORY_ID,
  buildLeaguePhaseButtons,
  ensureLeaguePhaseChannel,
  ensureLeaguePhaseRole,
  getExistingGuildMemberIds,
  verifyLeaguePhaseAccess,
} = require('./league-phase-service');
const { renderLeagueSchedule, renderLeagueTable } = require('../../../utils/league-phase-renderer');

const activeTests = new Map();
// Ein normales Check-in ist noch keine laufende Turnierphase und darf den
// isolierten Ligaphasentest nicht blockieren. Erst erzeugte Gruppen-/Liga-/
// K.O.-Daten oder die laufende Siegerehrung teilen sich Live-Ressourcen.
const BUSY_STATUSES = new Set(['groups', 'groups_running', 'league_phase', 'knockout', 'ceremony']);

function participants(size) {
  const result = listVisibleTeams()
    .filter(team => team.status === 'active' && team.registrationStatus === 'complete')
    .slice(0, size)
    .map(team => ({ type: 'team', teamId: String(team.id), displayName: team.clubName, participantKey: `team:${team.id}` }));
  while (result.length < size) {
    const index = result.length + 1;
    result.push({ type: 'team', teamId: `league_test_${index}`, displayName: index === size ? 'Sehr Langer Testverein Ohne Logo' : `Testteam ${index}`, participantKey: `team:league_test_${index}` });
  }
  return result;
}

function testPhase(size) {
  if (!LEAGUE_PHASE_FORMATS[size]) throw new Error('Ligaphasentest unterstuetzt nur 14, 18 oder 20 Teams.');
  const phase = createLeaguePhaseDraw({ eventKey: `league_test_${size}`, participants: participants(size), random: () => 0.42 });
  let index = 0;
  for (const match of phase.matchdays.flatMap(day => day.matches)) {
    if (index++ % 3) {
      match.status = 'confirmed';
      match.result = { homeGoals: index % 11, awayGoals: index % 4, source: 'test' };
    }
  }
  recalculateGroupStandings(phase);
  validateLeaguePhaseDraw(phase);
  return phase;
}

function assertNoLiveEvent() {
  const active = Object.values(readAllEvents()).find(event => BUSY_STATUSES.has(event.status));
  if (active) throw new Error(`Ligaphasen-Test nicht moeglich: ${active.label || active.eventKey} ist aktiv (${active.status}).`);
}

async function startLeaguePhaseIntegrationTest({ guild, formatSize }) {
  const size = Number(formatSize);
  const config = LEAGUE_PHASE_FORMATS[size];
  if (!config) throw new Error('Bitte 14, 18 oder 20 waehlen.');
  if (activeTests.has(guild.id)) throw new Error('In diesem Server laeuft bereits ein Ligaphasen-Test.');
  assertNoLiveEvent();
  const staleChannels = guild.channels.cache.filter(channel => ['ligaphase', 'ligaphase-ergebnisse'].includes(channel.name));
  for (const channel of staleChannels.values()) await channel.delete('Verwaiste Ligaphasenressource vor Integrationstest bereinigt');

  const settings = readJson(FILES.settings, createSettingsDefault());
  const phase = testPhase(size);
  const role = await ensureLeaguePhaseRole(guild, settings);
  await guild.members.fetch().catch(() => null);
  for (const member of role.members.values()) await member.roles.remove(role.id, 'Verwaiste Ligaphasenmitgliedschaft vor Integrationstest bereinigt');
  const userIds = await getExistingGuildMemberIds(guild, phase.slots.flatMap(slot => getTeamUserIds(findTeamById(slot.teamId))));
  const assignedMemberIds = [];
  for (const userId of userIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(role.id)) {
      await member.roles.add(role.id, 'Ligaphasen-Integrationstest');
      assignedMemberIds.push(member.id);
    }
  }
  const overview = await ensureLeaguePhaseChannel(guild, settings, null, 'ligaphase', role.id, userIds);
  const results = await ensureLeaguePhaseChannel(guild, settings, null, 'ligaphase-ergebnisse', role.id, userIds);
  phase.roleId = role.id; phase.overviewChannelId = overview.id; phase.resultsChannelId = results.id;

  const table = await renderLeagueTable(phase); const schedule = await renderLeagueSchedule(phase);
  await overview.send({ files: [{ attachment: table, name: `ligaphase_table_${size}_test.png` }], allowedMentions: { parse: [] } });
  await overview.send({ files: [{ attachment: schedule, name: `ligaphase_schedule_${size}_test.png` }], allowedMentions: { parse: [] } });
  await overview.send({ content: `📣 **Ligaphase – Spieltag 1 ist freigegeben.**\nAlle ${config.matchesPerDay} Begegnungen dieses Spieltags können jetzt gemeldet werden.`, allowedMentions: { parse: [] } });
  await results.send({ files: [{ attachment: table, name: `ligaphase_table_${size}_results_test.png` }], allowedMentions: { parse: [] } });
  await results.send({ files: [{ attachment: schedule, name: `ligaphase_schedule_${size}_results_test.png` }], components: [buildLeaguePhaseButtons(`league_test_${size}`)], allowedMentions: { parse: [] } });

  const access = await verifyLeaguePhaseAccess({ guild, settings, phase });
  if (!access.ok) throw new Error(`Berechtigungspruefung fehlgeschlagen: ${JSON.stringify(access)}`);
  activeTests.set(guild.id, { roleId: role.id, channelIds: [overview.id, results.id], assignedMemberIds, size });

  const testChannel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (testChannel?.isTextBased?.()) await testChannel.send({ embeds: [new EmbedBuilder()
    .setTitle(`✅ ${size}er-Ligaphasen-Integrationstest gestartet`)
    .setDescription([`${phase.slots.length} Startplätze`, `${config.matchdays} Spieltage`, `${config.matchesPerDay} Spiele je Spieltag`, `${config.totalMatches} Spiele insgesamt`, `Rolle: <@&${role.id}>`, `Kanäle in Kategorie ${LEAGUE_PHASE_CATEGORY_ID}`, 'Rollen und Berechtigungen erfolgreich geprüft.'].join('\n'))
    .setColor(0x2ecc71)], allowedMentions: { parse: [] } });
  return { size, overviewChannelId: overview.id, resultsChannelId: results.id, access };
}

async function stopLeaguePhaseIntegrationTest({ guild }) {
  const state = activeTests.get(guild.id);
  if (!state) throw new Error('Es laeuft kein Ligaphasen-Test.');
  const role = await guild.roles.fetch(state.roleId).catch(() => null);
  if (role) for (const memberId of state.assignedMemberIds) {
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (member?.roles.cache.has(role.id)) await member.roles.remove(role.id, 'Ligaphasen-Integrationstest beendet').catch(() => null);
  }
  for (const channelId of state.channelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel && ['ligaphase', 'ligaphase-ergebnisse'].includes(channel.name)) await channel.delete('Ligaphasen-Integrationstest beendet').catch(() => null);
  }
  activeTests.delete(guild.id);
  const testChannel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (testChannel?.isTextBased?.()) await testChannel.send({ content: `✅ ${state.size}er-Ligaphasen-Test beendet. Mitgliedschaften, Kanäle und Testdaten wurden entfernt; Rolle und Kategorie bleiben bestehen.`, allowedMentions: { parse: [] } });
  return state;
}

async function handleLeaguePhaseTestInteraction(interaction) {
  if (!interaction.isButton?.() || !interaction.guild) return false;
  const [action, eventKey, groupKey] = String(interaction.customId || '').split(':');
  if (!['group_result_open', 'group_admin_result_open', 'group_replacement_open'].includes(action)) return false;
  if (!/^league_test_(14|18|20)$/.test(eventKey) || groupKey !== 'league') return false;
  const state = activeTests.get(interaction.guild.id);
  if (!state || eventKey !== `league_test_${state.size}`) {
    await interaction.reply({ content: 'Dieser Ligaphasen-Test ist nicht mehr aktiv. Bitte den Test im Admin-Panel neu starten.', flags: 64 });
    return true;
  }
  const labels = {
    group_result_open: 'Ergebnis eintragen',
    group_admin_result_open: 'Admin-Ergebnis',
    group_replacement_open: 'Nachrücker',
  };
  await interaction.reply({
    content: `✅ Testbutton **${labels[action]}** wurde korrekt erkannt. Der isolierte Integrationstest verändert bewusst keine echten Event-, Ergebnis- oder Teamdaten.`,
    flags: 64,
  });
  return true;
}

module.exports = { handleLeaguePhaseTestInteraction, startLeaguePhaseIntegrationTest, stopLeaguePhaseIntegrationTest, testPhase };
