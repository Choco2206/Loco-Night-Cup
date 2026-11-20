'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, escapeMarkdown } = require('discord.js');
const { GTA_CUP_CHANNEL, GTA_CUP_KEY } = require('../events/loco-gta-cup-config');
const { findTeamById } = require('../teams/team-service');
const { canAcceptCheckinActions } = require('./checkin-schedule');
const { readEventData } = require('./checkin-repository');
const { adminWithdrawTeam, reviewGtaCupPayment } = require('./checkin-service');

const PAGE_SIZE = 25;
const labels = { approve: 'Teilnahme bestätigen', reject: 'Teilnahme ablehnen', withdraw: 'Team abmelden' };

function orderedEntries(entries) {
  return [...(entries || [])].sort((a, b) =>
    String(a.checkedInAt || '').localeCompare(String(b.checkedInAt || '')));
}

function teamName(entry) {
  return findTeamById(entry.teamId)?.clubName || String(entry.teamId);
}

function buildGtaPaymentPayload(event, settings) {
  const pending = orderedEntries(event.checkin?.pendingPaymentEntries);
  const names = pending.slice(0, 48).map(entry => {
    const name = teamName(entry);
    return `• ${name.slice(0, 65)}`;
  });
  const remaining = pending.length - names.length;
  const open = canAcceptCheckinActions(GTA_CUP_KEY, event, settings) && !event.format?.lockedAt;
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gta_payment_approve').setLabel('Teilnahme bestätigen').setStyle(ButtonStyle.Success).setDisabled(!open || !pending.length),
    new ButtonBuilder().setCustomId('gta_payment_reject').setLabel('Teilnahme ablehnen').setStyle(ButtonStyle.Danger).setDisabled(!pending.length),
    new ButtonBuilder().setCustomId('gta_payment_withdraw').setLabel('Team abmelden').setStyle(ButtonStyle.Secondary)
      .setDisabled(Boolean(event.format?.lockedAt) || !event.checkin?.entries?.length),
  );
  return {
    embeds: [new EmbedBuilder().setTitle(`Freigabeliste (${pending.length})`).setDescription(
      [...names, remaining ? `… und ${remaining} weitere` : null].filter(Boolean).join('\n')
      || 'Aktuell wartet kein Team auf eine Zahlungsfreigabe.',
    )],
    components: [buttons],
    allowedMentions: { parse: [] },
  };
}

function buildTeamSelection(event, action, requestedPage, notice = '') {
  const entries = orderedEntries(action === 'withdraw' ? event.checkin?.entries : event.checkin?.pendingPaymentEntries);
  const content = [notice, `**${labels[action]}**`].filter(Boolean);
  const components = [];
  if (entries.length) {
    const pageCount = Math.ceil(entries.length / PAGE_SIZE);
    const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
    content.push(`Seite ${page + 1} von ${pageCount} · ${entries.length} Teams · Älteste Anmeldung zuerst`);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`gta_payment_${action}_select_${page}`)
      .setPlaceholder('Team auswählen')
      .addOptions(entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => ({
        label: teamName(entry).slice(0, 100),
        value: String(entry.teamId),
      })));
    components.push(new ActionRowBuilder().addComponents(menu));
    if (pageCount > 1) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`gta_payment_${action}_page_${Math.max(0, page - 1)}`)
          .setLabel('← Zurück').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`gta_payment_${action}_page_${page + 1}`)
          .setLabel('Weiter →').setStyle(ButtonStyle.Secondary).setDisabled(page + 1 === pageCount),
      ));
    }
  } else {
    content.push(action === 'withdraw' ? 'Aktuell ist kein Team eingecheckt.' : 'Die Freigabeliste ist leer.');
  }
  return { content: content.join('\n'), components, allowedMentions: { parse: [] } };
}

async function handleGtaPaymentInteraction(interaction, client) {
  const match = /^gta_payment_(approve|reject|withdraw)(?:_(page|select)_(\d+))?$/.exec(interaction.customId || '');
  if (!match || String(interaction.channelId) !== GTA_CUP_CHANNEL) return false;
  const [, action, mode, pageText] = match;
  if (mode === 'select' ? !interaction.isStringSelectMenu() : !interaction.isButton()) return false;
  const page = Number(pageText || 0);

  try {
    await require('../admin/admin-interactions').requireAdmin(interaction);
    if (!mode) {
      await interaction.reply({ ...buildTeamSelection(readEventData(GTA_CUP_KEY), action, 0), flags: 64 });
      return true;
    }
    await interaction.deferUpdate();
    if (mode === 'page') {
      await interaction.editReply(buildTeamSelection(readEventData(GTA_CUP_KEY), action, page));
      return true;
    }

    const teamId = interaction.values[0];
    const actorUserId = interaction.user.id;
    const result = action === 'withdraw'
      ? adminWithdrawTeam({ eventKey: GTA_CUP_KEY, teamId, actorUserId })
      : reviewGtaCupPayment({ eventKey: GTA_CUP_KEY, teamId, approved: action === 'approve', actorUserId });
    const name = escapeMarkdown(result.team?.clubName || teamId);
    const notice = action === 'approve' ? `✅ ${name} wurde zur Check-in-Liste hinzugefügt.`
      : action === 'reject' ? `✅ ${name} wurde von der Freigabeliste entfernt.`
      : result.wasCheckedIn ? `✅ ${name} wurde abgemeldet.` : `${name} ist bereits abgemeldet.`;
    await interaction.editReply(buildTeamSelection(readEventData(GTA_CUP_KEY), action, page, notice));
    if (result.changed) await require('./checkin-panel').refreshCheckinMessage(GTA_CUP_KEY, client);
  } catch (error) {
    if (interaction.replied) console.error('[gta-payment]', error);
    else if (interaction.deferred) await interaction.editReply(buildTeamSelection(readEventData(GTA_CUP_KEY), action, page, error.message));
    else await interaction.reply({ content: error.message, flags: 64 });
  }
  return true;
}

module.exports = { buildGtaPaymentPayload, buildTeamSelection, handleGtaPaymentInteraction };
