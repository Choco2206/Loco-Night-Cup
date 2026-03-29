require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const { ensureDataFolders, ensureJsonFiles } = require('./utils/storage');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

client.once('ready', async () => {
  try {
    ensureDataFolders();
    ensureJsonFiles();
    console.log(`✅ Bot online als ${client.user.tag}`);
  } catch (err) {
    console.error('❌ Fehler beim Start:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') {
        const embed = new EmbedBuilder()
          .setTitle('🐺 Loco Night Cup')
          .setDescription('Wähle deine Rolle, um Zugriff auf den Server zu bekommen.')
          .setColor(0xff0000);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('role_player')
            .setLabel('🎮 Spieler')
            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()
            .setCustomId('role_manager')
            .setLabel('🧠 Manager')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });

        await interaction.reply({
          content: '✅ Setup erstellt!',
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      const member = interaction.member;
      const guild = interaction.guild;

      const playerRole = guild.roles.cache.get(process.env.PLAYER_ROLE_ID);
      const managerRole = guild.roles.cache.get(process.env.MANAGER_ROLE_ID);

      if (!playerRole || !managerRole) {
        return interaction.reply({
          content: '❌ Rollen wurden nicht gefunden. Prüfe deine Railway Variables.',
          ephemeral: true
        });
      }

      if (interaction.customId === 'role_player') {
        if (member.roles.cache.has(managerRole.id)) {
          await member.roles.remove(managerRole);
        }

        await member.roles.add(playerRole);

        return interaction.reply({
          content: '🎮 Du hast jetzt die Rolle Spieler.',
          ephemeral: true
        });
      }

      if (interaction.customId === 'role_manager') {
        if (member.roles.cache.has(playerRole.id)) {
          await member.roles.remove(playerRole);
        }

        await member.roles.add(managerRole);

        return interaction.reply({
          content: '🧠 Du hast jetzt die Rolle Manager.',
          ephemeral: true
        });
      }
    }
  } catch (error) {
    console.error('❌ Fehler bei interactionCreate:', error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Es gab einen Fehler.',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);