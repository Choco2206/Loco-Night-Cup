const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const setupFile = path.join(process.cwd(), 'data', 'setup-messages.json');

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`❌ Fehler beim Lesen von ${filePath}:`, error);
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben von ${filePath}:`, error);
  }
}

function readSetupData() {
  return readJsonSafe(setupFile, {});
}

function writeSetupData(data) {
  writeJsonSafe(setupFile, data);
}

async function handleSetupCommand(interaction) {
  const setupData = readSetupData();

  if (setupData.startMessageId && setupData.roleMessageId) {
    await interaction.reply({
      content: '❌ Setup wurde bereits erstellt.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ Dieser Command funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const startChannel = guild.channels.cache.get(process.env.START_CHANNEL_ID);
  const roleChannel = guild.channels.cache.get(process.env.ROLE_CHANNEL_ID);

  if (!startChannel || !roleChannel) {
    await interaction.reply({
      content: '❌ Start- oder Rollen-Kanal wurde nicht gefunden. Prüfe deine Railway Variables.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const startMessage = await startChannel.send({
    content: `🐺 **Willkommen beim Loco Night Cup**

Schön, dass du da bist.

Um Zugriff auf die passenden Bereiche des Servers zu bekommen, gehe bitte in den Kanal <#${process.env.ROLE_CHANNEL_ID}> und wähle dort deine Rolle aus.

Je nachdem, ob du Spieler oder Manager bist, werden dir anschließend die passenden Kanäle und Funktionen freigeschaltet.`,
  });

  const roleEmbed = new EmbedBuilder()
    .setTitle('🎭 Rolle wählen')
    .setDescription('Wähle deine Rolle, um Zugriff auf den Server zu bekommen.')
    .setColor(0xff0000);

  const roleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('role_player')
      .setLabel('🎮 Spieler')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('role_manager')
      .setLabel('🧠 Manager')
      .setStyle(ButtonStyle.Danger)
  );

  const roleMessage = await roleChannel.send({
    embeds: [roleEmbed],
    components: [roleRow],
  });

  writeSetupData({
    ...setupData,
    startChannelId: startChannel.id,
    startMessageId: startMessage.id,
    roleChannelId: roleChannel.id,
    roleMessageId: roleMessage.id,
  });

  await interaction.reply({
    content: '✅ Setup erfolgreich erstellt.',
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleRoleButtons(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await interaction.reply({
      content: '❌ Diese Aktion funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const playerRole = guild.roles.cache.get(process.env.PLAYER_ROLE_ID);
  const managerRole = guild.roles.cache.get(process.env.MANAGER_ROLE_ID);

  if (!playerRole || !managerRole) {
    await interaction.reply({
      content: '❌ Rollen wurden nicht gefunden. Prüfe PLAYER_ROLE_ID und MANAGER_ROLE_ID.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId === 'role_player') {
    if (member.roles.cache.has(managerRole.id)) {
      await member.roles.remove(managerRole);
    }

    if (!member.roles.cache.has(playerRole.id)) {
      await member.roles.add(playerRole);
    }

    await interaction.reply({
      content: '🎮 Du hast jetzt die Rolle Spieler.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (interaction.customId === 'role_manager') {
    if (member.roles.cache.has(playerRole.id)) {
      await member.roles.remove(playerRole);
    }

    if (!member.roles.cache.has(managerRole.id)) {
      await member.roles.add(managerRole);
    }

    await interaction.reply({
      content: '🧠 Du hast jetzt die Rolle Manager.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  return false;
}

module.exports = {
  async init() {},

  async handleInteraction(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      return handleSetupCommand(interaction);
    }

    if (interaction.isButton()) {
      return handleRoleButtons(interaction);
    }

    return false;
  },
};