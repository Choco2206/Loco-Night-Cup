const fs=require('fs');
const path=require('path');
const {EmbedBuilder}=require('discord.js');
const bomberSystem=require('./bomber-x-loco-system');

const STATE_FILE=path.join(process.cwd(),'data','bomber-x-loco.json');
const GROUPS_FILE=path.join(process.cwd(),'data','bomber-x-loco-groups.json');
const LETTERS=['A','B','C','D','E','F','G','H'];
let clientRef=null;let intervalRef=null;

function readJson(file,fallback){try{if(!fs.existsSync(file))return fallback;return JSON.parse(fs.readFileSync(file,'utf8')||JSON.stringify(fallback));}catch(e){console.error('Bomber X Loco JSON error',e);return fallback;}}
function writeJson(file,data){const dir=path.dirname(file);if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2),'utf8');}
function loadState(){return readJson(STATE_FILE,null);}
function loadGroups(){return readJson(GROUPS_FILE,null);}
function saveGroups(data){writeJson(GROUPS_FILE,data);}
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function getChannelId(letter){return process.env[`GROUP_${letter}_CHANNEL_ID`]||null;}
function getRoleId(letter){return process.env[`GROUP_${letter}_ROLE_ID`]||null;}
function getUserIds(team){return [team.managerId,...(Array.isArray(team.coManagerIds)?team.coManagerIds:[])].filter(Boolean);}
function createRows(teams){return teams.map(t=>({teamId:t.teamId,clubName:t.clubName,managerId:t.managerId||null,coManagerIds:Array.isArray(t.coManagerIds)?t.coManagerIds:[],s:0,u:0,n:0,diff:0,goalsFor:0,goalsAgainst:0,points:0}));}
function sortRows(rows){return [...rows].sort((a,b)=>b.points-a.points||b.diff-a.diff||(b.goalsFor||0)-(a.goalsFor||0)||String(a.clubName).localeCompare(String(b.clubName),'de'));}
function qualificationText(format){const m={6:'Platz 1–4 • Halbfinale',12:'Platz 1–4 je Gruppe • Viertelfinale',18:'Platz 1–2 + 2 beste Drittplatzierte • Viertelfinale',24:'Platz 1–4 je Gruppe • Achtelfinale',30:'Platz 1–3 + bester Viertplatzierter • Achtelfinale',36:'Platz 1–2 + 4 beste Drittplatzierte • Achtelfinale',42:'Platz 1–4 + 4 beste Fünftplatzierte • Sechzehntelfinale',48:'Platz 1–4 je Gruppe • Sechzehntelfinale'};return m[format]||'abhängig vom Format';}
function tableEmbed(letter,rows,format){const text=sortRows(rows).map((r,i)=>`**${i+1}. ${r.clubName}** • S ${r.s} • U ${r.u} • N ${r.n} • Diff ${r.diff>0?`+${r.diff}`:r.diff} • P ${r.points}`).join('\n');return new EmbedBuilder().setColor(0xff0000).setTitle(`🏆 Bomber X Loco Cup • Gruppe ${letter} • Live-Tabelle`).setDescription(`${text}\n\n**Weiterkommen:** ${qualificationText(format)}`);}
function detailsEmbed(letter,teams){const text=teams.map(t=>`**${t.clubName}**\n${getUserIds(t).map(id=>`<@${id}>`).join(' ')||'Keine VM/Co-VM-Daten'}`).join('\n\n');return new EmbedBuilder().setColor(0xff0000).setTitle(`👥 Bomber X Loco Cup • Gruppe ${letter} • Team-Details`).setDescription(text);}
async function purge(channel){let messages;do{messages=await channel.messages.fetch({limit:100}).catch(()=>null);if(!messages)return;const deletable=messages.filter(m=>!m.pinned);if(deletable.size)await channel.bulkDelete(deletable,true).catch(()=>{});}while(messages.size===100);}
async function assignRole(letter,teams){const guild=clientRef.guilds.cache.get(process.env.GUILD_ID);const roleId=getRoleId(letter);if(!guild||!roleId)return;const role=guild.roles.cache.get(roleId)||await guild.roles.fetch(roleId).catch(()=>null);if(!role)return;for(const t of teams){for(const uid of getUserIds(t)){const member=await guild.members.fetch(uid).catch(()=>null);if(member&&!member.roles.cache.has(role.id))await member.roles.add(role).catch(()=>{});}}}
async function createGroupsIfReady(){const state=loadState();if(!state||!state.finalized||state.status!=='confirmed')return;if(Date.now()<bomberSystem.EVENT_CONFIG.drawAt)return;if(loadGroups()?.created)return;const format=Number(state.format||bomberSystem.getActualFormat((state.teams||[]).length));const cfg=bomberSystem.getFormatConfig(format);if(!cfg)return;const teams=(state.teams||[]).slice(0,format);if(teams.length!==format)return;const shuffled=shuffle(teams);const groups={};for(let i=0;i<cfg.groups;i++){const letter=LETTERS[i];const groupTeams=shuffled.slice(i*6,i*6+6);groups[letter]={channelId:getChannelId(letter),roleId:getRoleId(letter),teams:groupTeams,rows:createRows(groupTeams),detailsMessageId:null,tableMessageId:null};}
for(const [letter,g] of Object.entries(groups)){if(!g.channelId)continue;const ch=await clientRef.channels.fetch(g.channelId).catch(()=>null);if(!ch)continue;await purge(ch);await assignRole(letter,g.teams);const d=await ch.send({embeds:[detailsEmbed(letter,g.teams)]});const t=await ch.send({embeds:[tableEmbed(letter,g.rows,format)]});g.detailsMessageId=d.id;g.tableMessageId=t.id;}
saveGroups({created:true,createdAt:new Date().toISOString(),eventId:state.eventId,format,groupSize:6,resetAt:bomberSystem.EVENT_CONFIG.resetAt,groups});console.log(`✅ Bomber X Loco: ${cfg.groups} Sechsergruppen erstellt.`);}
async function refreshTable(letter,rows){const data=loadGroups();if(!data?.groups?.[letter])return false;const g=data.groups[letter];g.rows=rows;const ch=g.channelId?await clientRef.channels.fetch(g.channelId).catch(()=>null):null;if(ch&&g.tableMessageId){const m=await ch.messages.fetch(g.tableMessageId).catch(()=>null);if(m)await m.edit({embeds:[tableEmbed(letter,rows,data.format)]});}saveGroups(data);return true;}
module.exports={loadGroups,saveGroups,refreshTable,sortRows,async init(client){clientRef=client;await createGroupsIfReady();if(!intervalRef)intervalRef=setInterval(()=>createGroupsIfReady().catch(e=>console.error('Bomber X Loco group error',e)),60000);},async handleInteraction(){return false;}};
