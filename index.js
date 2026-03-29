require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  Events,
} = require('discord.js');

const { ensureDataFolders, ensureJsonFiles } = require('./utils/storage');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const setupFile = path.join(process.cwd(), 'data', 'setup-messages.json');

function readSetupData() {
  try {
    if (!fs.existsSync(setupFile)) return {};
    const raw = fs.readFileSync(setupFile, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('❌ Fehler beim Lesen von setup-messages.json:', error);
    return {};
  }
}

function writeSetupData(data) {
  try {
    fs.writeFileSync(setupFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Fehler beim Schreiben von setup-messages.json:', error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    ensureDataFolders();
    ensureJsonFiles();
    console.log(`✅ Bot online als ${readyClient.user.tag}`);
  } catch (err) {
    console.error('❌ Fehler beim Start:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // =========================
    // SLASH COMMANDS
    // =========================
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') {
        const setupData = readSetupData();

        // Prüfen, ob Setup schon erstellt wurde
        if (setupData.startMessageId && setupData.roleMessageId) {
          return interaction.reply({
            content: '❌ Setup wurde bereits erstellt.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({
            content: '❌ Dieser Command funktioniert nur auf einem Server.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const startChannel = guild.channels.cache.get(process.env.START_CHANNEL_ID);
        const roleChannel = guild.channels.cache.get(process.env.ROLE_CHANNEL_ID);

        if (!startChannel || !roleChannel) {
          return interaction.reply({
            content: '❌ Start- oder Rollen-Kanal wurde nicht gefunden. Prüfe deine Railway Variables.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // START-HIER Nachricht
        const startMessage = await startChannel.send({
          content: `🐺 **Willkommen beim Loco Night Cup**

Schön, dass du da bist.

Um Zugriff auf die passenden Bereiche des Servers zu bekommen, gehe bitte in den Kanal <#${process.env.ROLE_CHANNEL_ID}> und wähle dort deine Rolle aus.

Je nachdem, ob du Spieler oder Manager bist, werden dir anschließend die passenden Kanäle und Funktionen freigeschaltet.`,
        });

        // ROLLE-WÄHLEN Nachricht
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
          startChannelId: startChannel.id,
          startMessageId: startMessage.id,
          roleChannelId: roleChannel.id,
          roleMessageId: roleMessage.id,
        });

        return interaction.reply({
          content: '✅ Setup erfolgreich erstellt.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // =========================
    // BUTTONS
    // =========================
    if (interaction.isButton()) {
      const guild = interaction.guild;
      const member = interaction.member;

      if (!guild || !member) {
        return interaction.reply({
          content: '❌ Diese Aktion funktioniert nur auf einem Server.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const playerRole = guild.roles.cache.get(process.env.PLAYER_ROLE_ID);
      const managerRole = guild.roles.cache.get(process.env.MANAGER_ROLE_ID);

      if (!playerRole || !managerRole) {
        return interaction.reply({
          content: '❌ Rollen wurden nicht gefunden. Prüfe PLAYER_ROLE_ID und MANAGER_ROLE_ID.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'role_player') {
        if (member.roles.cache.has(managerRole.id)) {
          await member.roles.remove(managerRole);
        }

        if (!member.roles.cache.has(playerRole.id)) {
          await member.roles.add(playerRole);
        }

        return interaction.reply({
          content: '🎮 Du hast jetzt die Rolle Spieler.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'role_manager') {
        if (member.roles.cache.has(playerRole.id)) {
          await member.roles.remove(playerRole);
        }

        if (!member.roles.cache.has(managerRole.id)) {
          await member.roles.add(managerRole);
        }

        return interaction.reply({
          content: '🧠 Du hast jetzt die Rolle Manager.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (error) {
    console.error('❌ Fehler bei interactionCreate:', error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Es gab einen Fehler.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);