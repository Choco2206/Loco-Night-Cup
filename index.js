require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { bootstrapPhaseOne } = require('./src/app/bootstrap');
const teamSystem = require('./src/domain/teams');
const checkinSystem = require('./src/domain/checkins');
const adminSystem = require('./src/domain/admin');
const roleSystem = require('./src/domain/roles');
const groupSystem = require('./src/domain/groups');
const knockoutSystem = require('./src/domain/knockout');
const banSystem = require('./src/domain/bans');
const liveScheduleSystem = require('./src/domain/live-schedule');
const teamOfTheTournamentSystem = require('./src/domain/team-of-the-tournament');
const { schedulePendingAutoCleanups } = require('./src/domain/events/event-cleanup-service');
const { initPendingResultConfirmations } = require('./src/domain/results/result-confirmation-service');

const EPHEMERAL = 64;

function runBootstrap() {
  const result = bootstrapPhaseOne();
  console.log(`Phase 1 bootstrap complete: ${result.phase}`);
}

function isExpectedUserError(error) {
  return error?.name === 'Error' && typeof error.message === 'string' && error.message.length > 0;
}

async function replyInteractionError(interaction, message) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message, components: [], embeds: [] }).catch(() => {});
    return;
  }

  await interaction.reply({ content: message, flags: EPHEMERAL }).catch(() => {});
}

async function handleInteractionError(interaction, error) {
  if (isExpectedUserError(error)) {
    await replyInteractionError(interaction, error.message);
    return;
  }

  console.error('Interaction handling failed:', error);
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
      await checkinSystem.init(client);
      await adminSystem.init(client);
      await roleSystem.init(client);
      await banSystem.initBanService(client);
      await groupSystem.init(client);
      await knockoutSystem.initKnockoutReleases(client);
      await teamOfTheTournamentSystem.initTeamOfTheTournament(client);
      initPendingResultConfirmations(client);
      await liveScheduleSystem.refreshLiveScheduleForActiveEvents(client);
      schedulePendingAutoCleanups(client);
      console.log(`Bot online as ${readyClient.user.tag}`);
    } catch (error) {
      console.error('Startup validation failed:', error);
      process.exitCode = 1;
      client.destroy();
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (await adminSystem.handleInteraction(interaction, client)) return;
      if (await groupSystem.handleGroupInteraction(interaction, client)) return;
      if (await knockoutSystem.handleKnockoutInteraction(interaction, client)) return;
      if (await roleSystem.handleInteraction(interaction, client)) return;
      if (await teamSystem.handleInteraction(interaction, client)) return;
      if (await checkinSystem.handleInteraction(interaction, client)) return;
    } catch (error) {
      await handleInteractionError(interaction, error);
    }
  });

  client.on(Events.MessageCreate, async message => {
    try {
      if (await groupSystem.handleGroupMessage(message, client)) return;
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
