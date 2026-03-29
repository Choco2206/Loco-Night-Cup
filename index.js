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
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
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
const teamsFile = path.join(process.cwd(), 'data', 'teams.json');
const logosDir = path.join(process.cwd(), 'data', 'logos');

const pendingLogoUploads = new Map();

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

function readTeams() {
  return readJsonSafe(teamsFile, []);
}

function writeTeams(data) {
  writeJsonSafe(teamsFile, data);
}

function getFileExtension(attachment) {
  if (attachment.contentType) {
    if (attachment.contentType.includes('png')) return 'png';
    if (attachment.contentType.includes('jpeg')) return 'jpg';
    if (attachment.contentType.includes('jpg')) return 'jpg';
    if (attachment.contentType.includes('webp')) return 'webp';
    if (attachment.contentType.includes('gif')) return 'gif';
  }

  const url = attachment.url || '';
  const cleanUrl = url.split('?')[0].toLowerCase();

  if (cleanUrl.endsWith('.png')) return 'png';
  if (cleanUrl.endsWith('.jpg')) return 'jpg';
  if (cleanUrl.endsWith('.jpeg')) return 'jpg';
  if (cleanUrl.endsWith('.webp')) return 'webp';
  if (cleanUrl.endsWith('.gif')) return 'gif';

  return 'png';
}

function buildTeamsOverviewEmbed(teams) {
  const sortedTeams = [...teams].sort((a, b) => {
    return (a.name || '').localeCompare(b.name || '', 'de');
  });

  const lines = sortedTeams.map((team, index) => {
    const logoStatus = team.logoFile ? '✅ Logo' : '❌ Kein Logo';
    return `**${index + 1}. ${team.name}**\nManager: <@${team.managerId}>\nStatus: ${logoStatus}`;
  });

  return new EmbedBuilder()
    .setTitle('🏆 Teilnehmende Teams')
    .setDescription(
      lines.length > 0
        ? lines.join('\n\n')
        : 'Noch keine Teams angemeldet.'
    )
    .setColor(0xff0000);
}

async function refreshTeamsOverview(guild) {
  try {
    const setupData = readSetupData();
    const teams = readTeams();

    const overviewChannel = guild.channels.cache.get(process.env.TEAMS_OVERVIEW_CHANNEL_ID);
    if (!overviewChannel) {
      console.error('❌ Team-Übersichts-Kanal nicht gefunden.');
      return;
    }

    const embed = buildTeamsOverviewEmbed(teams);

    if (setupData.teamsOverviewMessageId) {
      try {
        const existingMessage = await overviewChannel.messages.fetch(setupData.teamsOverviewMessageId);
        await existingMessage.edit({ embeds: [embed] });
        return;
      } catch (error) {
        console.warn('⚠️ Übersichtsnachricht konnte nicht bearbeitet werden, poste neu.');
      }
    }

    const newMessage = await overviewChannel.send({ embeds: [embed] });

    setupData.teamsOverviewChannelId = overviewChannel.id;
    setupData.teamsOverviewMessageId = newMessage.id;
    writeSetupData(setupData);
  } catch (error) {
    console.error('❌ Fehler beim Aktualisieren der Team-Übersicht:', error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    ensureDataFolders();
    ensureJsonFiles();

    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true });
    }

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

        return interaction.reply({
          content: '✅ Setup erfolgreich erstellt.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.commandName === 'teamsetup') {
        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({
            content: '❌ Dieser Command funktioniert nur auf einem Server.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const setupData = readSetupData();

        if (setupData.teamPanelMessageId && setupData.teamsOverviewMessageId) {
          return interaction.reply({
            content: '❌ Team-Setup wurde bereits erstellt.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const teamRegisterChannel = guild.channels.cache.get(process.env.TEAM_REGISTER_CHANNEL_ID);
        const teamsOverviewChannel = guild.channels.cache.get(process.env.TEAMS_OVERVIEW_CHANNEL_ID);

        if (!teamRegisterChannel || !teamsOverviewChannel) {
          return interaction.reply({
            content: '❌ Team-Anmelde- oder Team-Übersichts-Kanal nicht gefunden. Prüfe deine Railway Variables.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const teamPanelEmbed = new EmbedBuilder()
          .setTitle('📝 Team anmelden')
          .setDescription(
            'Nur Manager können hier ein Team anlegen.\n\n' +
            '1. Klicke auf **Team anmelden**\n' +
            '2. Gib deinen Teamnamen ein\n' +
            '3. Lade danach dein Teamlogo als Bild **in diesem Kanal** hoch'
          )
          .setColor(0xff0000);

        const teamPanelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('team_register_open')
            .setLabel('📝 Team anmelden')
            .setStyle(ButtonStyle.Success)
        );

        const panelMessage = await teamRegisterChannel.send({
          embeds: [teamPanelEmbed],
          components: [teamPanelRow],
        });

        const overviewEmbed = buildTeamsOverviewEmbed(readTeams());
        const overviewMessage = await teamsOverviewChannel.send({
          embeds: [overviewEmbed],
        });

        writeSetupData({
          ...setupData,
          teamPanelChannelId: teamRegisterChannel.id,
          teamPanelMessageId: panelMessage.id,
          teamsOverviewChannelId: teamsOverviewChannel.id,
          teamsOverviewMessageId: overviewMessage.id,
        });

        return interaction.reply({
          content: '✅ Team-Setup erfolgreich erstellt.',
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

      if (interaction.customId === 'team_register_open') {
        if (!member.roles.cache.has(managerRole.id)) {
          return interaction.reply({
            content: '❌ Nur Manager dürfen ein Team anmelden.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('team_register_modal')
          .setTitle('Team anmelden');

        const nameInput = new TextInputBuilder()
          .setCustomId('team_name')
          .setLabel('Teamname')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(30)
          .setRequired(true)
          .setPlaceholder('z. B. Loco Squad');

        const firstRow = new ActionRowBuilder().addComponents(nameInput);
        modal.addComponents(firstRow);

        return interaction.showModal(modal);
      }
    }

    // =========================
    // MODALS
    // =========================
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'team_register_modal') {
        const guild = interaction.guild;
        const member = interaction.member;

        if (!guild || !member) {
          return interaction.reply({
            content: '❌ Diese Aktion funktioniert nur auf einem Server.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const managerRole = guild.roles.cache.get(process.env.MANAGER_ROLE_ID);
        if (!managerRole || !member.roles.cache.has(managerRole.id)) {
          return interaction.reply({
            content: '❌ Nur Manager dürfen ein Team anmelden.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const teamName = interaction.fields.getTextInputValue('team_name').trim();
        const teams = readTeams();

        let team = teams.find(t => t.managerId === interaction.user.id);

        if (team) {
          team.name = teamName;
          team.updatedAt = new Date().toISOString();
        } else {
          team = {
            id: `team_${Date.now()}`,
            name: teamName,
            managerId: interaction.user.id,
            logoFile: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          teams.push(team);
        }

        writeTeams(teams);

        pendingLogoUploads.set(interaction.user.id, {
          teamId: team.id,
          channelId: process.env.TEAM_REGISTER_CHANNEL_ID,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });

        await refreshTeamsOverview(guild);

        return interaction.reply({
          content:
            `✅ Dein Team **${teamName}** wurde gespeichert.\n\n` +
            `Bitte lade jetzt dein Teamlogo als Bild in <#${process.env.TEAM_REGISTER_CHANNEL_ID}> hoch.\n` +
            `Du hast dafür 10 Minuten Zeit.`,
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

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.channel.id !== process.env.TEAM_REGISTER_CHANNEL_ID) return;
    if (message.attachments.size === 0) return;

    const pending = pendingLogoUploads.get(message.author.id);
    if (!pending) return;

    if (pending.channelId !== message.channel.id) return;

    if (Date.now() > pending.expiresAt) {
      pendingLogoUploads.delete(message.author.id);
      return;
    }

    const teams = readTeams();
    const team = teams.find(t => t.id === pending.teamId && t.managerId === message.author.id);

    if (!team) {
      pendingLogoUploads.delete(message.author.id);
      return;
    }

    const attachment = message.attachments.first();
    if (!attachment) return;

    const ext = getFileExtension(attachment);
    const fileName = `${team.id}.${ext}`;
    const filePath = path.join(logosDir, fileName);

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Download fehlgeschlagen: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    team.logoFile = fileName;
    team.updatedAt = new Date().toISOString();
    writeTeams(teams);

    pendingLogoUploads.delete(message.author.id);

    await refreshTeamsOverview(message.guild);

    try {
      await message.delete();
    } catch (error) {
      console.warn('⚠️ Logo-Nachricht konnte nicht gelöscht werden.');
    }

    const confirmMessage = await message.channel.send(
      `✅ Logo für **${team.name}** wurde gespeichert, <@${message.author.id}>.`
    );

    setTimeout(async () => {
      try {
        await confirmMessage.delete();
      } catch (error) {}
    }, 8000);
  } catch (error) {
    console.error('❌ Fehler bei MessageCreate:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);