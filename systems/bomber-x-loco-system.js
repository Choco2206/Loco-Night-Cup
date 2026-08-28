const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const banlistSystem = require('./banlist-system');

const STATE_FILE = path.join(process.cwd(), 'data', 'bomber-x-loco.json');
const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');
const CHECKINS_FILE = path.join(process.cwd(), 'data', 'checkins.json');
const SPECIAL_CHANNEL_ID = '1542823464434671676';
const SPECIAL_DATE = '2026-09-19';

const EVENT_CONFIG = Object.freeze({
  id: 'bomber-x-loco-2026', name: 'Bomber X Loco Cup', date: SPECIAL_DATE,
  channelId: SPECIAL_CHANNEL_ID, maxTeams: 48, groupSize: 6,
  deadlineAt: Date.parse('2026-09-19T20:30:00+02:00'),
  lateDeadlineAt: Date.parse('2026-09-19T20:45:00+02:00'),
  drawAt: Date.parse('2026-09-19T20:50:00+02:00'),
  startAt: Date.parse('2026-09-19T21:00:00+02:00'),
  resetAt: Date.parse('2026-09-20T07:00:00+02:00'),
  deadlineText: '20:30', lateDeadlineText: '20:45', drawText: '20:50', startText: '21:00',
});

const FORMAT_CONFIGS = Object.freeze({
  6:{groups:1,koTeams:4,firstRound:'semiFinal'}, 12:{groups:2,koTeams:8,firstRound:'quarterFinal'},
  18:{groups:3,koTeams:8,firstRound:'quarterFinal'}, 24:{groups:4,koTeams:16,firstRound:'roundOf16'},
  30:{groups:5,koTeams:16,firstRound:'roundOf16'}, 36:{groups:6,koTeams:16,firstRound:'roundOf16'},
  42:{groups:7,koTeams:32,firstRound:'roundOf32'}, 48:{groups:8,koTeams:32,firstRound:'roundOf32'},
});

let clientRef=null; let intervalRef=null;
function createInitialState(){return{eventId:EVENT_CONFIG.id,eventName:EVENT_CONFIG.name,eventDate:EVENT_CONFIG.date,messageId:null,teams:[],finalized:false,format:0,status:'open',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}
function ensureStateFile(){const dir=path.dirname(STATE_FILE);if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});if(!fs.existsSync(STATE_FILE))fs.writeFileSync(STATE_FILE,JSON.stringify(createInitialState(),null,2),'utf8');}
function loadState(){ensureStateFile();try{const p=JSON.parse(fs.readFileSync(STATE_FILE,'utf8')||'{}');return{...createInitialState(),...p,teams:Array.isArray(p.teams)?p.teams:[]};}catch(e){console.error('❌ Bomber X Loco State:',e);return createInitialState();}}
function saveState(s){s.updatedAt=new Date().toISOString();fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2),'utf8');}
function loadTeams(){try{if(!fs.existsSync(TEAMS_FILE))return[];const p=JSON.parse(fs.readFileSync(TEAMS_FILE,'utf8')||'[]');return Array.isArray(p)?p:[];}catch{return[];}}
function loadNormalCheckins(){try{if(!fs.existsSync(CHECKINS_FILE))return{};return JSON.parse(fs.readFileSync(CHECKINS_FILE,'utf8')||'{}');}catch{return{};}}
function getUserTeam(id){return loadTeams().find(t=>String(t.managerId)===String(id)||(Array.isArray(t.coManagerIds)&&t.coManagerIds.map(String).includes(String(id))));}
function normalizeTeam(t){return{teamId:t.id,clubName:t.clubName,managerId:t.managerId||null,coManagerIds:Array.isArray(t.coManagerIds)?t.coManagerIds:[],joinedAt:Date.now()};}
function getTeamBan(t,u){if(!t)return null;return banlistSystem.isTeamOrUserBanned({teamId:t.id||t.teamId})||banlistSystem.isTeamOrUserBanned({userId:t.managerId})||(Array.isArray(t.coManagerIds)?t.coManagerIds.map(id=>banlistSystem.isTeamOrUserBanned({userId:id})).find(Boolean):null)||banlistSystem.isTeamOrUserBanned({userId:u})||null;}
function getActualFormat(n){let r=0;for(const f of Object.keys(FORMAT_CONFIGS).map(Number).sort((a,b)=>a-b))if(n>=f)r=f;return r;}
function getFormatConfig(v){const f=FORMAT_CONFIGS[v]?Number(v):getActualFormat(Number(v));return f?{format:f,...FORMAT_CONFIGS[f]}:null;}
function getQualificationPlan(v){const c=getFormatConfig(v);if(!c)return null;const d=Math.floor(c.koTeams/c.groups),direct=d*c.groups,w=c.koTeams-direct;return{...c,directPlacesPerGroup:d,wildcardPlace:w>0?d+1:null,wildcardCount:w};}
function compareRows(a,b){if(Number(b.points||0)!==Number(a.points||0))return Number(b.points||0)-Number(a.points||0);if(Number(b.diff||0)!==Number(a.diff||0))return Number(b.diff||0)-Number(a.diff||0);return String(a.clubName||'').localeCompare(String(b.clubName||''),'de');}
function selectQualifiedTeams(g,v){const p=getQualificationPlan(v);if(!p)return[];const letters=Object.keys(g||{}).sort(),q=[];for(const l of letters){const rows=[...(g[l]||[])].sort(compareRows);q.push(...rows.slice(0,p.directPlacesPerGroup));}if(p.wildcardCount>0){q.push(...letters.map(l=>[...(g[l]||[])].sort(compareRows)[p.wildcardPlace-1]).filter(Boolean).sort(compareRows).slice(0,p.wildcardCount));}return q.slice(0,p.koTeams);}
function getBerlinDate(v){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(v)));}
function isSpecialSaturdayEvent(e){if(!e)return false;return[e.deadlineAt,e.lateDeadlineAt,e.drawAt,e.startAt].filter(Boolean).some(v=>getBerlinDate(v)===SPECIAL_DATE);}
function shouldBlockNormalSaturdayCheckin(){return isSpecialSaturdayEvent(loadNormalCheckins().saturday);}
function formatCountdown(t){const d=t-Date.now();if(d<=0)return'abgelaufen';const m=Math.floor(d/60000),days=Math.floor(m/1440),h=Math.floor((m%1440)/60),mins=m%60;return days>0?`${days}d ${h}h`:h>0?`${h}h ${mins}m`:`${mins}m`;}
function buildTeamList(s){return Array.from({length:48},(_,i)=>`${i+1}. ${s.teams[i]?s.teams[i].clubName:'—'}`).join('\n');}
function getFormatDescription(s){const f=getActualFormat(s.teams.length);if(!f)return'Noch kein gültiges 6er-Gruppen-Format erreicht.';const p=getQualificationPlan(f),w=p.wildcardCount>0?` + ${p.wildcardCount} beste(r) Platz-${p.wildcardPlace}-Team(s) gruppenübergreifend`:'';return`${f} Teams • ${p.groups} Gruppe(n) à 6 • ${p.koTeams} Teams in der K.O.-Phase${w}`;}
function buildEmbed(s){return new EmbedBuilder().setColor(0xff0000).setTitle('💣🐺 Bomber X Loco Cup • Check-in').setDescription([`**${s.finalized?'🔒 Check-in geschlossen':'🟢 Check-in geöffnet'}**`,'📅 **Samstag, 19.09.2026**','',`⏰ **Offizieller Anmeldeschluss:** ${EVENT_CONFIG.deadlineText} Uhr`,`⌛ **Late Check-in bis:** ${EVENT_CONFIG.lateDeadlineText} Uhr`,`🎲 **Gruppenauslosung:** ${EVENT_CONFIG.drawText} Uhr`,`🚀 **Turnierstart:** ${EVENT_CONFIG.startText} Uhr`,`🕛 **Start in:** ${formatCountdown(EVENT_CONFIG.startAt)}`,'','━━━━━━━━━━━━━━','',`🏆 **Format:** ${getFormatDescription(s)}`,'👥 **Maximal 48 Teams**','',`**Teilnehmende Teams (${s.teams.length}/48)**`,buildTeamList(s)].join('\n'));}
function buildButtons(s){return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bomber_loco_join').setLabel('✅ Anmelden').setStyle(ButtonStyle.Success).setDisabled(s.finalized||Date.now()>=EVENT_CONFIG.lateDeadlineAt),new ButtonBuilder().setCustomId('bomber_loco_leave').setLabel('⬇️ Abmelden').setStyle(ButtonStyle.Secondary).setDisabled(s.finalized||Date.now()>=EVENT_CONFIG.lateDeadlineAt));}
async function ensureMainMessage(){if(!clientRef)return;const ch=await clientRef.channels.fetch(SPECIAL_CHANNEL_ID).catch(()=>null);if(!ch)return;const s=loadState();if(Date.now()>=EVENT_CONFIG.lateDeadlineAt){s.finalized=true;s.format=getActualFormat(s.teams.length);s.status=s.format?'confirmed':'cancelled';}let m=s.messageId?await ch.messages.fetch(s.messageId).catch(()=>null):null;const payload={embeds:[buildEmbed(s)],components:[buildButtons(s)]};if(!m){m=await ch.send(payload);s.messageId=m.id;}else await m.edit(payload);saveState(s);}
async function handleJoin(i){const s=loadState();if(s.finalized||Date.now()>=EVENT_CONFIG.lateDeadlineAt){await i.reply({content:'❌ Die Anmeldung ist bereits geschlossen.',flags:MessageFlags.Ephemeral});return true;}const t=getUserTeam(i.user.id);if(!t){await i.reply({content:'❌ Du bist keinem registrierten Team als VM oder Co-VM zugeordnet.',flags:MessageFlags.Ephemeral});return true;}if(getTeamBan(t,i.user.id)){await i.reply({content:`🚫 **${t.clubName}** ist aktuell gesperrt und kann nicht teilnehmen.`,flags:MessageFlags.Ephemeral});return true;}if(s.teams.some(x=>String(x.teamId)===String(t.id))){await i.reply({content:'⚠️ Dein Team ist bereits angemeldet.',flags:MessageFlags.Ephemeral});return true;}if(s.teams.length>=48){await i.reply({content:'❌ Der Bomber X Loco Cup ist mit 48 Teams voll.',flags:MessageFlags.Ephemeral});return true;}s.teams.push(normalizeTeam(t));s.teams.sort((a,b)=>a.joinedAt-b.joinedAt);s.format=getActualFormat(s.teams.length);saveState(s);await ensureMainMessage();await i.reply({content:`✅ **${t.clubName}** wurde für den Bomber X Loco Cup angemeldet.`,flags:MessageFlags.Ephemeral});return true;}
async function handleLeave(i){const s=loadState();if(s.finalized||Date.now()>=EVENT_CONFIG.lateDeadlineAt){await i.reply({content:'❌ Die Anmeldung ist bereits geschlossen.',flags:MessageFlags.Ephemeral});return true;}const t=getUserTeam(i.user.id);if(!t){await i.reply({content:'❌ Du bist keinem registrierten Team als VM oder Co-VM zugeordnet.',flags:MessageFlags.Ephemeral});return true;}const before=s.teams.length;s.teams=s.teams.filter(x=>String(x.teamId)!==String(t.id));if(before===s.teams.length){await i.reply({content:'⚠️ Dein Team ist nicht angemeldet.',flags:MessageFlags.Ephemeral});return true;}s.format=getActualFormat(s.teams.length);saveState(s);await ensureMainMessage();await i.reply({content:`⬇️ **${t.clubName}** wurde abgemeldet.`,flags:MessageFlags.Ephemeral});return true;}
async function blockNormalSaturday(i){await i.reply({content:['💣🐺 **Für diesen Samstag findet kein regulärer Loco Night Cup statt.**','','Am **19.09.2026** läuft stattdessen der **Bomber X Loco Cup**.',`Wenn ihr teilnehmen wollt, meldet euch hier an: <#${SPECIAL_CHANNEL_ID}>`].join('\n'),flags:MessageFlags.Ephemeral});return true;}

module.exports={EVENT_CONFIG,FORMAT_CONFIGS,getActualFormat,getFormatConfig,getQualificationPlan,selectQualifiedTeams,isSpecialSaturdayEvent,shouldBlockNormalSaturdayCheckin,async init(client){clientRef=client;ensureStateFile();await ensureMainMessage();if(!intervalRef)intervalRef=setInterval(()=>ensureMainMessage().catch(e=>console.error('❌ Bomber X Loco Update:',e)),60000);},async handleInteraction(i){if(!i.isButton())return false;if(i.customId==='bomber_loco_join')return handleJoin(i);if(i.customId==='bomber_loco_leave')return handleLeave(i);if(shouldBlockNormalSaturdayCheckin()&&(i.customId==='checkin_join:saturday'||i.customId==='checkin_leave:saturday'))return blockNormalSaturday(i);return false;}};
