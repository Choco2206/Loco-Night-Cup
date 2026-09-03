'use strict';

const {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const {
  CATEGORIES,
  buildCloseConfirmation,
  buildCloseModal,
  buildCreateModal,
  buildLogEmbed,
  buildRatingComponents,
  buildRatingModal,
  buildTicketControls,
  buildTicketEmbed,
  buildUserSelect,
  categoryDetails,
  formatTicketNumber,
} = require('./ticket-components');
const {
  buildTranscript,
  getTicket,
  reserveTicket,
  updateTicket,
} = require('./ticket-store');

const EPHEMERAL = 64;

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function parseNumber(customId, prefix) {
  if (!customId.startsWith(`${prefix}:`)) return null;
  const number = Number(customId.slice(prefix.length + 1).split(':')[0]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function roleLabelForMember(member, settings) {
  if (settings.roles?.managerRoleId && member.roles.cache.has(String(settings.roles.managerRoleId))) return 'Manager';
  if (settings.roles?.playerRoleId && member.roles.cache.has(String(settings.roles.playerRoleId))) return 'Spieler';
  return null;
}

function isTicketMod(member, settings) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = settings.roles?.ticketModRoleId;
  return Boolean(roleId && member.roles.cache.has(String(roleId)));
}

async function memberFor(interaction) {
  if (!interaction.guild) return null;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

async function replyEphemeral(interaction, payload) {
  const body = typeof payload === 'string' ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) return interaction.editReply(body).catch(() => null);
  return interaction.reply({ ...body, flags: EPHEMERAL }).catch(() => null);
}

async function requireEligibleMember(interaction, settings) {
  const member = await memberFor(interaction);
  const roleLabel = member ? roleLabelForMember(member, settings) : null;
  if (!member || !roleLabel) throw new Error('Du benötigst die Manager- oder Spielerrolle, um ein Ticket zu erstellen.');
  return { member, roleLabel };
}

async function requireTicketMod(interaction, settings) {
  const member = await memberFor(interaction);
  if (!isTicketMod(member, settings)) throw new Error('Diese Funktion ist nur für Ticket Mods verfügbar.');
  return member;
}

async function fetchTicketThread(client, ticket) {
  if (!ticket?.threadId) return null;
  const channel = await client.channels.fetch(String(ticket.threadId)).catch(() => null);
  return channel?.isThread?.() ? channel : null;
}

async function refreshTicketMessage(client, ticket) {
  const thread = await fetchTicketThread(client, ticket);
  if (!thread || !ticket.controlMessageId) return false;
  const message = await thread.messages.fetch(String(ticket.controlMessageId)).catch(() => null);
  if (!message) return false;
  await message.edit({
    embeds: [buildTicketEmbed(ticket)],
    components: buildTicketControls(ticket),
    allowedMentions: { parse: [] },
  });
  return true;
}

async function handleCategorySelect(interaction) {
  const category = interaction.values?.[0];
  if (!CATEGORIES[category]) throw new Error('Diese Ticket-Kategorie ist ungültig.');
  const settings = readSettings();
  await requireEligibleMember(interaction, settings);
  await interaction.showModal(buildCreateModal(category));
}

async function createTicketFromModal(interaction, client, category) {
  if (!interaction.guild) throw new Error('Tickets können nur auf dem Server erstellt werden.');
  if (!CATEGORIES[category]) throw new Error('Diese Ticket-Kategorie ist ungültig.');
  const settings = readSettings();
  const { member, roleLabel } = await requireEligibleMember(interaction, settings);
  const supportChannelId = settings.channels?.ticketSupportChannelId;
  const supportChannel = supportChannelId
    ? await interaction.guild.channels.fetch(String(supportChannelId)).catch(() => null)
    : null;
  if (!supportChannel || supportChannel.type !== ChannelType.GuildText) {
    throw new Error('Der Ticket-Support-Kanal ist gerade nicht verfügbar.');
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  const ticket = reserveTicket({
    category,
    creatorId: interaction.user.id,
    creatorName: interaction.user.tag || interaction.user.username,
    roleLabel,
    teamName: interaction.fields.getTextInputValue('team_name').trim() || null,
    subject: interaction.fields.getTextInputValue('subject').trim(),
    description: interaction.fields.getTextInputValue('description').trim(),
    guildId: interaction.guild.id,
  }, Number(settings.tickets?.maxOpenPerUser) || 2);

  try {
    const thread = await supportChannel.threads.create({
      name: `Ticket ${formatTicketNumber(ticket.number)}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      invitable: false,
      reason: `Ticket #${formatTicketNumber(ticket.number)} von ${interaction.user.tag || interaction.user.id}`,
    });
    await thread.members.add(interaction.user.id);
    const activeTicket = updateTicket(ticket.number, current => ({
      ...current,
      status: 'open',
      threadId: thread.id,
      updatedAt: new Date().toISOString(),
    }));
    const ticketModRoleId = settings.roles?.ticketModRoleId;
    const content = [
      ticketModRoleId ? `<@&${ticketModRoleId}>` : null,
      `<@${interaction.user.id}>, dein Ticket wurde erstellt. Ein Ticket Mod meldet sich hier bei dir.`,
    ].filter(Boolean).join('\n');
    const controlMessage = await thread.send({
      content,
      embeds: [buildTicketEmbed(activeTicket)],
      components: buildTicketControls(activeTicket),
      allowedMentions: {
        parse: [],
        users: [interaction.user.id],
        roles: ticketModRoleId ? [ticketModRoleId] : [],
      },
    });
    const finalized = updateTicket(ticket.number, current => ({ ...current, controlMessageId: controlMessage.id }));
    const link = `https://discord.com/channels/${interaction.guild.id}/${thread.id}`;
    await interaction.editReply({ content: `✅ Dein Ticket #${formatTicketNumber(ticket.number)} wurde erstellt: ${link}` });
    await member.send({
      embeds: [new EmbedBuilder()
        .setColor(0x7b2cff)
        .setTitle(`Ticket #${formatTicketNumber(ticket.number)} wurde erstellt`)
        .setDescription(`Dein Anliegen **${finalized.subject}** wurde an unsere Ticket Mods weitergeleitet.\n\n[Zum Ticket](${link})`)
        .setFooter({ text: 'Loco Night Cup Support' })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  } catch (error) {
    updateTicket(ticket.number, current => ({
      ...current,
      status: 'failed',
      failureReason: String(error?.message || error).slice(0, 500),
    }));
    throw error;
  }
}

async function handleClaim(interaction, client, number) {
  const settings = readSettings();
  await requireTicketMod(interaction, settings);
  let ticket = getTicket(number);
  if (!ticket || ticket.status === 'closed') throw new Error('Dieses Ticket ist bereits geschlossen oder nicht mehr verfügbar.');
  if (ticket.claimedById && ticket.claimedById !== interaction.user.id) {
    throw new Error(`Dieses Ticket wurde bereits von <@${ticket.claimedById}> übernommen.`);
  }
  ticket = updateTicket(number, current => ({
    ...current,
    status: 'in_progress',
    claimedById: interaction.user.id,
    claimedAt: current.claimedAt || new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  }));
  await refreshTicketMessage(client, ticket);
  await replyEphemeral(interaction, '✅ Du hast das Ticket übernommen.');
}

async function handleAddUser(interaction, number) {
  const settings = readSettings();
  await requireTicketMod(interaction, settings);
  const ticket = getTicket(number);
  if (!ticket || ticket.status === 'closed') throw new Error('Dieses Ticket ist bereits geschlossen oder nicht mehr verfügbar.');
  await replyEphemeral(interaction, {
    content: 'Wähle die Person aus, die Zugriff auf dieses Ticket erhalten soll.',
    components: buildUserSelect(number),
  });
}

async function handleUserSelect(interaction, client, number) {
  const settings = readSettings();
  await requireTicketMod(interaction, settings);
  const ticket = getTicket(number);
  if (!ticket || ticket.status === 'closed') throw new Error('Dieses Ticket ist bereits geschlossen oder nicht mehr verfügbar.');
  const userId = interaction.values?.[0];
  const selected = userId ? await interaction.guild.members.fetch(userId).catch(() => null) : null;
  if (!selected || selected.user.bot) throw new Error('Dieses Servermitglied kann nicht hinzugefügt werden.');
  if (!roleLabelForMember(selected, settings) && !isTicketMod(selected, settings)) {
    throw new Error('Die ausgewählte Person benötigt die Manager-, Spieler- oder Ticket-Mod-Rolle, um den privaten Thread sehen zu können.');
  }
  const thread = await fetchTicketThread(client, ticket);
  if (!thread) throw new Error('Der private Ticket-Thread wurde nicht gefunden.');
  await thread.members.add(selected.id);
  updateTicket(number, current => ({
    ...current,
    participantIds: [...new Set([...(current.participantIds || []), selected.id])],
    lastActivityAt: new Date().toISOString(),
  }));
  await thread.send({
    content: `<@${selected.id}> wurde von <@${interaction.user.id}> zu diesem Ticket hinzugefügt.`,
    allowedMentions: { parse: [], users: [selected.id, interaction.user.id] },
  });
  await interaction.update({ content: `✅ ${selected.displayName} wurde hinzugefügt.`, components: [] });
}

async function handleCloseRequest(interaction, number) {
  const settings = readSettings();
  await requireTicketMod(interaction, settings);
  const ticket = getTicket(number);
  if (!ticket || ticket.status === 'closed') throw new Error('Dieses Ticket ist bereits geschlossen oder nicht mehr verfügbar.');
  await replyEphemeral(interaction, {
    content: `Möchtest du Ticket #${formatTicketNumber(number)} wirklich schließen?`,
    components: buildCloseConfirmation(number),
  });
}

async function handleCloseConfirm(interaction, number) {
  const settings = readSettings();
  await requireTicketMod(interaction, settings);
  const ticket = getTicket(number);
  if (!ticket || ticket.status === 'closed') throw new Error('Dieses Ticket ist bereits geschlossen oder nicht mehr verfügbar.');
  await interaction.showModal(buildCloseModal(number));
}

async function fetchAllMessages(thread) {
  const all = [];
  let before;
  while (true) {
    const page = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!page.size) break;
    all.push(...page.values());
    before = page.last().id;
    if (page.size < 100) break;
  }
  return all.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
}

async function sendRatingRequest(client, ticket) {
  const user = await client.users.fetch(String(ticket.creatorId)).catch(() => null);
  if (!user) return false;
  const message = await user.send({
    embeds: [new EmbedBuilder()
      .setColor(0x7b2cff)
      .setTitle(`Wie zufrieden warst du mit Ticket #${formatTicketNumber(ticket.number)}?`)
      .setDescription('Wähle zwischen einem und fünf Sternen. Anschließend kannst du uns optional noch etwas mitteilen.')
      .setFooter({ text: 'Loco Night Cup Support' })],
    components: buildRatingComponents(ticket.number),
    allowedMentions: { parse: [] },
  }).catch(() => null);
  if (!message) return false;
  updateTicket(ticket.number, current => ({ ...current, ratingDmSent: true, ratingMessageId: message.id }));
  return true;
}

async function handleCloseModal(interaction, client, number) {
  const settings = readSettings();
  await requireTicketMod(interaction, settings);
  let ticket = getTicket(number);
  if (!ticket || ticket.status === 'closed') throw new Error('Dieses Ticket ist bereits geschlossen oder nicht mehr verfügbar.');
  await interaction.deferReply({ flags: EPHEMERAL });
  const thread = await fetchTicketThread(client, ticket);
  if (!thread) throw new Error('Der private Ticket-Thread wurde nicht gefunden.');
  const timestamp = new Date().toISOString();
  ticket = updateTicket(number, current => {
    if (current.status === 'closed') throw new Error('Dieses Ticket wurde bereits geschlossen.');
    return {
      ...current,
      status: 'closed',
      closedById: interaction.user.id,
      closeReason: interaction.fields.getTextInputValue('close_reason').trim(),
      closedAt: timestamp,
      lastActivityAt: timestamp,
    };
  });
  await refreshTicketMessage(client, ticket).catch(() => false);
  await thread.send({
    content: `🔒 Dieses Ticket wurde von <@${interaction.user.id}> geschlossen.\n**Grund:** ${ticket.closeReason}`,
    allowedMentions: { parse: [], users: [interaction.user.id] },
  }).catch(() => null);
  const transcriptMessages = await fetchAllMessages(thread).catch(error => {
    console.warn(`[tickets] Verlauf für Ticket #${number} konnte nicht vollständig geladen werden: ${error.message}`);
    return [];
  });
  const transcript = buildTranscript(ticket, transcriptMessages);
  const logChannel = settings.channels?.ticketLogChannelId
    ? await client.channels.fetch(String(settings.channels.ticketLogChannelId)).catch(() => null)
    : null;
  let logged = false;
  if (logChannel?.send) {
    const fileName = `ticket-${formatTicketNumber(number)}-verlauf.txt`;
    const logMessage = await logChannel.send({
      embeds: [buildLogEmbed(ticket)],
      files: [new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: fileName })],
      allowedMentions: { parse: [] },
    }).catch(error => {
      console.warn(`[tickets] Log für Ticket #${number} konnte nicht gesendet werden: ${error.message}`);
      return null;
    });
    if (logMessage) {
      logged = true;
      ticket = updateTicket(number, current => ({ ...current, logMessageId: logMessage.id }));
    }
  }
  await sendRatingRequest(client, ticket).catch(error => {
    console.warn(`[tickets] Bewertungs-PN für Ticket #${number} fehlgeschlagen: ${error.message}`);
    return false;
  });
  await interaction.editReply({
    content: logged
      ? `✅ Ticket #${formatTicketNumber(number)} wurde geschlossen und protokolliert.`
      : `⚠️ Ticket #${formatTicketNumber(number)} wurde geschlossen, das Protokoll konnte aber nicht im Log-Kanal gespeichert werden.`,
  });
  await thread.setLocked(true, 'Ticket geschlossen').catch(() => null);
  await thread.setArchived(true, 'Ticket geschlossen').catch(() => null);
}

async function handleRatingButton(interaction, number, rating) {
  const ticket = getTicket(number);
  if (!ticket || ticket.status !== 'closed' || String(ticket.creatorId) !== String(interaction.user.id)) {
    throw new Error('Diese Bewertung gehört nicht zu deinem Ticket.');
  }
  if (ticket.rating) throw new Error('Du hast dieses Ticket bereits bewertet.');
  await interaction.showModal(buildRatingModal(number, rating));
}

async function handleRatingModal(interaction, client, number, rating) {
  let ticket = getTicket(number);
  if (!ticket || ticket.status !== 'closed' || String(ticket.creatorId) !== String(interaction.user.id)) {
    throw new Error('Diese Bewertung gehört nicht zu deinem Ticket.');
  }
  if (ticket.rating) throw new Error('Du hast dieses Ticket bereits bewertet.');
  ticket = updateTicket(number, current => ({
    ...current,
    rating,
    ratingFeedback: interaction.fields.getTextInputValue('rating_feedback').trim() || null,
    ratingAt: new Date().toISOString(),
  }));
  const settings = readSettings();
  const logChannel = settings.channels?.ticketLogChannelId
    ? await client.channels.fetch(String(settings.channels.ticketLogChannelId)).catch(() => null)
    : null;
  if (logChannel && ticket.logMessageId) {
    const logMessage = await logChannel.messages.fetch(String(ticket.logMessageId)).catch(() => null);
    if (logMessage) await logMessage.edit({ embeds: [buildLogEmbed(ticket)], allowedMentions: { parse: [] } });
  }
  await interaction.reply({
    content: `Danke für deine Bewertung mit ${'⭐'.repeat(rating)}!`,
    allowedMentions: { parse: [] },
  });
}

async function handleInteraction(interaction, client) {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
      await handleCategorySelect(interaction);
      return true;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_create_modal:')) {
      const category = interaction.customId.split(':')[1];
      await createTicketFromModal(interaction, client, category);
      return true;
    }
    if (interaction.isButton() && parseNumber(interaction.customId, 'ticket_claim')) {
      await handleClaim(interaction, client, parseNumber(interaction.customId, 'ticket_claim'));
      return true;
    }
    if (interaction.isButton() && parseNumber(interaction.customId, 'ticket_add_user')) {
      await handleAddUser(interaction, parseNumber(interaction.customId, 'ticket_add_user'));
      return true;
    }
    if (interaction.isUserSelectMenu() && parseNumber(interaction.customId, 'ticket_user_select')) {
      await handleUserSelect(interaction, client, parseNumber(interaction.customId, 'ticket_user_select'));
      return true;
    }
    if (interaction.isButton() && parseNumber(interaction.customId, 'ticket_close')) {
      await handleCloseRequest(interaction, parseNumber(interaction.customId, 'ticket_close'));
      return true;
    }
    if (interaction.isButton() && parseNumber(interaction.customId, 'ticket_close_confirm')) {
      await handleCloseConfirm(interaction, parseNumber(interaction.customId, 'ticket_close_confirm'));
      return true;
    }
    if (interaction.isButton() && parseNumber(interaction.customId, 'ticket_close_cancel')) {
      await interaction.update({ content: 'Schließen abgebrochen.', components: [] });
      return true;
    }
    if (interaction.isModalSubmit() && parseNumber(interaction.customId, 'ticket_close_modal')) {
      await handleCloseModal(interaction, client, parseNumber(interaction.customId, 'ticket_close_modal'));
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith('ticket_rate:')) {
      const [, number, rating] = interaction.customId.split(':').map((value, index) => index ? Number(value) : value);
      if (!Number.isInteger(number) || !Number.isInteger(rating) || rating < 1 || rating > 5) return false;
      await handleRatingButton(interaction, number, rating);
      return true;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_rating_modal:')) {
      const parts = interaction.customId.split(':');
      const number = Number(parts[1]);
      const rating = Number(parts[2]);
      if (!Number.isInteger(number) || !Number.isInteger(rating) || rating < 1 || rating > 5) return false;
      await handleRatingModal(interaction, client, number, rating);
      return true;
    }
    return false;
  } catch (error) {
    const message = error?.message || 'Das Ticket-System konnte diese Aktion nicht ausführen.';
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, components: [] }).catch(() => null);
    else await interaction.reply({ content: message, flags: interaction.guild ? EPHEMERAL : undefined }).catch(() => null);
    return true;
  }
}

module.exports = {
  createTicketFromModal,
  fetchAllMessages,
  handleInteraction,
  isTicketMod,
  parseNumber,
  refreshTicketMessage,
  roleLabelForMember,
};
