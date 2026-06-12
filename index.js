require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { ensureDataFolders, ensureJsonFiles } = require('./utils/storage');

const roleSystem = require('./systems/role-system');
const teamSystem = require('./systems/team-system');
const checkinSystem = require('./systems/checkin-system');
const groupSystem = require('./systems/group-system');
const resultSystem = require('./systems/result-system');
const koSystem = require('./systems/ko-system');
const adminSystem = require('./systems/admin-system');
const testSystem = require('./systems/test-system');
const nicknameSystem = require('./systems/nickname-system');
const nightcupReminderSystem = require('./systems/nightcup-reminder-system');
const liveSpielplanSystem = require('./systems/live-spielplan-system');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

async function emergencyResetFriday0100(message) {
  if (message.author.bot) return false;
  if (message.content !== '!fixfriday0100') return false;

  const adminRoleId = process.env.ADMIN_ROLE_ID;

  if (adminRoleId && !message.member?.roles?.cache?.has(adminRoleId)) {
    await message.reply('❌ Nur Admins dürfen diesen Notfall-Reset ausführen.');
    return true;
  }

  const base = process.cwd();

  const files = {
    checkins: path.join(base, 'data', 'checkins.json'),
    groups: path.join(base, 'data', 'groups.json'),
    results: path.join(base, 'data', 'results.json'),
    ko: path.join(base, 'data', 'ko.json'),
  };

  function readJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8') || JSON.stringify(fallback));
  }

  function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  const checkins = readJson(files.checkins, {});
  const groups = readJson(files.groups, {});
  const results = readJson(files.results, {});
  const ko = readJson(files.ko, {});

  groups.friday = null;
  results.friday = null;
  ko.friday = null;

  const checkinEnd = new Date();
  checkinEnd.setHours(0, 55, 0, 0);

  const groupDraw = new Date();
  groupDraw.setHours(1, 0, 0, 0);

  checkins.friday = {
    ...(checkins.friday || {}),
    teams: [],
    backups: [],
    status: 'open',
    closed: false,
    locked: false,
    started: false,
    completed: false,
    archived: false,
    format: null,

    deadlineText: '00:55',
    deadlineAt: checkinEnd.getTime(),

    startText: '01:00',
    startAt: groupDraw.getTime(),

    cycleKey: `friday-emergency-${Date.now()}`,
    emergencyRestart: true,
    emergencyRestartAt: new Date().toISOString(),
  };

  writeJson(files.checkins, checkins);
  writeJson(files.groups, groups);
  writeJson(files.results, results);
  writeJson(files.ko, ko);

  await message.reply([
    '✅ **Freitag wurde komplett neu geöffnet.**',
    '',
    'Alte Gruppen, Ergebnisse und K.O.-Phase wurden gelöscht.',
    'Der Check-in ist wieder offen.',
    'Alle Teams müssen sich neu anmelden.',
    'Check-in offen bis **00:55 Uhr**.',
    'Gruppenauslosung um **01:00 Uhr**.',
  ].join('\n'));

  return true;
}

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
    if (testSystem.init) await testSystem.init(client);
    if (liveSpielplanSystem.init) await liveSpielplanSystem.init(client);
    
if (nightcupReminderSystem.init) await nightcupReminderSystem.init(client);
    if (nicknameSystem.syncNicknames) {
      for (const guild of readyClient.guilds.cache.values()) {
        await nicknameSystem.syncNicknames(guild);
      }
    }

    console.log(`✅ Bot online als ${readyClient.user.tag}`);
  } catch (error) {
    console.error('❌ Fehler beim Start:', error);
  }
});

client.on(Events.GuildMemberRemove, async member => {
  try {
    if (teamSystem.handleGuildMemberRemove) {
      await teamSystem.handleGuildMemberRemove(member);
    }
  } catch (error) {
    console.error('❌ Fehler bei GuildMemberRemove:', error);
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

    if (testSystem.handleInteraction) {
      const handled = await testSystem.handleInteraction(interaction);
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
    if (await emergencyResetFriday0100(message)) return;

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

    if (testSystem.handleMessage) {
      const handled = await testSystem.handleMessage(message);
      if (handled) return;
    }
  } catch (error) {
    console.error('❌ Fehler bei MessageCreate:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);
