'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { GTA_CUP_CHANNEL, GTA_CUP_KEY } = require('../events/loco-gta-cup-config');
const { findTeamById } = require('../teams/team-service');
const { canAcceptCheckinActions } = require('./checkin-schedule');
const { reviewGtaCupPayment } = require('./checkin-service');

function buildGtaPaymentPayload(event, settings) {
  const pending = event.checkin?.pendingPaymentEntries || [];
  const names = pending.slice(0, 48).map(entry => {
    const name = findTeamById(entry.teamId)?.clubName || entry.teamId;
    return `• ${name.slice(0, 65)}`;
  });
  const remaining = pending.length - names.length;
  const open = canAcceptCheckinActions(GTA_CUP_KEY, event, settings) && !event.format?.lockedAt;
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gta_payment_approve').setLabel('Teilnahme bestätigen').setStyle(ButtonStyle.Success).setDisabled(!open || !pending.length),
    new ButtonBuilder().setCustomId('gta_payment_reject').setLabel('Teilnahme ablehnen').setStyle(ButtonStyle.Danger).setDisabled(!pending.length),
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

async function handleGtaPaymentInteraction(interaction, client) {
  const match = /^gta_payment_(approve|reject)(_submit)?$/.exec(interaction.customId || '');
  if (!match || String(interaction.channelId) !== GTA_CUP_CHANNEL) return false;
  const approved = match[1] === 'approve';

  try {
    await require('../admin/admin-interactions').requireAdmin(interaction);
    if (interaction.isButton() && !match[2]) {
      const field = new TextInputBuilder().setCustomId('team').setLabel('Exakter Teamname oder Team-ID').setStyle(TextInputStyle.Short).setRequired(true);
      const modal = new ModalBuilder()
        .setCustomId(`${interaction.customId}_submit`)
        .setTitle(approved ? 'Teilnahme bestätigen' : 'Teilnahme ablehnen')
        .addComponents(new ActionRowBuilder().addComponents(field));
      await interaction.showModal(modal);
      return true;
    }
    if (!interaction.isModalSubmit() || !match[2]) return false;
    await interaction.deferReply({ flags: 64 });
    const result = reviewGtaCupPayment({
      eventKey: GTA_CUP_KEY,
      reference: interaction.fields.getTextInputValue('team').trim(),
      approved,
      actorUserId: interaction.user.id,
    });
    const name = result.team?.clubName || result.entry.teamId;
    await interaction.editReply(approved ? `${name} wurde zur Check-in-Liste hinzugefügt.` : `${name} wurde von der Freigabeliste entfernt.`);
    await require('./checkin-panel').refreshCheckinMessage(GTA_CUP_KEY, client);
  } catch (error) {
    if (interaction.replied) console.error('[gta-payment]', error);
    else if (interaction.deferred) await interaction.editReply(error.message);
    else await interaction.reply({ content: error.message, flags: 64 });
  }
  return true;
}

module.exports = { buildGtaPaymentPayload, handleGtaPaymentInteraction };
