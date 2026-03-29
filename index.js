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
  AttachmentBuilder,
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

function getRegisteredTeamsChannelId() {
  return process.env.REGISTERED_TEAMS_CHANNEL_ID || process.env.TEAMS_OVERVIEW_CHANNEL_ID;
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

function parseUserId(input) {
  if (!input) return null;

  const trimmed = input.trim();

  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];

  const idMatch = trimmed.match(/^(\d{16,20})$/);
  if (idMatch) return idMatch[1];

  return null;
}

function formatUserMention(userId) {
  return userId ? `<@${userId}>` : '—';
}

function buildRegisteredTeamsEmbed(teams) {
  const sortedTeams = [...teams].sort((a, b) => {
    return (a.clubName || '').localeCompare(b.clubName || '', 'de');
  });

  const lines = sortedTeams.map((team, index) => {
    const coManagers =
      team.coManagerIds && team.coManagerIds.length > 0
        ? team.coManagerIds.map(id => `<@${id}>`).join(', ')
        : 'Keine';

    return `**${index + 1}. ${team.clubName}**
Vereinsmanager: <@${team.managerId}>
Co-VM: ${coManagers}`;
  });

  return new EmbedBuilder()
    .setTitle('🏆 Registrierte Teams')
    .setDescription(lines.length > 0 ? lines.join('\n\n') : 'Noch keine Teams registriert.')
    .setColor(0xff0000);
}

async function refreshRegisteredTeams(guild) {
  try {
    const setupData = readSetupData();
    const teams = readTeams();

    const channelId = getRegisteredTeamsChannelId();
    const registeredTeamsChannel = guild.channels.cache.get(channelId);

    if (!registeredTeamsChannel) {
      console.error('❌ Kanal für registrierte Teams nicht gefunden.');
      return;
    }

    const embed = buildRegisteredTeamsEmbed(teams);

    if (setupData.registeredTeamsMessageId) {
      try {
        const oldMessage = await registeredTeamsChannel.messages.fetch(setupData.registeredTeamsMessageId);
        await oldMessage.edit({ embeds: [embed] });
        return;
      } catch (error) {
        console.warn('⚠️ Alte registrierte Teams Nachricht nicht gefunden, poste neu.');
      }
    }

    const newMessage = await registeredTeamsChannel.send({ embeds: [embed] });

    setupData.registeredTeamsChannelId = registeredTeamsChannel.id;
    setupData.registeredTeamsMessageId = newMessage.id;
    writeSetupData(setupData);
  } catch (error) {
    console.error('❌ Fehler beim Aktualisieren der registrierten Teams:', error);
  }
}

function findTeamByManagerOrCoManager(userId) {
  const teams = readTeams();

  return teams.find(team => {
    const isManager = team.managerId === userId;
    const isCoManager = Array.isArray(team.coManagerIds) && team.coManagerIds.includes(userId);
    return isManager || isCoManager;
  });
}

async function sendMyTeamOverview(interaction, team) {
  const coManagers =
    team.coManagerIds && team.coManagerIds.length > 0
      ? team.coManagerIds.map(id => `<@${id}>`).join(', ')
      : 'Keine';

  const embed = new EmbedBuilder()
    .setTitle(team.clubName)
    .setDescription([
      `**Vereinsmanager:** ${formatUserMention(team.managerId)}`,
      `**Co-VM:** ${coManagers}`,
    ].join('\n'))
    .setColor(0xff0000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('team_add_covm_open')
      .setLabel('➕ Co-VM hinzufügen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('team_delete_open')
      .setLabel('🗑️ Team abmelden')
      .setStyle(ButtonStyle.Danger)
  );

  if (team.logoFile) {
    const logoPath = path.join(logosDir, team.logoFile);

    if (fs.existsSync(logoPath)) {
      const attachment = new AttachmentBuilder(logoPath, { name: team.logoFile });
      embed.setImage(`attachment://${team.logoFile}`);

      return interaction.reply({
        embeds: [embed],
        components: [row],
        files: [attachment],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  return interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

client.once(Events.ClientReady, async readyClient => {
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

client.on(Events.InteractionCreate, async interaction => {
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

        if (setupData.teamPanelMessageId && setupData.registeredTeamsMessageId) {
          return interaction.reply({
            content: '❌ Team-Setup wurde bereits erstellt.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const teamRegisterChannel = guild.channels.cache.get(process.env.TEAM_REGISTER_CHANNEL_ID);
        const registeredTeamsChannel = guild.channels.cache.get(getRegisteredTeamsChannelId());

        if (!teamRegisterChannel || !registeredTeamsChannel) {
          return interaction.reply({
            content: '❌ Team-Anmelde- oder Registrierte-Teams-Kanal nicht gefunden. Prüfe deine Railway Variables.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const teamPanelEmbed = new EmbedBuilder()
          .setTitle('📝 Team-Verwaltung')
          .setDescription(
            'Hier kannst du dein Team verwalten.\n\n' +
            '• **Team anmelden** → EA FC Clubname eingeben und danach Logo hochladen\n' +
            '• **Co-VM hinzufügen** → nur der Vereinsmanager kann Co-VMs hinzufügen\n' +
            '• **Mein Team** → private Übersicht deines Teams\n' +
            '• **Team abmelden** → nur der Vereinsmanager kann das Team löschen'
          )
          .setColor(0xff0000);

        const teamPanelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('team_register_open')
            .setLabel('📝 Team anmelden')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('team_add_covm_open')
            .setLabel('➕ Co-VM hinzufügen')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('team_show_mine')
            .setLabel('📋 Mein Team')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('team_delete_open')
            .setLabel('🗑️ Team abmelden')
            .setStyle(ButtonStyle.Danger)
        );

        const panelMessage = await teamRegisterChannel.send({
          embeds: [teamPanelEmbed],
          components: [teamPanelRow],
        });

        const registeredTeamsEmbed = buildRegisteredTeamsEmbed(readTeams());
        const registeredTeamsMessage = await registeredTeamsChannel.send({
          embeds: [registeredTeamsEmbed],
        });

        writeSetupData({
          ...setupData,
          teamPanelChannelId: teamRegisterChannel.id,
          teamPanelMessageId: panelMessage.id,
          registeredTeamsChannelId: registeredTeamsChannel.id,
          registeredTeamsMessageId: registeredTeamsMessage.id,
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

      // Rollenwahl
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

      // Team anmelden
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

        const clubNameInput = new TextInputBuilder()
          .setCustomId('club_name')
          .setLabel('EA FC Clubname')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(30)
          .setRequired(true)
          .setPlaceholder('z. B. Loco Squad');

        const row = new ActionRowBuilder().addComponents(clubNameInput);
        modal.addComponents(row);

        return interaction.showModal(modal);
      }

      // Mein Team
      if (interaction.customId === 'team_show_mine') {
        const team = findTeamByManagerOrCoManager(interaction.user.id);

        if (!team) {
          return interaction.reply({
            content: '❌ Du bist aktuell keinem Team zugeordnet.',
            flags: MessageFlags.Ephemeral,
          });
        }

        return sendMyTeamOverview(interaction, team);
      }

      // Co-VM hinzufügen öffnen
      if (interaction.customId === 'team_add_covm_open') {
        const teams = readTeams();
        const team = teams.find(t => t.managerId === interaction.user.id);

        if (!team) {
          return interaction.reply({
            content: '❌ Nur der Vereinsmanager des Teams kann Co-VMs hinzufügen.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('team_add_covm_modal')
          .setTitle('Co-VM hinzufügen');

        const coVmInput = new TextInputBuilder()
          .setCustomId('covm_user')
          .setLabel('Discord ID oder @Erwähnung')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('@User oder 123456789012345678');

        const row = new ActionRowBuilder().addComponents(coVmInput);
        modal.addComponents(row);

        return interaction.showModal(modal);
      }

      // Team abmelden öffnen
      if (interaction.customId === 'team_delete_open') {
        const teams = readTeams();
        const team = teams.find(t => t.managerId === interaction.user.id);

        if (!team) {
          return interaction.reply({
            content: '❌ Nur der Vereinsmanager des Teams kann das Team abmelden.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('team_delete_confirm')
            .setLabel('✅ Ja, Team abmelden')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('team_delete_cancel')
            .setLabel('❌ Abbrechen')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({
          content: `Möchtest du dein Team **${team.clubName}** wirklich abmelden?`,
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'team_delete_cancel') {
        return interaction.reply({
          content: 'Abgebrochen.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'team_delete_confirm') {
        const teams = readTeams();
        const team = teams.find(t => t.managerId === interaction.user.id);

        if (!team) {
          return interaction.reply({
            content: '❌ Nur der Vereinsmanager des Teams kann das Team abmelden.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const updatedTeams = teams.filter(t => t.id !== team.id);
        writeTeams(updatedTeams);

        if (team.logoFile) {
          const logoPath = path.join(logosDir, team.logoFile);
          if (fs.existsSync(logoPath)) {
            try {
              fs.unlinkSync(logoPath);
            } catch (error) {
              console.warn('⚠️ Logo konnte nicht gelöscht werden.');
            }
          }
        }

        pendingLogoUploads.delete(interaction.user.id);
        await refreshRegisteredTeams(guild);

        return interaction.reply({
          content: `✅ Dein Team **${team.clubName}** wurde abgemeldet.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // =========================
    // MODALS
    // =========================
    if (interaction.isModalSubmit()) {
      // Team anmelden Modal
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

        const clubName = interaction.fields.getTextInputValue('club_name').trim();
        const teams = readTeams();

        let team = teams.find(t => t.managerId === interaction.user.id);

        if (team) {
          team.clubName = clubName;
          team.updatedAt = new Date().toISOString();
        } else {
          team = {
            id: `team_${Date.now()}`,
            clubName,
            managerId: interaction.user.id,
            coManagerIds: [],
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

        await refreshRegisteredTeams(guild);

        return interaction.reply({
          content:
            `✅ Dein Team **${clubName}** wurde gespeichert.\n\n` +
            `Bitte lade jetzt dein Teamlogo als Bild in <#${process.env.TEAM_REGISTER_CHANNEL_ID}> hoch.\n` +
            `Du hast dafür 10 Minuten Zeit.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Co-VM hinzufügen Modal
      if (interaction.customId === 'team_add_covm_modal') {
        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({
            content: '❌ Diese Aktion funktioniert nur auf einem Server.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const teams = readTeams();
        const team = teams.find(t => t.managerId === interaction.user.id);

        if (!team) {
          return interaction.reply({
            content: '❌ Nur der Vereinsmanager des Teams kann Co-VMs hinzufügen.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const input = interaction.fields.getTextInputValue('covm_user');
        const userId = parseUserId(input);

        if (!userId) {
          return interaction.reply({
            content: '❌ Bitte gib eine gültige Discord ID oder @Erwähnung ein.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (userId === team.managerId) {
          return interaction.reply({
            content: '❌ Der Vereinsmanager kann nicht zusätzlich Co-VM sein.',
            flags: MessageFlags.Ephemeral,
          });
        }

        try {
          await guild.members.fetch(userId);
        } catch (error) {
          return interaction.reply({
            content: '❌ Dieser User ist nicht auf dem Server.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (!Array.isArray(team.coManagerIds)) {
          team.coManagerIds = [];
        }

        if (team.coManagerIds.includes(userId)) {
          return interaction.reply({
            content: '❌ Dieser User ist bereits Co-VM.',
            flags: MessageFlags.Ephemeral,
          });
        }

        team.coManagerIds.push(userId);
        team.updatedAt = new Date().toISOString();

        writeTeams(teams);
        await refreshRegisteredTeams(guild);

        return interaction.reply({
          content: `✅ <@${userId}> wurde als Co-VM hinzugefügt.`,
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

client.on(Events.MessageCreate, async message => {
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

    await refreshRegisteredTeams(message.guild);

    try {
      await message.delete();
    } catch (error) {
      console.warn('⚠️ Logo-Nachricht konnte nicht gelöscht werden.');
    }

    const confirmMessage = await message.channel.send(
      `✅ Logo für **${team.clubName}** wurde gespeichert, <@${message.author.id}>.`
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