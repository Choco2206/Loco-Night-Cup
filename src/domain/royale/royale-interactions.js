'use strict';

const { ActionRowBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const { findTeamById } = require('../teams/team-service');
const { submitRoyaleReport } = require('./royale-bracket');
const { checkInRoyaleTeam, withdrawRoyaleTeam } = require('./royale-service');
const { refreshRoyaleCheckin } = require('./royale-checkin-panel');
const { readRoyale, updateRoyale } = require('./royale-repository');
const { syncRoyaleRoundResources } = require('./royale-rounds');
const { postRoyaleCeremony } = require('./royale-ceremony');
const { cleanupRoyaleResources } = require('./royale-rounds');
const { syncRoyalePublicSchedule } = require('./royale-public-schedule');
const { handleResultOutcome } = require('../results/result-confirmation-service');
const { handleRoyaleAttendanceInteraction } = require('./royale-attendance');

function manages(userId, participant) {
  const team = findTeamById(participant?.teamId);
  return String(team?.manager?.userId) === String(userId) || (team?.coManagers || []).some(co => String(co.userId) === String(userId));
}

function matchLabel(match) { return `${match.home.displayName} vs ${match.away.displayName}`.slice(0, 100); }

function isAdmin(interaction) {
  const settings = readJson(FILES.settings, createSettingsDefault());
  const ids = [...(settings.roles?.adminRoleIds || []), ...(settings.roles?.cupLeadRoleIds || [])].map(String);
  return ids.some(id => interaction.member?.roles?.cache?.has(id));
}

async function openResult(interaction, roundKey) {
  const event = readRoyale(); const round = event.bracket?.rounds?.[roundKey];
  if (!round || round.status !== 'open') throw new Error('Diese Royal-Runde ist nicht geöffnet.');
  const matches = round.matches.filter(match => ['open', 'pending_confirmation'].includes(match.status) && (manages(interaction.user.id, match.home) || manages(interaction.user.id, match.away)));
  if (!matches.length) throw new Error('Für dein Team gibt es in dieser Runde kein meldbares Spiel.');
  await interaction.reply({ content: 'Wähle das Spiel aus.', components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`royale_result_select:${roundKey}`).setPlaceholder('Royal-Spiel auswählen').addOptions(matches.map(match => ({ label: matchLabel(match), value: match.id }))))], flags: 64 });
  return true;
}

async function selectResult(interaction, roundKey) {
  const event = readRoyale(); const match = event.bracket?.rounds?.[roundKey]?.matches.find(item => item.id === interaction.values?.[0]);
  if (!match || !['open', 'pending_confirmation'].includes(match.status) || (!manages(interaction.user.id, match.home) && !manages(interaction.user.id, match.away))) throw new Error('Dieses Royal-Spiel ist nicht meldbar.');
  await interaction.showModal(new ModalBuilder().setCustomId(`royale_result_modal:${roundKey}:${match.id}`).setTitle('Royal-Ergebnis').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('home_goals').setLabel(`${match.home.displayName} Tore`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_goals').setLabel(`${match.away.displayName} Tore`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true)),
  ));
  return true;
}

async function openAdminResult(interaction, roundKey) {
  if (!isAdmin(interaction)) throw new Error('Du darfst kein Royal-Admin-Ergebnis setzen.');
  const round = readRoyale().bracket?.rounds?.[roundKey];
  const matches = (round?.matches || []).filter(match => ['open', 'admin_decision_required'].includes(match.status));
  if (!matches.length) throw new Error('Keine Royal-Spiele für ein Admin-Ergebnis verfügbar.');
  await interaction.reply({ content: 'Wähle das Royal-Spiel aus.', components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`royale_admin_result_select:${roundKey}`).setPlaceholder('Royal-Spiel auswählen').addOptions(matches.map(match => ({ label: matchLabel(match), value: match.id }))))], flags: 64 });
  return true;
}

async function selectAdminResult(interaction, roundKey) {
  if (!isAdmin(interaction)) throw new Error('Du darfst kein Royal-Admin-Ergebnis setzen.');
  const match = readRoyale().bracket?.rounds?.[roundKey]?.matches.find(item => item.id === interaction.values?.[0]);
  if (!match) throw new Error('Royal-Spiel wurde nicht gefunden.');
  await interaction.showModal(new ModalBuilder().setCustomId(`royale_admin_result_modal:${roundKey}:${match.id}`).setTitle('Royal-Admin-Ergebnis').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('home_goals').setLabel(`${match.home.displayName} Tore`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('away_goals').setLabel(`${match.away.displayName} Tore`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true)),
  ));
  return true;
}

async function openReplacement(interaction, roundKey) {
  if (!isAdmin(interaction)) throw new Error('Du darfst kein Royal-Team ersetzen.');
  const round = readRoyale().bracket?.rounds?.[roundKey];
  const matches = (round?.matches || []).filter(match => ['open', 'admin_decision_required'].includes(match.status));
  if (!matches.length) throw new Error('In dieser Runde gibt es kein ersetzbares Spiel.');
  await interaction.reply({ content: 'Wähle zuerst das Spiel.', components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`royale_replace_match:${roundKey}`).setPlaceholder('Spiel auswählen').addOptions(matches.map(match => ({ label: matchLabel(match), value: match.id }))))], flags: 64 });
  return true;
}

async function selectReplacementMatch(interaction, roundKey) {
  if (!isAdmin(interaction)) throw new Error('Du darfst kein Royal-Team ersetzen.');
  const matchId = interaction.values?.[0];
  await interaction.update({ content: 'Welche Seite soll ersetzt werden?', components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`royale_replace_side:${roundKey}:${matchId}`).setPlaceholder('Team-Seite auswählen').addOptions([
    { label: 'Heimteam', description: 'Das links/oben geführte Team ersetzen', value: 'home' }, { label: 'Auswärtsteam', description: 'Das rechts/unten geführte Team ersetzen', value: 'away' },
  ]))] });
  return true;
}

async function selectReplacementSide(interaction, roundKey, matchId) {
  if (!isAdmin(interaction)) throw new Error('Du darfst kein Royal-Team ersetzen.');
  const side = interaction.values?.[0]; const event = readRoyale(); const match = event.bracket?.rounds?.[roundKey]?.matches.find(item => item.id === matchId);
  if (!match || !['home', 'away'].includes(side)) throw new Error('Spiel oder Seite wurde nicht gefunden.');
  const options = (event.checkin?.waitlistTeamIds || []).map(teamId => findTeamById(teamId)).filter(Boolean).slice(0, 25).map(team => ({ label: team.clubName.slice(0, 100), value: String(team.id) }));
  if (!options.length) throw new Error('Es steht kein Ersatzteam zur Auswahl.');
  await interaction.update({ content: `Ersatz für **${match[side].displayName}** auswählen.`, components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`royale_replace_team:${roundKey}:${matchId}:${side}`).setPlaceholder('Ersatzteam auswählen').addOptions(options))] });
  return true;
}

async function applyReplacement(interaction, client, roundKey, matchId, side) {
  if (!isAdmin(interaction)) throw new Error('Du darfst kein Royal-Team ersetzen.');
  const replacementId = interaction.values?.[0]; let replacementName;
  updateRoyale(event => {
    const round = event.bracket?.rounds?.[roundKey]; const match = round?.matches.find(item => item.id === matchId);
    if (!round || round.status !== 'open' || !match || !['open', 'admin_decision_required'].includes(match.status)) throw new Error('Das Spiel ist nicht mehr ersetzbar.');
    const selected = findTeamById(replacementId);
    if (!selected) throw new Error('Das Ersatzteam gehört nicht zu diesem Turnier.');
    if (!(event.checkin?.waitlistTeamIds || []).map(String).includes(String(replacementId))) throw new Error('Das Ersatzteam gehört nicht zur Warteliste dieses Turniers.');
    const removedId = String(match[side].teamId); replacementName = selected.clubName;
    match[side] = { type: 'team', teamId: String(selected.id), displayName: replacementName }; match.reports = []; match.status = 'open';
    event.format.participants = event.format.participants.map(team => String(team.teamId) === removedId ? { teamId: String(selected.id), displayName: replacementName } : team);
    event.checkin.waitlistTeamIds = event.checkin.waitlistTeamIds.filter(id => String(id) !== String(selected.id)); event.checkin.waitlistTeamIds.push(removedId);
    event.bracket.losses[String(selected.id)] = Number(event.bracket.losses[removedId] || 0); delete event.bracket.losses[removedId];
    return event;
  });
  await syncRoyaleRoundResources(client); await syncRoyalePublicSchedule(client);
  await interaction.update({ content: `Team erfolgreich durch **${replacementName}** ersetzt.`, components: [] }); return true;
}

async function submitAdminResult(interaction, client, roundKey, matchId) {
  await interaction.deferReply({ flags: 64 });
  if (!isAdmin(interaction)) throw new Error('Du darfst kein Royal-Admin-Ergebnis setzen.');
  let outcome;
  updateRoyale(event => {
    const match = event.bracket?.rounds?.[roundKey]?.matches.find(item => item.id === matchId);
    const confirmationNotice = match?.confirmation ? { ...match.confirmation } : null;
    outcome = require('./royale-bracket').recordRoyaleResult(event.bracket, { roundKey, matchId, homeGoals: interaction.fields.getTextInputValue('home_goals'), awayGoals: interaction.fields.getTextInputValue('away_goals') });
    outcome.confirmationNotice = confirmationNotice;
    event.status = event.bracket.status === 'completed' ? 'completed' : 'running'; return event;
  });
  await handleResultOutcome({ client, eventKey: 'knockout_royale', phase: 'royale', phaseKey: roundKey, outcome, channelId: interaction.channelId });
  await finalizeConfirmedRoyaleResult(client, outcome);
  await interaction.editReply(outcome.eliminated ? 'Admin-Ergebnis gesetzt; das unterlegene Team ist ausgeschieden.' : 'Admin-Ergebnis gesetzt; der Turnierbaum wurde aktualisiert.');
  return true;
}

async function finalizeConfirmedRoyaleResult(client, outcome) {
  if (!outcome || outcome.status !== 'confirmed') return false;
  await syncRoyaleRoundResources(client);
  await syncRoyalePublicSchedule(client);
  if (readRoyale().bracket?.status === 'completed') {
    await postRoyaleCeremony(client);
    await cleanupRoyaleResources(client);
  }
  return true;
}

async function submitResult(interaction, client, roundKey, matchId) {
  await interaction.deferReply({ flags: 64 });
  let outcome;
  updateRoyale(event => {
    const match = event.bracket?.rounds?.[roundKey]?.matches.find(item => item.id === matchId);
    const reporterTeamId = manages(interaction.user.id, match?.home) ? match.home.teamId : manages(interaction.user.id, match?.away) ? match.away.teamId : null;
    if (!reporterTeamId) throw new Error('Du darfst dieses Royal-Ergebnis nicht melden.');
    outcome = submitRoyaleReport(event.bracket, { roundKey, matchId, reporterTeamId, reportedByUserId: interaction.user.id, homeGoals: interaction.fields.getTextInputValue('home_goals'), awayGoals: interaction.fields.getTextInputValue('away_goals') });
    event.status = event.bracket.status === 'completed' ? 'completed' : 'running'; event.meta.updatedAt = new Date().toISOString(); return event;
  });
  await handleResultOutcome({ client, eventKey: 'knockout_royale', phase: 'royale', phaseKey: roundKey, outcome, channelId: interaction.channelId });
  if (outcome.status === 'confirmed') await finalizeConfirmedRoyaleResult(client, outcome);
  else {
    await syncRoyaleRoundResources(client);
    await syncRoyalePublicSchedule(client);
  }
  if (outcome.status === 'admin_decision_required') {
    const match = outcome.match;
    await interaction.channel?.send({
      content: ['🛠️ **Royal-Admin-Entscheidung erforderlich**', `${match.home.displayName} vs ${match.away.displayName}`, 'Die beiden Teams haben unterschiedliche Ergebnisse gemeldet.'].join('\n'),
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }
  await interaction.editReply(outcome.status === 'pending_confirmation'
    ? 'Ergebnis gespeichert. Es wartet auf die Meldung des Gegners.'
    : outcome.status === 'admin_decision_required'
      ? 'Die Meldungen unterscheiden sich. Eine Admin-Entscheidung ist erforderlich.'
      : outcome.eliminated ? 'Ergebnis bestätigt. Das unterlegene Team ist nach der zweiten Niederlage ausgeschieden.' : 'Ergebnis bestätigt. Die nächste Zuordnung wurde aktualisiert.');
  return true;
}

async function handleRoyaleInteraction(interaction, client) {
  const customId = interaction.customId || '';
  if (await handleRoyaleAttendanceInteraction(interaction, client)) return true;
  if (interaction.isButton() && customId.startsWith('royale_result_open:')) return openResult(interaction, customId.split(':')[1]);
  if (interaction.isButton() && customId.startsWith('royale_admin_result_open:')) return openAdminResult(interaction, customId.split(':')[1]);
  if (interaction.isButton() && customId.startsWith('royale_replace_open:')) return openReplacement(interaction, customId.split(':')[1]);
  if (interaction.isStringSelectMenu?.() && customId.startsWith('royale_result_select:')) return selectResult(interaction, customId.split(':')[1]);
  if (interaction.isStringSelectMenu?.() && customId.startsWith('royale_admin_result_select:')) return selectAdminResult(interaction, customId.split(':')[1]);
  if (interaction.isStringSelectMenu?.() && customId.startsWith('royale_replace_match:')) return selectReplacementMatch(interaction, customId.split(':')[1]);
  if (interaction.isStringSelectMenu?.() && customId.startsWith('royale_replace_side:')) { const [, roundKey, matchId] = customId.split(':'); return selectReplacementSide(interaction, roundKey, matchId); }
  if (interaction.isStringSelectMenu?.() && customId.startsWith('royale_replace_team:')) { const [, roundKey, matchId, side] = customId.split(':'); return applyReplacement(interaction, client, roundKey, matchId, side); }
  if (interaction.isModalSubmit?.() && customId.startsWith('royale_result_modal:')) { const [, roundKey, matchId] = customId.split(':'); return submitResult(interaction, client, roundKey, matchId); }
  if (interaction.isModalSubmit?.() && customId.startsWith('royale_admin_result_modal:')) { const [, roundKey, matchId] = customId.split(':'); return submitAdminResult(interaction, client, roundKey, matchId); }
  if (!interaction.isButton() || !['royale_checkin_join', 'royale_checkin_leave'].includes(customId)) return false;
  await interaction.deferReply({ flags: 64 });
  const result = interaction.customId === 'royale_checkin_join'
    ? checkInRoyaleTeam({ userId: interaction.user.id })
    : withdrawRoyaleTeam({ userId: interaction.user.id });
  await refreshRoyaleCheckin(client);
  await interaction.editReply(result.changed
    ? `**${result.team.clubName}** wurde ${interaction.customId.endsWith('join') ? 'für die Knockout Royale angemeldet' : 'abgemeldet'}.`
    : `Für **${result.team.clubName}** war keine Änderung nötig.`);
  return true;
}

module.exports = { finalizeConfirmedRoyaleResult, handleRoyaleInteraction };
