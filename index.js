require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { ensureDataFolders, ensureJsonFiles } = require('./utils/storage');

const roleSystem = require('./systems/role-system');
const teamSystem = require('./systems/team-system');
const checkinSystem = require('./systems/checkin-system');
const groupSystem = require('./systems/group-system');
const resultSystem = require('./systems/result-system');
const koSystem = require('./systems/ko-system');
const adminSystem = require('./systems/admin-system');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async readyClient => {
  try {
    ensureDataFolders();
    ensureJsonFiles();

    if (roleSystem.init) await roleSystem.init(client);
    if (teamSystem.init) await teamSystem.init(client);
    if (checkinSystem.init) await checkinSystem.init(client);
    if (groupSystem.init) await groupSystem.init(client);
    if (resultSystem.init) await resultSystem.init(client);
    if (koSystem.init) await koSystem.init(client);
    if (adminSystem.init) await adminSystem.init(client);

    console.log(`✅ Bot online als ${readyClient.user.tag}`);
  } catch (error) {
    console.error('❌ Fehler beim Start:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (roleSystem.handleInteraction) {
      const handled = await roleSystem.handleInteraction(interaction);
      if (handled) return;
    }

    if (teamSystem.handleInteraction) {
      const handled = await teamSystem.handleInteraction(interaction);
      if (handled) return;
    }

    if (checkinSystem.handleInteraction) {
      const handled = await checkinSystem.handleInteraction(interaction);
      if (handled) return;
    }

    if (groupSystem.handleInteraction) {
      const handled = await groupSystem.handleInteraction(interaction);
      if (handled) return;
    }

    if (resultSystem.handleInteraction) {
      const handled = await resultSystem.handleInteraction(interaction);
      if (handled) return;
    }

    if (koSystem.handleInteraction) {
      const handled = await koSystem.handleInteraction(interaction);
      if (handled) return;
    }

    if (adminSystem.handleInteraction) {
      const handled = await adminSystem.handleInteraction(interaction);
      if (handled) return;
    }
  } catch (error) {
    console.error('❌ Fehler bei InteractionCreate:', error);

    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Es gab einen Fehler.',
          flags: 64,
        });
      }
    } catch (replyError) {
      console.error('❌ Fehler beim Fehler-Reply:', replyError);
    }
  }
});

client.on(Events.MessageCreate, async message => {
  try {
    if (teamSystem.handleMessage) {
      const handled = await teamSystem.handleMessage(message);
      if (handled) return;
    }

    if (checkinSystem.handleMessage) {
      const handled = await checkinSystem.handleMessage(message);
      if (handled) return;
    }

    if (groupSystem.handleMessage) {
      const handled = await groupSystem.handleMessage(message);
      if (handled) return;
    }

    if (resultSystem.handleMessage) {
      const handled = await resultSystem.handleMessage(message);
      if (handled) return;
    }

    if (koSystem.handleMessage) {
      const handled = await koSystem.handleMessage(message);
      if (handled) return;
    }

    if (adminSystem.handleMessage) {
      const handled = await adminSystem.handleMessage(message);
      if (handled) return;
    }
  } catch (error) {
    console.error('❌ Fehler bei MessageCreate:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);