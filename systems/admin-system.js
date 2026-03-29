const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');
const ADMIN_FILE = path.join(process.cwd(), 'data', 'admin-system.json');
const TEST_FILE = path.join(process.cwd(), 'data', 'test-state.json');

let clientRef = null;

// =========================
// FILE HELPERS
// =========================

function ensureFile(filePath, fallback) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  ensureFile(filePath, fallback);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`❌ Fehler beim Lesen von ${filePath}:`, error);
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben von ${filePath}:`, error);
  }
}

function loadTeams() {
  return readJson(TEAMS_FILE, []);
}

function saveTeams(data) {
  writeJson(TEAMS_FILE, data);
}

function loadAdminState() {
  return readJson(ADMIN_FILE, {
    controlPanelMessageId: null,
  });
}

function saveAdminState(data) {
  writeJson(ADMIN_FILE, data);
}

function loadTestState() {
  return readJson(TEST_FILE, {
    active: false,
    format: null,
    teamIds: [],
    createdMessageIds: [],
    createdAt: null,
  });
}

function saveTestState(data) {
  writeJson(TEST_FILE, data);
}

// =========================
// HELPERS
// =========================

function isAdminMember(member) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (!adminRoleId) return false;
  return member?.roles?.cache?.has(adminRoleId) || false;
}

function getTestChannelIds() {
  return [
    process.env.TEST_CONTROL_CHANNEL_ID,
    process.env.TEST_CHECKIN_CHANNEL_ID,
    process.env.TEST_GROUP_A_CHANNEL_ID,
    process.env.TEST_GROUP_B_CHANNEL_ID,
    process.env.TEST_GROUP_C_CHANNEL_ID,
    process.env.TEST_GROUP_D_CHANNEL_ID,
    process.env.TEST_GROUP_E_CHANNEL_ID,
    process.env.TEST_GROUP_F_CHANNEL_ID,
    process.env.TEST_GROUP_G_CHANNEL_ID,
    process.env.TEST_GROUP_H_CHANNEL_ID,
    process.env.TEST_ROUND_OF_16_CHANNEL_ID,
    process.env.TEST_QUARTERFINAL_CHANNEL_ID,
    process.env.TEST_SEMIFINAL_CHANNEL_ID,
    process.env.TEST_THIRD_PLACE_CHANNEL_ID,
    process.env.TEST_FINAL_CHANNEL_ID,
    process.env.TEST_RESULT_CHECK_CHANNEL_ID,
    process.env.TEST_LOGS_CHANNEL_ID,
  ].filter(Boolean);
}

async function fetchChannel(channelId) {
  try {
    return await clientRef.channels.fetch(channelId);
  } catch (error) {
    console.error(`❌ Kanal konnte nicht geladen werden: ${channelId}`, error);
    return null;
  }
}

async function logToTestChannel(text) {
  const channelId = process.env.TEST_LOGS_CHANNEL_ID;
  if (!channelId) return;

  const channel = await fetchChannel(channelId);
  if (!channel) return;

  try {
    await channel.send({
      content: `[${new Date().toLocaleString('de-DE')}] ${text}`,
    });
  } catch (error) {
    console.error('❌ Fehler beim Schreiben in Test-Logs:', error);
  }
}

function buildControlEmbed(testState) {
  const status = testState.active
    ? `🟢 Aktiv (${testState.format}er Testlauf)`
    : '⚪ Kein aktiver Testlauf';

  return new EmbedBuilder()
    .setTitle('🧪 Test Lab Steuerung')
    .setDescription(
      [
        `**Status:** ${status}`,
        '',
        '**Testlauf starten:**',
        '• 8er',
        '• 16er',
        '• 24er',
        '• 32er',
        '',
        '**Cleanup:**',
        '• Test komplett löschen',
        '',
        'Der Bot erstellt die Testteams automatisch.',
      ].join('\n')
    )
    .setColor(0xff0000);
}

function buildControlRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_test_start_8')
      .setLabel('8er Test')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_test_start_16')
      .setLabel('16er Test')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_test_start_24')
      .setLabel('24er Test')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_test_start_32')
      .setLabel('32er Test')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_test_delete')
      .setLabel('🗑️ Test komplett löschen')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

async function ensureControlPanel() {
  const channelId = process.env.TEST_CONTROL_CHANNEL_ID;
  if (!channelId) return;

  const channel = await fetchChannel(channelId);
  if (!channel) return;

  const adminState = loadAdminState();
  const testState = loadTestState();

  let message = null;

  if (adminState.controlPanelMessageId) {
    try {
      message = await channel.messages.fetch(adminState.controlPanelMessageId);
    } catch (error) {
      message = null;
    }
  }

  if (!message) {
    const created = await channel.send({
      embeds: [buildControlEmbed(testState)],
      components: buildControlRows(),
    });

    adminState.controlPanelMessageId = created.id;
    saveAdminState(adminState);
    return;
  }

  await message.edit({
    embeds: [buildControlEmbed(testState)],
    components: buildControlRows(),
  });
}

function createTestTeams(format) {
  const teams = [];
  for (let i = 1; i <= format; i++) {
    teams.push({
      id: `test_team_${Date.now()}_${i}`,
      clubName: `Test Team ${i}`,
      managerId: process.env.ADMIN_ROLE_ID || 'test-admin',
      coManagerIds: [],
      logoFile: null,
      isTest: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return teams;
}

async function clearTestChannelMessages() {
  const channelIds = getTestChannelIds();

  for (const channelId of channelIds) {
    const channel = await fetchChannel(channelId);
    if (!channel) continue;

    try {
      const messages = await channel.messages.fetch({ limit: 100 });

      for (const msg of messages.values()) {
        if (msg.author?.id === clientRef.user.id) {
          try {
            await msg.delete();
          } catch (error) {}
        }
      }
    } catch (error) {
      console.error(`❌ Fehler beim Leeren von Kanal ${channelId}:`, error);
    }
  }
}

async function startTestRun(format) {
  const teams = loadTeams();
  const testState = loadTestState();

  // Alte Testteams raus
  const filteredTeams = teams.filter(team => !team.isTest);

  // Neue Testteams rein
  const newTestTeams = createTestTeams(format);
  const mergedTeams = [...filteredTeams, ...newTestTeams];
  saveTeams(mergedTeams);

  const newState = {
    active: true,
    format,
    teamIds: newTestTeams.map(t => t.id),
    createdMessageIds: [],
    createdAt: new Date().toISOString(),
  };

  saveTestState(newState);

  const checkinChannel = await fetchChannel(process.env.TEST_CHECKIN_CHANNEL_ID);
  if (checkinChannel) {
    const msg = await checkinChannel.send({
      content: [
        `🧪 **${format}er Testlauf gestartet**`,
        '',
        `Es wurden automatisch ${format} Testteams erstellt.`,
        'Nächster Schritt: Test-Flow / Test-Check-in / Test-Auslosung.',
      ].join('\n'),
    });

    newState.createdMessageIds.push({
      channelId: checkinChannel.id,
      messageId: msg.id,
    });
    saveTestState(newState);
  }

  await logToTestChannel(`🧪 ${format}er Testlauf gestartet.`);
  await ensureControlPanel();
}

async function deleteTestRun() {
  const teams = loadTeams();
  const filteredTeams = teams.filter(team => !team.isTest);
  saveTeams(filteredTeams);

  saveTestState({
    active: false,
    format: null,
    teamIds: [],
    createdMessageIds: [],
    createdAt: null,
  });

  await clearTestChannelMessages();
  await logToTestChannel('🗑️ Testlauf komplett gelöscht.');
  await ensureControlPanel();
}

// =========================
// EXPORTS
// =========================

module.exports = {
  async init(client) {
    clientRef = client;
    ensureFile(ADMIN_FILE, { controlPanelMessageId: null });
    ensureFile(TEST_FILE, {
      active: false,
      format: null,
      teamIds: [],
      createdMessageIds: [],
      createdAt: null,
    });

    await ensureControlPanel();
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton()) return false;

    const adminButtons = [
      'admin_test_start_8',
      'admin_test_start_16',
      'admin_test_start_24',
      'admin_test_start_32',
      'admin_test_delete',
    ];

    if (!adminButtons.includes(interaction.customId)) return false;

    if (!isAdminMember(interaction.member)) {
      await interaction.reply({
        content: '❌ Nur NightCup Admins dürfen dieses Panel nutzen.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.customId === 'admin_test_start_8') {
      await startTestRun(8);
      await interaction.reply({
        content: '✅ 8er Testlauf gestartet.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.customId === 'admin_test_start_16') {
      await startTestRun(16);
      await interaction.reply({
        content: '✅ 16er Testlauf gestartet.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.customId === 'admin_test_start_24') {
      await startTestRun(24);
      await interaction.reply({
        content: '✅ 24er Testlauf gestartet.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.customId === 'admin_test_start_32') {
      await startTestRun(32);
      await interaction.reply({
        content: '✅ 32er Testlauf gestartet.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.customId === 'admin_test_delete') {
      await deleteTestRun();
      await interaction.reply({
        content: '✅ Testlauf komplett gelöscht.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    return false;
  },

  async handleMessage() {
    return false;
  },
};