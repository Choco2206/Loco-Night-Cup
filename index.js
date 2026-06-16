require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { bootstrapPhaseOne } = require('./src/app/bootstrap');
const teamSystem = require('./src/domain/teams');

function runBootstrap() {
  const result = bootstrapPhaseOne();
  console.log(`Phase 1 bootstrap complete: ${result.phase}`);
}

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    runBootstrap();
    console.warn('DISCORD_TOKEN is not set. Storage was initialized without starting Discord.');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, async readyClient => {
    try {
      runBootstrap();
      await teamSystem.init(client);
      console.log(`Bot online as ${readyClient.user.tag}`);
    } catch (error) {
      console.error('Startup validation failed:', error);
      process.exitCode = 1;
      client.destroy();
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (await teamSystem.handleInteraction(interaction, client)) return;
    } catch (error) {
      console.error('Interaction handling failed:', error);
    }
  });

  client.on(Events.MessageCreate, async message => {
    try {
      if (await teamSystem.handleMessage(message, client)) return;
    } catch (error) {
      console.error('Message handling failed:', error);
    }
  });

  client.on(Events.GuildMemberRemove, async member => {
    try {
      await teamSystem.handleGuildMemberRemove(member, client);
    } catch (error) {
      console.error('Guild member remove handling failed:', error);
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(error => {
  console.error('Fatal startup error:', error);
  process.exitCode = 1;
});
