require('dotenv').config();

const { Client, EmbedBuilder, Events, GatewayIntentBits, Partials } = require('discord.js');
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
const { initPowerRanking } = require('./src/domain/power-ranking');
const { initLegacyRanking } = require('./src/domain/legacy-ranking');
const tournamentLeadershipSystem = require('./src/domain/tournament-leadership');
const royaleSystem = require('./src/domain/royale');
const videoRequestSystem = require('./src/domain/video-requests');
const facebookFeedSystem = require('./src/domain/social-media/facebook-feed');
const ticketSystem = require('./src/domain/tickets');
const feedbackSystem = require('./src/domain/feedback');

const EPHEMERAL = 64;
const WELCOME_CHANNEL_ID = '1516390719839932576';
const ROLE_SELECT_CHANNEL_ID = '1516543498113908866';

function buildWelcomeEmbed(member) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🌙 Willkommen beim Loco Night Cup!')
    .setDescription([
      'Bei uns geht es kompetitiv zu, aber immer **respektvoll, fair und erwachsen**. Wer den Cup nicht ernst nimmt, trollt oder dauerhaft negative Vibes verbreitet, ist hier falsch.',
      '',
      `## 🎭 Wähle zuerst deine Rolle in <#${ROLE_SELECT_CHANNEL_ID}>`,
      '',
      '**🎮 Spieler**',
      'Du möchtest mitspielen, aber kein eigenes Team registrieren. Du erhältst Zugriff auf die allgemeinen Bereiche, die Team- und Spielersuche sowie die Übersichten der täglichen Cup-Anmeldungen.',
      '',
      '**🧠 Manager**',
      'Du möchtest dein Team für den Loco Night Cup registrieren. Nach erfolgreicher Teamregistrierung erhältst du erweiterten Zugriff.',
      '',
      '> Wichtig: Die Teamregistrierung ist **noch keine Cup-Anmeldung**. Für einen Cup meldest du dein Team im jeweiligen Tageskanal an. Dort findest du selbstständig alle wichtigen Informationen: Startzeit, Auslosung, angemeldete Teams und den aktuellen Anmeldeplatz deines Teams.',
      '',
      'Im Kanal **Mein Team** kannst du dein Team eigenständig verwalten – zum Beispiel Co-Manager hinzufügen oder euer Logo ändern. Bitte nutze die vorhandenen Möglichkeiten und organisiere dein Team so selbstständig wie möglich.',
      '',
      '**Bleib fair, bring gute Energie mit und respektiere die Community. Genau das ist uns wichtig.**',
      '',
      'Willkommen in der Loco Night Cup Community – wir wünschen dir viel Erfolg in der Nacht! 🐺🏆',
    ].join('\n'))
    .setFooter({ text: 'Dein Loco Night Cup Team' })
    .setTimestamp();
}

async function sendWelcomeMessage(member) {
  if (member.user?.bot) return;
  const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
  if (!channel?.send) {
    console.warn(`Welcome channel ${WELCOME_CHANNEL_ID} was not found or is not writable.`);
    return;
  }
  await channel.send({
    content: `Hey <@${member.id}> – schön, dass du am Start bist!`,
    embeds: [buildWelcomeEmbed(member)],
    allowedMentions: { users: [member.id] },
  });
}

function runBootstrap() {
  const result = bootstrapPhaseOne();
  console.log(`Phase 1 bootstrap complete: ${result.phase}`);
}

async function runStartupStep(label, task) {
  console.log(`[startup] ${label} startet`);
  await task();
  console.log(`[startup] ${label} abgeschlossen`);
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async readyClient => {
    try {
      runBootstrap();
      console.log(`Bot online as ${readyClient.user.tag}`);
      await runStartupStep('Sperren', () => banSystem.initBanService(client));
      await runStartupStep('Teams', () => teamSystem.init(client));
      await runStartupStep('Check-ins', () => checkinSystem.init(client));
      await runStartupStep('Knockout Royale', () => royaleSystem.init(client));
      await runStartupStep('Turnierleitung', () => tournamentLeadershipSystem.init(client));
      await runStartupStep('Admin', () => adminSystem.init(client));
      await runStartupStep('Rollen', () => roleSystem.init(client));
      await runStartupStep('Ticket-System', () => ticketSystem.init(client));
      await runStartupStep('Feedback-System', async () => {
        try {
          await feedbackSystem.init(client);
        } catch (error) {
          console.error('[feedback] Einrichtung fehlgeschlagen; übrige Bot-Systeme starten trotzdem:', error);
        }
      });
      await runStartupStep('Gruppen', () => groupSystem.init(client));
      await runStartupStep('K.O.-Runden', () => knockoutSystem.initKnockoutReleases(client));
      await runStartupStep('Größenvideo-Anforderung', () => videoRequestSystem.init(client));
      await runStartupStep('TOTT Tracker', () => teamOfTheTournamentSystem.initTottTracker(client));
      await runStartupStep('Team of the Tournament', () => teamOfTheTournamentSystem.initTeamOfTheTournament(client));
      await runStartupStep('Loco Power Ranking', () => initPowerRanking(client));
      await runStartupStep('Loco Legacy Ranking', () => initLegacyRanking(client));
      await runStartupStep('Facebook Social Media', () => facebookFeedSystem.init(client));
      initPendingResultConfirmations(client);
      await runStartupStep('Live-Spielplan', () => liveScheduleSystem.refreshLiveScheduleForActiveEvents(client));
      schedulePendingAutoCleanups(client);
      console.log('[startup] Alle Systeme initialisiert');
    } catch (error) {
      console.error('Startup validation failed:', error);
      process.exitCode = 1;
      client.destroy();
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (await feedbackSystem.handleInteraction(interaction, client)) return;
      if (await ticketSystem.handleInteraction(interaction, client)) return;
      if (await videoRequestSystem.handleInteraction(interaction, client)) return;
      if (await tournamentLeadershipSystem.handleInteraction(interaction, client)) return;
      if (await adminSystem.handleInteraction(interaction, client)) return;
      if (await groupSystem.handleGroupInteraction(interaction, client)) return;
      if (await knockoutSystem.handleKnockoutInteraction(interaction, client)) return;
      if (await roleSystem.handleInteraction(interaction, client)) return;
      if (await teamSystem.handleInteraction(interaction, client)) return;
      if (await checkinSystem.handleInteraction(interaction, client)) return;
      if (await royaleSystem.handleRoyaleInteraction(interaction, client)) return;
    } catch (error) {
      await handleInteractionError(interaction, error);
    }
  });

  client.on(Events.MessageCreate, async message => {
    try {
      await ticketSystem.handleMessage(message, client);
      if (await groupSystem.handleGroupMessage(message, client)) return;
      if (await teamSystem.handleMessage(message, client)) return;
    } catch (error) {
      console.error('Message handling failed:', error);
    }
  });

  client.on(Events.GuildMemberAdd, async member => {
    try { await sendWelcomeMessage(member); } catch (error) { console.error('Welcome message failed:', error); }
  });

  client.on(Events.GuildMemberRemove, async member => {
    try { await teamSystem.handleGuildMemberRemove(member, client); } catch (error) { console.error('Guild member remove handling failed:', error); }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(error => {
  console.error('Fatal startup error:', error);
  process.exitCode = 1;
});
