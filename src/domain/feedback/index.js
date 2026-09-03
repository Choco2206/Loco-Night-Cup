'use strict';

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { FILES, readJson } = require('../../storage');
const { createSettingsDefault } = require('../../storage/defaults');
const feedbackBannerBase64 = require('./feedback-banner');

const FORUM_CHANNEL_ID = '1544972269808394260';
const EPHEMERAL = 64;
const STORE_FILE = path.resolve(process.cwd(), 'data', 'feedback.json');
const BANNER_FILE = path.resolve(process.cwd(), 'data', 'generated-assets', 'loco-night-cup-feedback-v2.jpg');
const BANNER_NAME = 'loco-night-cup-feedback-v2.jpg';

const CATEGORIES = {
  cup: { label: 'Cup & Turnierablauf', emoji: '🏆' },
  systems: { label: 'Bot & Systeme', emoji: '🤖' },
  moderation: { label: 'Moderation & Community', emoji: '🛡️' },
  discord: { label: 'Discord & Gestaltung', emoji: '🎨' },
  idea: { label: 'Neue Idee', emoji: '💡' },
  other: { label: 'Sonstiges', emoji: '📦' },
};

const STATUSES = {
  received: { label: 'Eingegangen', emoji: '📨' },
  review: { label: 'In Prüfung', emoji: '👀' },
  question: { label: 'Rückfrage', emoji: '🗣️' },
  planned: { label: 'Vorgemerkt', emoji: '📋' },
  progress: { label: 'In Umsetzung', emoji: '🛠️' },
  done: { label: 'Umgesetzt', emoji: '✅' },
  rejected: { label: 'Nicht vorgesehen', emoji: '❌' },
};

function readSettings() {
  return readJson(FILES.settings, createSettingsDefault());
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return { nextNumber: Math.max(1, Number(parsed.nextNumber) || 1), panelThreadId: parsed.panelThreadId || null, feedback: parsed.feedback || {} };
  } catch (_) {
    return { nextNumber: 1, panelThreadId: null, feedback: {} };
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const temporary = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, STORE_FILE);
}

function formatNumber(number) {
  return String(number).padStart(4, '0');
}

function tagName(item) {
  return `${item.emoji} ${item.label}`;
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle('🐺 DEINE MEINUNG. UNSER CUP.')
    .setDescription([
      'Der **Loco Night Cup** steht für die Community und lebt von der Community. Deshalb ist uns eure ehrliche Meinung wichtig.',
      '',
      'Egal ob Cup-Ablauf, Bot-Systeme, Moderation, Discord oder eine komplett neue Idee: Konstruktives Feedback hilft uns dabei, den Loco Night Cup gemeinsam mit euch weiterzuentwickeln.',
      '',
      'Erstelle über **Neuer Beitrag** beziehungsweise das **Plus** direkt dein Feedback und wähle den passenden Kategorie-Tag aus. Anschließend kann die Community deine Idee diskutieren und bewerten.',
      '',
      '> Bitte bleibt fair, respektvoll und möglichst konkret. Persönliche Beschwerden und Regelverstöße gehören weiterhin in den Ticket-Support.',
    ].join('\n'))
    .setFooter({ text: 'Gemeinsam machen wir die Nacht noch besser. 🌙🏆' });
}

function categoryMenu() {
  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('feedback_category')
      .setPlaceholder('Worum geht es bei deinem Feedback?')
      .addOptions(Object.entries(CATEGORIES).map(([value, item]) => ({ value, label: item.label, emoji: item.emoji }))),
  )];
}

function feedbackModal(category) {
  return new ModalBuilder()
    .setCustomId(`feedback_modal:${category}`)
    .setTitle(`Feedback: ${CATEGORIES[category].label}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('title').setLabel('Kurzer Titel').setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(80).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('feedback').setLabel('Dein Feedback').setStyle(TextInputStyle.Paragraph).setMinLength(15).setMaxLength(1000).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('suggestion').setLabel('Was würdest du konkret ändern?').setStyle(TextInputStyle.Paragraph).setMaxLength(750).setRequired(false)),
    );
}

function statusComponents(number, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`feedback_status:${number}`).setLabel('Status ändern').setEmoji('⚙️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  )];
}

function statusMenu(number) {
  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`feedback_status_select:${number}`).setPlaceholder('Neuen Status auswählen')
      .addOptions(Object.entries(STATUSES).map(([value, item]) => ({ value, label: item.label, emoji: item.emoji }))),
  )];
}

function feedbackEmbed(entry) {
  const category = CATEGORIES[entry.category];
  const status = STATUSES[entry.status];
  const embed = new EmbedBuilder()
    .setColor(entry.status === 'done' ? 0x2ecc71 : entry.status === 'rejected' ? 0xe74c3c : 0x7b2cff)
    .setTitle(`💡 FEEDBACK #${formatNumber(entry.number)}`)
    .addFields(
      { name: 'Kategorie', value: `${category.emoji} ${category.label}`, inline: true },
      { name: 'Von', value: `<@${entry.creatorId}>`, inline: true },
      { name: 'Status', value: `${status.emoji} ${status.label}`, inline: true },
      { name: 'Titel', value: entry.title },
      { name: 'Feedback', value: entry.feedback },
    )
    .setFooter({ text: 'Stimme mit 👍 ab und diskutiere respektvoll im Beitrag.' })
    .setTimestamp(new Date(entry.createdAt));
  if (entry.suggestion) embed.addFields({ name: 'Konkreter Vorschlag', value: entry.suggestion });
  return embed;
}

async function memberFor(interaction) {
  return interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
}

function eligible(member, settings) {
  return Boolean(member && [settings.roles?.managerRoleId, settings.roles?.playerRoleId]
    .filter(Boolean).some(roleId => member.roles.cache.has(String(roleId))));
}

function moderator(member, settings) {
  return Boolean(member && (member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageThreads)
    || (settings.roles?.ticketModRoleId && member.roles.cache.has(String(settings.roles.ticketModRoleId)))));
}

async function forum(client) {
  const channel = await client.channels.fetch(FORUM_CHANNEL_ID).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildForum) throw new Error(`Feedback-Forum ${FORUM_CHANNEL_ID} wurde nicht gefunden.`);
  return channel;
}

async function ensureTags(channel) {
  const tags = [...channel.availableTags];
  for (const item of Object.values(CATEGORIES)) {
    const name = tagName(item);
    if (!tags.some(tag => tag.name === name)) tags.push({ name, moderated: false });
  }
  for (const item of Object.values(STATUSES)) {
    const name = tagName(item);
    const index = tags.findIndex(tag => tag.name === name);
    if (index === -1) tags.push({ name, moderated: true });
    else tags[index] = { ...tags[index], moderated: true };
  }
  if (tags.length > 20) throw new Error('Feedback-Forum: Es sind zu viele Tags vorhanden. Discord erlaubt maximal 20.');
  await channel.setAvailableTags(tags, 'Feedback-Kategorien und Status synchronisieren');
  return channel.availableTags;
}

function findTag(channel, item) {
  return channel.availableTags.find(tag => tag.name === tagName(item))?.id;
}

async function ensurePanel(channel) {
  if (!fs.existsSync(BANNER_FILE)) {
    fs.mkdirSync(path.dirname(BANNER_FILE), { recursive: true });
    fs.writeFileSync(BANNER_FILE, Buffer.from(feedbackBannerBase64, 'base64'));
  }
  const store = readStore();
  let thread = store.panelThreadId ? await channel.threads.fetch(store.panelThreadId).catch(() => null) : null;
  const embed = panelEmbed();
  const payload = { embeds: [embed], components: [], allowedMentions: { parse: [] } };
  if (fs.existsSync(BANNER_FILE)) {
    embed.setImage(`attachment://${BANNER_NAME}`);
    payload.files = [new AttachmentBuilder(BANNER_FILE, { name: BANNER_NAME })];
  }
  if (!thread) {
    thread = await channel.threads.create({ name: '💡 Feedback abgeben', message: payload, reason: 'Loco Night Cup Feedback-Panel' });
    store.panelThreadId = thread.id;
    writeStore(store);
  } else {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) await starter.edit(payload);
  }
  return thread;
}

async function init(client) {
  const channel = await forum(client);
  await ensureTags(channel);
  await ensurePanel(channel);
  return channel;
}

async function createFeedback(interaction, client, category) {
  const settings = readSettings();
  const member = await memberFor(interaction);
  if (!eligible(member, settings)) throw new Error('Du benötigst die Manager- oder Spielerrolle, um Feedback abzugeben.');
  const channel = await forum(client);
  const store = readStore();
  const number = store.nextNumber++;
  const entry = {
    number,
    category,
    status: 'received',
    creatorId: interaction.user.id,
    creatorName: interaction.user.tag || interaction.user.username,
    title: interaction.fields.getTextInputValue('title').trim(),
    feedback: interaction.fields.getTextInputValue('feedback').trim(),
    suggestion: interaction.fields.getTextInputValue('suggestion').trim() || null,
    createdAt: new Date().toISOString(),
    threadId: null,
    starterMessageId: null,
  };
  store.feedback[String(number)] = entry;
  writeStore(store);
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const appliedTags = [findTag(channel, CATEGORIES[category]), findTag(channel, STATUSES.received)].filter(Boolean);
    const thread = await channel.threads.create({
      name: `#${formatNumber(number)} | ${entry.title}`.slice(0, 100),
      appliedTags,
      message: { embeds: [feedbackEmbed(entry)], components: statusComponents(number), allowedMentions: { parse: [] } },
      reason: `Feedback #${formatNumber(number)} von ${entry.creatorName}`,
    });
    const starter = await thread.fetchStarterMessage();
    await starter.react('👍').catch(() => null);
    entry.threadId = thread.id;
    entry.starterMessageId = starter.id;
    store.feedback[String(number)] = entry;
    writeStore(store);
    await interaction.editReply({ content: `✅ Danke! Dein Feedback wurde veröffentlicht: https://discord.com/channels/${interaction.guild.id}/${thread.id}` });
  } catch (error) {
    delete store.feedback[String(number)];
    writeStore(store);
    throw error;
  }
}

async function updateStatus(interaction, client, number, statusKey) {
  const settings = readSettings();
  const member = await memberFor(interaction);
  if (!moderator(member, settings)) throw new Error('Nur Mods können den Feedback-Status ändern.');
  const store = readStore();
  const entry = store.feedback[String(number)];
  if (!entry || !STATUSES[statusKey]) throw new Error('Dieses Feedback wurde nicht gefunden.');
  const channel = await forum(client);
  const thread = await channel.threads.fetch(entry.threadId).catch(() => null);
  if (!thread) throw new Error('Der Feedback-Beitrag wurde nicht gefunden.');
  entry.status = statusKey;
  entry.updatedAt = new Date().toISOString();
  entry.updatedById = interaction.user.id;
  store.feedback[String(number)] = entry;
  writeStore(store);
  const categoryTag = findTag(channel, CATEGORIES[entry.category]);
  const statusTag = findTag(channel, STATUSES[statusKey]);
  await thread.setAppliedTags([categoryTag, statusTag].filter(Boolean));
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (starter) await starter.edit({ embeds: [feedbackEmbed(entry)], components: statusComponents(number, ['done', 'rejected'].includes(statusKey)), allowedMentions: { parse: [] } });
  await interaction.update({ content: `✅ Status geändert: ${STATUSES[statusKey].emoji} ${STATUSES[statusKey].label}`, components: [] });
}

async function handleInteraction(interaction, client) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'feedback_category') {
    const category = interaction.values[0];
    if (!CATEGORIES[category]) throw new Error('Diese Feedback-Kategorie ist ungültig.');
    await interaction.showModal(feedbackModal(category));
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('feedback_modal:')) {
    const category = interaction.customId.split(':')[1];
    if (!CATEGORIES[category]) throw new Error('Diese Feedback-Kategorie ist ungültig.');
    await createFeedback(interaction, client, category);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('feedback_status:')) {
    const number = Number(interaction.customId.split(':')[1]);
    const settings = readSettings();
    const member = await memberFor(interaction);
    if (!moderator(member, settings)) throw new Error('Nur Mods können den Feedback-Status ändern.');
    await interaction.reply({ content: `Status für Feedback #${formatNumber(number)} ändern:`, components: statusMenu(number), flags: EPHEMERAL });
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('feedback_status_select:')) {
    const number = Number(interaction.customId.split(':')[1]);
    await updateStatus(interaction, client, number, interaction.values[0]);
    return true;
  }
  return false;
}

module.exports = { CATEGORIES, FORUM_CHANNEL_ID, STATUSES, handleInteraction, init };
