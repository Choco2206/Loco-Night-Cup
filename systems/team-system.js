const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  MessageFlags,
  AttachmentBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

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

function formatUserMention(userId) {
  return userId ? `<@${userId}>` : '—';
}

function findTeamByManagerOrCoManager(userId) {
  const teams = readTeams();

  return teams.find(team => {
    const isManager = team.managerId === userId;
    const isCoManager = Array.isArray(team.coManagerIds) && team.coManagerIds.includes(userId);
    return isManager || isCoManager;
  });
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
👑 Vereinsmanager: <@${team.managerId}>
🤝 Co-VM: ${coManagers}`;
  });

  return new EmbedBuilder()
    .setTitle('🏆 Registrierte Teams')
    .setDescription(lines.length > 0 ? lines.join('\n\n') : 'Noch keine Teams registriert.')
    .setColor(0xff0000);
}

async function refreshRegisteredTeams(guild) {
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
}

function buildMyTeamEmbed(team) {
  const coManagers =
    Array.isArray(team.coManagerIds) && team.coManagerIds.length > 0
      ? team.coManagerIds.map(id => `• <@${id}>`).join('\n')
      : 'Keine Co-VM eingetragen';

  const createdText = team.createdAt
    ? `<t:${Math.floor(new Date(team.createdAt).getTime() / 1000)}:R>`
    : '—';

  const updatedText = team.updatedAt
    ? `<t:${Math.floor(new Date(team.updatedAt).getTime() / 1000)}:R>`
    : '—';

  return new EmbedBuilder()
    .setTitle(`🏟️ ${team.clubName}`)
    .setColor(0xff0000)
    .addFields(
      {
        name: '👑 Vereinsmanager',
        value: formatUserMention(team.managerId),
        inline: true,
      },
      {
        name: '🤝 Co-VM Plätze',
        value: `${Array.isArray(team.coManagerIds) ? team.coManagerIds.length : 0}/3`,
        inline: true,
      },
      {
        name: '🖼️ Logo',
        value: team.logoFile ? 'Hinterlegt' : 'Kein Logo',
        inline: true,
      },
      {
        name: '🤝 Aktuelle Co-VMs',
        value: coManagers,
        inline: false,
      },
      {
        name: '📅 Erstellt',
        value: createdText,
        inline: true,
      },
      {
        name: '🛠️ Zuletzt aktualisiert',
        value: updatedText,
        inline: true,
      }
    )
    .setFooter({ text: 'Loco Night Bot • Team-Verwaltung' });
}

function buildMyTeamButtons(team) {
  const coCount = Array.isArray(team.coManagerIds) ? team.coManagerIds.length : 0;
  const hasCoManagers = coCount > 0;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('team_add_covm_open')
      .setLabel('➕ Co-VM hinzufügen')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(coCount >= 3),
    new ButtonBuilder()
      .setCustomId('team_remove_covm_open')
      .setLabel('➖ Co-VM entfernen')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasCoManagers),
    new ButtonBuilder()
      .setCustomId('team_delete_open')
      .setLabel('🗑️ Team abmelden')
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendMyTeamOverview(interaction, team) {
  const embed = buildMyTeamEmbed(team);
  const row = buildMyTeamButtons(team);

  if (team.logoFile) {
    const logoPath = path.join(logosDir, team.logoFile);

    if (fs.existsSync(logoPath)) {
      const attachment = new AttachmentBuilder(logoPath, { name: team.logoFile });
      embed.setThumbnail(`attachment://${team.logoFile}`);

      await interaction.reply({
        embeds: [embed],
        components: [row],
        files: [attachment],
        flags: MessageFlags.Ephemeral,
      });

      return true;
    }
  }

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleTeamSetupCommand(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ Dieser Command funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const setupData = readSetupData();

  if (setupData.teamPanelMessageId && setupData.registeredTeamsMessageId) {
    await interaction.reply({
      content: '❌ Team-Setup wurde bereits erstellt.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const teamRegisterChannel = guild.channels.cache.get(process.env.TEAM_REGISTER_CHANNEL_ID);
  const registeredTeamsChannel = guild.channels.cache.get(getRegisteredTeamsChannelId());

  if (!teamRegisterChannel || !registeredTeamsChannel) {
    await interaction.reply({
      content: '❌ Team-Anmelde- oder Registrierte-Teams-Kanal nicht gefunden. Prüfe deine Railway Variables.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const teamPanelEmbed = new EmbedBuilder()
    .setTitle('📝 Team-Verwaltung')
    .setDescription(
      'Hier kannst du dein Team verwalten.\n\n' +
      '• **Team anmelden** → Clubname eingeben und danach Logo hochladen\n' +
      '• **Co-VM hinzufügen** → nur Vereinsmanager, maximal 3\n' +
      '• **Co-VM entfernen** → nur Vereinsmanager\n' +
      '• **Mein Team** → private Team-Übersicht\n' +
      '• **Team abmelden** → nur Vereinsmanager'
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

  await interaction.reply({
    content: '✅ Team-Setup erfolgreich erstellt.',
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleTeamButtons(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await interaction.reply({
      content: '❌ Diese Aktion funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const managerRole = guild.roles.cache.get(process.env.MANAGER_ROLE_ID);

  if (!managerRole) {
    await interaction.reply({
      content: '❌ Manager-Rolle wurde nicht gefunden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId === 'team_register_open') {
    if (!member.roles.cache.has(managerRole.id)) {
      await interaction.reply({
        content: '❌ Nur Manager dürfen ein Team anmelden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
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

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.customId === 'team_show_mine') {
    const team = findTeamByManagerOrCoManager(interaction.user.id);

    if (!team) {
      await interaction.reply({
        content: '❌ Du bist aktuell keinem Team zugeordnet.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    return sendMyTeamOverview(interaction, team);
  }

  if (interaction.customId === 'team_add_covm_open') {
    const teams = readTeams();
    const team = teams.find(t => t.managerId === interaction.user.id);

    if (!team) {
      await interaction.reply({
        content: '❌ Nur der Vereinsmanager des Teams kann Co-VMs hinzufügen.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const coCount = Array.isArray(team.coManagerIds) ? team.coManagerIds.length : 0;
    if (coCount >= 3) {
      await interaction.reply({
        content: '❌ Dein Team hat bereits 3 Co-VMs. Mehr sind nicht erlaubt.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const embed = new EmbedBuilder()
      .setTitle('➕ Co-VM hinzufügen')
      .setDescription(
        `Wähle unten einen Spieler aus, der als Co-VM für **${team.clubName}** hinzugefügt werden soll.\n\n` +
        `Aktuell belegt: **${coCount}/3**`
      )
      .setColor(0xff0000);

    const row = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('team_add_covm_select')
        .setPlaceholder('Spieler als Co-VM auswählen')
        .setMinValues(1)
        .setMaxValues(1)
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (interaction.customId === 'team_remove_covm_open') {
    const teams = readTeams();
    const team = teams.find(t => t.managerId === interaction.user.id);

    if (!team) {
      await interaction.reply({
        content: '❌ Nur der Vereinsmanager des Teams kann Co-VMs entfernen.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (!Array.isArray(team.coManagerIds) || team.coManagerIds.length === 0) {
      await interaction.reply({
        content: '❌ Dein Team hat aktuell keine Co-VMs.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const options = team.coManagerIds.slice(0, 25).map(userId => ({
      label: `Co-VM entfernen`,
      description: `User-ID: ${userId}`,
      value: userId,
    }));

    const embed = new EmbedBuilder()
      .setTitle('➖ Co-VM entfernen')
      .setDescription(`Wähle unten aus, welcher Co-VM aus **${team.clubName}** entfernt werden soll.`)
      .setColor(0xff0000);

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('team_remove_covm_select')
        .setPlaceholder('Co-VM auswählen')
        .addOptions(
          team.coManagerIds.slice(0, 25).map(userId => ({
            label: guild.members.cache.get(userId)?.displayName || `User ${userId}`,
            description: `Entfernen als Co-VM`,
            value: userId,
          }))
        )
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (interaction.customId === 'team_delete_open') {
    const teams = readTeams();
    const team = teams.find(t => t.managerId === interaction.user.id);

    if (!team) {
      await interaction.reply({
        content: '❌ Nur der Vereinsmanager des Teams kann das Team abmelden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
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

    await interaction.reply({
      content: `Möchtest du dein Team **${team.clubName}** wirklich abmelden?`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (interaction.customId === 'team_delete_cancel') {
    await interaction.reply({
      content: 'Abgebrochen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId === 'team_delete_confirm') {
    const teams = readTeams();
    const team = teams.find(t => t.managerId === interaction.user.id);

    if (!team) {
      await interaction.reply({
        content: '❌ Nur der Vereinsmanager des Teams kann das Team abmelden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
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

    await interaction.reply({
      content: `✅ Dein Team **${team.clubName}** wurde abgemeldet.`,
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  return false;
}

async function handleTeamUserSelect(interaction) {
  if (interaction.customId !== 'team_add_covm_select') return false;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ Diese Aktion funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const playerRole = guild.roles.cache.get(process.env.PLAYER_ROLE_ID);
  if (!playerRole) {
    await interaction.reply({
      content: '❌ Spieler-Rolle wurde nicht gefunden. Prüfe PLAYER_ROLE_ID.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const teams = readTeams();
  const team = teams.find(t => t.managerId === interaction.user.id);

  if (!team) {
    await interaction.reply({
      content: '❌ Nur der Vereinsmanager des Teams kann Co-VMs hinzufügen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!Array.isArray(team.coManagerIds)) {
    team.coManagerIds = [];
  }

  if (team.coManagerIds.length >= 3) {
    await interaction.reply({
      content: '❌ Dein Team hat bereits 3 Co-VMs. Mehr sind nicht erlaubt.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const userId = interaction.values?.[0];
  if (!userId) {
    await interaction.reply({
      content: '❌ Kein User ausgewählt.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (userId === team.managerId) {
    await interaction.reply({
      content: '❌ Der Vereinsmanager kann nicht zusätzlich Co-VM sein.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  let selectedMember;
  try {
    selectedMember = await guild.members.fetch(userId);
  } catch (error) {
    await interaction.reply({
      content: '❌ Dieser User ist nicht auf dem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!selectedMember.roles.cache.has(playerRole.id)) {
    await interaction.reply({
      content: '❌ Dieser User hat nicht die Spieler-Rolle und kann deshalb kein Co-VM werden.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (team.coManagerIds.includes(userId)) {
    await interaction.reply({
      content: '❌ Dieser User ist bereits Co-VM.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  team.coManagerIds.push(userId);
  team.updatedAt = new Date().toISOString();

  writeTeams(teams);
  await refreshRegisteredTeams(guild);

  await interaction.update({
    content: `✅ <@${userId}> wurde als Co-VM hinzugefügt. Jetzt belegt: **${team.coManagerIds.length}/3**`,
    embeds: [],
    components: [],
  });

  return true;
}

async function handleTeamStringSelect(interaction) {
  if (interaction.customId !== 'team_remove_covm_select') return false;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ Diese Aktion funktioniert nur auf einem Server.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const teams = readTeams();
  const team = teams.find(t => t.managerId === interaction.user.id);

  if (!team) {
    await interaction.reply({
      content: '❌ Nur der Vereinsmanager des Teams kann Co-VMs entfernen.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!Array.isArray(team.coManagerIds) || team.coManagerIds.length === 0) {
    await interaction.reply({
      content: '❌ Dein Team hat aktuell keine Co-VMs.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const userId = interaction.values?.[0];
  if (!userId) {
    await interaction.reply({
      content: '❌ Kein Co-VM ausgewählt.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!team.coManagerIds.includes(userId)) {
    await interaction.reply({
      content: '❌ Dieser User ist aktuell kein Co-VM.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  team.coManagerIds = team.coManagerIds.filter(id => id !== userId);
  team.updatedAt = new Date().toISOString();

  writeTeams(teams);
  await refreshRegisteredTeams(guild);

  await interaction.update({
    content: `✅ <@${userId}> wurde als Co-VM entfernt.`,
    embeds: [],
    components: [],
  });

  return true;
}

async function handleTeamModals(interaction) {
  if (interaction.customId === 'team_register_modal') {
    const guild = interaction.guild;
    const member = interaction.member;

    if (!guild || !member) {
      await interaction.reply({
        content: '❌ Diese Aktion funktioniert nur auf einem Server.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const managerRole = guild.roles.cache.get(process.env.MANAGER_ROLE_ID);
    if (!managerRole || !member.roles.cache.has(managerRole.id)) {
      await interaction.reply({
        content: '❌ Nur Manager dürfen ein Team anmelden.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
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

    await interaction.reply({
      content:
        `✅ Dein Team **${clubName}** wurde gespeichert.\n\n` +
        `Bitte lade jetzt dein Teamlogo als Bild in <#${process.env.TEAM_REGISTER_CHANNEL_ID}> hoch.\n` +
        `Du hast dafür 10 Minuten Zeit.`,
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  return false;
}

async function handleLogoUpload(message) {
  if (message.author.bot) return false;
  if (!message.guild) return false;
  if (message.channel.id !== process.env.TEAM_REGISTER_CHANNEL_ID) return false;
  if (message.attachments.size === 0) return false;

  const pending = pendingLogoUploads.get(message.author.id);
  if (!pending) return false;

  if (pending.channelId !== message.channel.id) return false;

  if (Date.now() > pending.expiresAt) {
    pendingLogoUploads.delete(message.author.id);
    return false;
  }

  const teams = readTeams();
  const team = teams.find(t => t.id === pending.teamId && t.managerId === message.author.id);

  if (!team) {
    pendingLogoUploads.delete(message.author.id);
    return false;
  }

  const attachment = message.attachments.first();
  if (!attachment) return false;

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

  return true;
}

module.exports = {
  async init() {
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true });
    }
  },

  async handleInteraction(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === 'teamsetup') {
      return handleTeamSetupCommand(interaction);
    }

    if (interaction.isButton()) {
      return handleTeamButtons(interaction);
    }

    if (interaction.isUserSelectMenu()) {
      return handleTeamUserSelect(interaction);
    }

    if (interaction.isStringSelectMenu()) {
      return handleTeamStringSelect(interaction);
    }

    if (interaction.isModalSubmit()) {
      return handleTeamModals(interaction);
    }

    return false;
  },

  async handleMessage(message) {
    return handleLogoUpload(message);
  },
};