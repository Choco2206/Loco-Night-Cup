const fs = require('fs');
const path = require('path');

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');
const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const REMINDER_FILE = path.join(process.cwd(), 'data', 'nightcup-reminder.json');

const GUILD_ID = '1441222877918658663';
const MANAGER_ROLE_ID = process.env.MANAGER_ROLE_ID;

const FRIDAY_CHECKIN_LINK =
  'https://discord.com/channels/1441222877918658663/1487537735110754504';

const SATURDAY_CHECKIN_LINK =
  'https://discord.com/channels/1441222877918658663/1487537776726380655';

let clientRef = null;
let intervalRef = null;

function loadTeams() {
  try {
    if (!fs.existsSync(TEAMS_FILE)) return [];
    const raw = fs.readFileSync(TEAMS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCheckins() {
  try {
    if (!fs.existsSync(CHECKINS_FILE)) return { friday: null, saturday: null };
    const raw = fs.readFileSync(CHECKINS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      friday: parsed.friday || null,
      saturday: parsed.saturday || null,
    };
  } catch {
    return { friday: null, saturday: null };
  }
}

function ensureReminderFile() {
  const dir = path.dirname(REMINDER_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(REMINDER_FILE)) {
    fs.writeFileSync(
      REMINDER_FILE,
      JSON.stringify({ lastSentKey: null }, null, 2),
      'utf8'
    );
  }
}

function loadReminderState() {
  ensureReminderFile();

  try {
    const raw = fs.readFileSync(REMINDER_FILE, 'utf8');
    return raw ? JSON.parse(raw) : { lastSentKey: null };
  } catch {
    return { lastSentKey: null };
  }
}

function saveReminderState(data) {
  ensureReminderFile();
  fs.writeFileSync(REMINDER_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getGermanTimeParts() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = type => parts.find(part => part.type === type)?.value;

  return {
    weekday: get('weekday'),
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function isFridayReminderTime() {
  const time = getGermanTimeParts();

  return (
  time.weekday === 'Fr.' &&
  time.hour === '18' &&
  time.minute === '00'
);
}

function getReminderKey() {
  const time = getGermanTimeParts();
  return `${time.year}-${time.month}-${time.day}`;
}

function isTeamCheckedIn(teamId, checkins) {
  const fridayTeams = checkins.friday?.teams || [];
  const saturdayTeams = checkins.saturday?.teams || [];

  return (
    fridayTeams.some(team => team.teamId === teamId) ||
    saturdayTeams.some(team => team.teamId === teamId)
  );
}

function getTeamUserIds(team) {
  return [
    team.managerId,
    ...(Array.isArray(team.coManagerIds) ? team.coManagerIds : []),
  ].filter(Boolean);
}

function buildReminderMessage() {
return [
'🌙 **LOCO NIGHT CUP REMINDER**',
'',
'🕺 **It’s Friday then... Saturday, Sunday, what?**',
'',
'Ihr kennt den Ablauf.',
'',
'Die Check-ins sind offen und heute Nacht wird wieder um den heiligen Loco Night Cup gespielt. 🏆',
'',
`🔥 **Freitag Check-in:** ${FRIDAY_CHECKIN_LINK}`,
`🔥 **Samstag Check-in:** ${SATURDAY_CHECKIN_LINK}`,
'',
'⏰ **Anmeldeschluss:** 23:30 Uhr',
'⌛ **Nachjoin möglich bis:** 23:45 Uhr',
'🎲 **Gruppenauslosung:** 23:50 Uhr',
'🌙 **Turnierstart:** 00:00 Uhr',
'',
'Je mehr Teams am Start sind, desto größer wird das Turnier.',
'',
'Also Teamchat aktivieren, Controller laden und die Jungs einsammeln. 🎮🔥',
'',
'**Heute Nacht gibt’s keine Ausreden.** 😎',
].join('\n');
}


async function sendNightCupReminder() {
  if (!MANAGER_ROLE_ID) {
    console.error('❌ MANAGER_ROLE_ID fehlt in der .env.');
    return;
  }

  const guild = await clientRef.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) {
    console.error('❌ Server konnte nicht geladen werden.');
    return;
  }

  const teams = loadTeams();
  const checkins = loadCheckins();
  const message = buildReminderMessage();

  const alreadyMessagedUserIds = new Set();
  let sentCount = 0;

  for (const team of teams) {
    if (isTeamCheckedIn(team.id, checkins)) continue;

    const userIds = getTeamUserIds(team);

    for (const userId of userIds) {
      if (alreadyMessagedUserIds.has(userId)) continue;

      try {
        const member = await guild.members.fetch(userId);

        if (!member.roles.cache.has(MANAGER_ROLE_ID)) continue;

        await member.send(message);

        alreadyMessagedUserIds.add(userId);
        sentCount++;
      } catch (error) {
        console.warn(`⚠️ DM konnte nicht gesendet werden an User: ${userId}`);
      }
    }
  }

  console.log(`✅ NightCup Reminder per DM verschickt an ${sentCount} Manager.`);
}

async function reconcileReminder() {
  if (!clientRef) return;
  if (!isFridayReminderTime()) return;

  const state = loadReminderState();
  const todayKey = getReminderKey();

  if (state.lastSentKey === todayKey) return;

  await sendNightCupReminder();

  state.lastSentKey = todayKey;
  saveReminderState(state);
}

module.exports = {
  async init(client) {
    clientRef = client;
    ensureReminderFile();

    await reconcileReminder();

    if (!intervalRef) {
      intervalRef = setInterval(async () => {
        try {
          await reconcileReminder();
        } catch (error) {
          console.error('❌ Fehler im NightCup Reminder:', error);
        }
      }, 60 * 1000);
    }
  },
};
