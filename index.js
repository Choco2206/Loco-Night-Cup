require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { bootstrapPhaseOne } = require('./src/app/bootstrap');

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
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, readyClient => {
    try {
      runBootstrap();
      console.log(`Bot online as ${readyClient.user.tag}`);
    } catch (error) {
      console.error('Startup validation failed:', error);
      process.exitCode = 1;
      client.destroy();
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(error => {
  console.error('Fatal startup error:', error);
  process.exitCode = 1;
});
