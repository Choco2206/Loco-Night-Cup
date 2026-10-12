'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { FILES, readJson, createSettingsDefault } = require('../../storage');
const { readTeamsData } = require('../teams/team-repository');
const { findTeamById, isTeamMember } = require('../teams/team-service');
const premium = require('./premium-store');
const PUBLIC_CHANNEL = '1559098681402064947';
const ADMIN_CHANNEL = '1559098847811215360';
const PAYPAL = 'loconightcup';
const PREFIX = 'premium:';
let timer;
let activeFingerprint = '';
let reconciling = false;
const button = (id, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(PREFIX + id).setLabel(label).setStyle(style);
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const settings = () => readJson(FILES.settings, createSettingsDefault());
const teams = () => readTeamsData().teams.filter(t => t.status === 'active' && t.registrationStatus === 'complete').sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
function requireTeam(id, userId, admin = false) {
  const team = findTeamById(id);
  if (!team || team.status !== 'active' || team.registrationStatus !== 'complete') throw new Error('Dieses Team ist nicht mehr aktiv oder vollständig registriert.');
  if (!admin && !isTeamMember(team, userId)) throw new Error('Du musst VM oder Co-VM dieses Teams sein.');
  return team;
}
function canAdmin(member) {
  const s = settings();
  const ids = [...(s.roles?.adminRoleIds || []), ...(s.roles?.cupLeadRoleIds || []), ...(s.permissions?.adminRoleIds || []), ...(s.permissions?.cupLeadRoleIds || [])];
  return ids.some(id => member?.roles?.cache?.has(id));
}
function teamPicker(action, userId, requestedPage = 0) {
  const list = teams().filter(t => action === 'get' || action === 'mine' ? isTeamMember(t, userId) : action === 'remove' ? premium.hasPremium(t.id) : true);
  return picker(action, list.map(t => ({ id: t.id, label: t.clubName, description: premium.hasPremium(t.id) ? 'Premium aktiv 💎' : 'Kein aktives Premium' })), requestedPage);
}
function picker(action, list, requestedPage) {
  if (!list.length) return { content: action === 'cases' ? 'Es gibt keine offenen Zahlungsfälle.' : 'Keine passenden Teams gefunden.', components: [] };
  const pages = Math.ceil(list.length / 25), page = Math.max(0, Math.min(pages - 1, Number(requestedPage) || 0));
  const menu = new StringSelectMenuBuilder().setCustomId(PREFIX + `select:${action}`).setPlaceholder(action === 'cases' ? 'Offenen Fall auswählen' : 'Team auswählen').addOptions(list.slice(page * 25, page * 25 + 25).map(t => ({ label: t.label.slice(0, 100), value: t.id, description: t.description.slice(0, 100) })));
  return { content: `**${action === 'cases' ? 'Offene Zahlungsfälle' : 'Teamauswahl'}** · Seite ${page + 1}/${pages}`, components: [row(menu), row(button(`page:${action}:${page - 1}`, 'Zurück', ButtonStyle.Secondary).setDisabled(page === 0), button(`page:${action}:${page + 1}`, 'Weiter', ButtonStyle.Secondary).setDisabled(page === pages - 1))] };
}
function cases(page = 0) {
  return picker('cases', premium.readStore().orders.filter(o => o.status === 'paid').sort((a, b) => (findTeamById(a.teamId)?.clubName || '').localeCompare(findTeamById(b.teamId)?.clubName || '', 'de')).map(o => ({ id: o.id, label: findTeamById(o.teamId)?.clubName || o.teamId, description: `${o.months} Monat(e) · ${o.amount} € · Zahlung gemeldet` })), page);
}
function months(action, team) {
  const menu = new StringSelectMenuBuilder().setCustomId(PREFIX + `months:${action}:${team.id}`).setPlaceholder('Laufzeit wählen').addOptions(Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1} ${i ? 'Monate' : 'Monat'} · ${(i + 1) * 5} €`, value: String(i + 1) })));
  return { content: `**${team.clubName}**\n5 € pro Monat. Wähle 1 bis 12 Monate. Bestehendes Premium wird verlängert.`, components: [row(menu)] };
}
function payment(order) {
  const team = findTeamById(order.teamId);
  const pending = order.status === 'paid';
  return { content: `💎 **Premium für ${team?.clubName || order.teamId}**\n\nDanke, dass du den Loco Night Cup mit Premium unterstützt!\nLaufzeit: **${order.months} Monat(e)**\nBetrag: **${order.amount} €**\n\nBitte per **PayPal Familie und Freunde** an **${PAYPAL}** überweisen.\nVerwendungszweck: **${team?.clubName || order.teamId} · Premium · ${order.months} Monat(e)**\n\n${pending ? 'Deine Zahlung wurde gemeldet und wird von der Turnierleitung geprüft.' : 'Klicke nach der Überweisung auf „Ich habe es überwiesen“.'}\nPremium beginnt mit der Freigabe. Eine aktive Laufzeit wird verlängert.`, components: pending ? [] : [row(button(`paid:${order.id}`, 'Ich habe es überwiesen'), button(`cancel:${order.id}`, 'Anfrage abbrechen', ButtonStyle.Secondary))] };
}
function panels() {
  const count = premium.readStore().orders.filter(o => o.status === 'paid').length;
  return [
    { key: 'public', channelId: PUBLIC_CHANNEL, payload: { content: '💎 **Loco Night Cup Premium**\n\n**5 € pro Monat**, frei wählbar für **1 bis 12 Monate**. Premium gilt für dein Team.\n\nPremium-Teams haben bei geöffnetem Check-in Vorrang vor Teams ohne Premium. Unter Premium-Teams zählt die Anmeldereihenfolge. Ein Turnierplatz hängt weiterhin von freien Plätzen und rechtzeitiger Anmeldung ab.\n\nDie Laufzeit beginnt nach bestätigtem Zahlungseingang und endet am entsprechenden Tag des Folgemonats. Verlängerungen werden angehängt.\nGruppen und K.O.-Runden werden wie gewohnt ausgespielt.', components: [row(button('get', 'Premium erhalten'), button('mine', 'Mein Premium', ButtonStyle.Secondary))] } },
    { key: 'admin', channelId: ADMIN_CHANNEL, payload: { content: `💎 **Premium-Verwaltung**\n\nOffene Zahlungsfälle: **${count}**\nZahlungen bitte im PayPal-Konto prüfen und anschließend freigeben oder ablehnen.`, components: [row(button('grant', 'Premium vergeben'), button('remove', 'Premium entfernen', ButtonStyle.Danger), button('cases', 'Offene Fälle', ButtonStyle.Secondary))] } },
  ];
}
async function ensurePanels(client) {
  for (const { key, channelId, payload } of panels()) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.send) throw new Error(`Premium-Kanal ${channelId} nicht erreichbar.`);
    const saved = premium.readStore().panels[key];
    let message = saved?.channelId === channelId ? await channel.messages.fetch(saved.messageId).catch(() => null) : null;
    if (!message) {
      const recent = await channel.messages.fetch({ limit: 50 });
      message = recent.find(m => m.author?.id === client.user.id && m.components?.some(r => r.components?.some(c => c.customId === PREFIX + (key === 'public' ? 'get' : 'grant'))));
    }
    message = message ? await message.edit({ ...payload, allowedMentions: { parse: [] } }) : await channel.send({ ...payload, allowedMentions: { parse: [] } });
    premium.updateStore(store => { store.panels[key] = { channelId, messageId: message.id }; return store; });
  }
}
async function notify(client, team, text, requesterId = null) {
  const ids = [...new Set([requesterId, team?.manager?.userId, ...(team?.coManagers || []).map(c => c.userId)].filter(Boolean))];
  for (const id of ids) {
    try { const user = await client.users.fetch(id); await user.send({ content: text, allowedMentions: { parse: [] } }); }
    catch (error) { console.warn(`[premium] Privatnachricht an ${id} nicht zustellbar: ${error.message}`); }
  }
}
async function refreshCheckins(client) {
  try {
  const { EVENT_KEYS } = require('../../app/constants');
  const { refreshEventFormat } = require('../checkins/checkin-service');
  const { readEventData } = require('../checkins/checkin-repository');
  const { ensureAllCheckinMessages } = require('../checkins/checkin-panel');
  for (const key of EVENT_KEYS) {
    const event = readEventData(key);
    if (!event.format?.lockedAt && ['checkin_open', 'deadline_reached'].includes(event.status)) refreshEventFormat(key);
  }
  await ensureAllCheckinMessages(client);
  await require('../teams/team-overview').refreshRegisteredTeamsOverview(client).catch(error => console.error('[premium] Team-Übersicht:', error));
  } catch (error) { console.error('[premium] Check-in-Anzeige wird beim nächsten Abgleich aktualisiert:', error); }
}
async function handleInteraction(interaction, client) {
  if (!String(interaction.customId || '').startsWith(PREFIX)) return false;
  await interaction.deferReply({ flags: 64 });
  try {
    const s = settings();
    if (String(interaction.guildId) !== String(s.guild?.guildId)) throw new Error('Premium ist nur auf dem Loco Night Cup Server verfügbar.');
    const [command, action, value] = interaction.customId.slice(PREFIX.length).split(':');
    const adminAction = ['grant', 'remove', 'cases', 'approve', 'reject', 'removeconfirm'].includes(command) || ['page', 'select', 'months'].includes(command) && ['grant', 'remove', 'cases'].includes(action);
    if (adminAction && (interaction.channelId !== ADMIN_CHANNEL || !canAdmin(interaction.member))) throw new Error('Diese Aktion ist nur für Admins und Turnierleitung verfügbar.');
    if (!adminAction && interaction.channelId !== PUBLIC_CHANNEL) throw new Error('Bitte nutze den Premium-Kanal.');
    let payload;
    if (['get', 'mine', 'grant', 'remove'].includes(command)) payload = teamPicker(command, interaction.user.id);
    else if (command === 'cases') payload = cases();
    else if (command === 'page') payload = action === 'cases' ? cases(value) : teamPicker(action, interaction.user.id, value);
    else if (command === 'select') {
      const id = interaction.values[0];
      if (action === 'cases') {
        const order = premium.readStore().orders.find(o => o.id === id && o.status === 'paid');
        if (!order) throw new Error('Dieser Fall ist nicht mehr offen.');
        payload = { content: `**${findTeamById(order.teamId)?.clubName || order.teamId}**\n${order.months} Monat(e) · **${order.amount} €**\nAnfrage von <@${order.userId}>\nZahlung gemeldet: <t:${Math.floor(Date.parse(order.paidAt) / 1000)}:f>\n\nIst die Zahlung angekommen?`, components: [row(button(`approve:${order.id}`, 'Ja, Zahlung angekommen', ButtonStyle.Success), button(`reject:${order.id}`, 'Nein, Zahlung fehlt', ButtonStyle.Danger))] };
      } else {
        const team = requireTeam(id, interaction.user.id, adminAction);
        if (action === 'mine') {
          const order = premium.readStore().orders.find(o => o.teamId === team.id && ['awaiting_payment', 'paid'].includes(o.status));
          payload = { content: `💎 **${team.clubName}**\nPremium: **${premium.statusText(team.id)}**${order ? `\nOffene Anfrage: ${order.months} Monat(e), ${order.amount} € · ${order.status === 'paid' ? 'Zahlungsprüfung läuft' : 'Überweisung ausstehend'}` : ''}`, components: order?.status === 'awaiting_payment' && order.userId === interaction.user.id ? [row(button(`resume:${order.id}`, 'Zahlungsanfrage öffnen'))] : [] };
        } else if (action === 'remove') payload = { content: `Premium für **${team.clubName}** entfernen?\n${premium.statusText(team.id)}`, components: [row(button(`removeconfirm:${team.id}`, 'Premium entfernen bestätigen', ButtonStyle.Danger))] };
        else payload = months(action, team);
      }
    } else if (command === 'months') {
      const team = requireTeam(value, interaction.user.id, adminAction), duration = Number(interaction.values[0]);
      if (action === 'grant') {
        premium.grant(team.id, duration, interaction.user.id);
        payload = { content: `💎 Premium für **${team.clubName}** vergeben.\n${premium.statusText(team.id)}`, components: [] };
        await notify(client, team, `💎 Premium für ${team.clubName} wurde aktiviert bzw. verlängert.\n${premium.statusText(team.id)}`);
        await refreshCheckins(client);
      } else {
        const order = premium.createOrder(team.id, interaction.user.id, duration);
        payload = order.userId === interaction.user.id ? payment(order) : { content: 'Für dein Team gibt es bereits eine offene Premium-Anfrage. Du findest den Stand unter „Mein Premium“.', components: [] };
      }
    } else if (['paid', 'resume', 'cancel'].includes(command)) {
      let order = premium.readStore().orders.find(o => o.id === action);
      if (!order || order.userId !== interaction.user.id) throw new Error('Diese Anfrage gehört nicht zu dir.');
      requireTeam(order.teamId, interaction.user.id);
      if (!['awaiting_payment', 'paid'].includes(order.status)) throw new Error('Diese Anfrage wurde bereits abgeschlossen.');
      if (command === 'paid') order = premium.markPaid(order.id, interaction.user.id);
      if (command === 'cancel') {
        if (order.status !== 'awaiting_payment') throw new Error('Die Zahlung wurde bereits gemeldet und wird geprüft.');
        premium.updateStore(store => { store.orders.find(o => o.id === order.id).status = 'cancelled'; return store; });
        payload = { content: 'Deine Premium-Anfrage wurde abgebrochen.', components: [] };
      } else payload = payment(order);
    } else if (['approve', 'reject'].includes(command)) {
      const pending = premium.readStore().orders.find(o => o.id === action);
      if (command === 'approve') requireTeam(pending?.teamId, interaction.user.id, true);
      const result = premium.decide(action, command === 'approve', interaction.user.id);
      const team = findTeamById(result.order.teamId);
      payload = { content: command === 'approve' ? `💎 Zahlung bestätigt. Premium für **${team.clubName}** aktiviert.\n${premium.statusText(team.id)}` : 'Anfrage abgelehnt und aus den offenen Fällen entfernt.', components: [] };
      await notify(client, team, command === 'approve' ? `💎 Danke für deine Unterstützung! Premium für ${team.clubName} ist freigeschaltet.\n${premium.statusText(team.id)}` : `Deine Premium-Anfrage für ${team?.clubName || result.order.teamId} wurde abgelehnt: Zahlung noch nicht erhalten. Bitte prüfe die Überweisung und starte den Vorgang bei Bedarf erneut im Premium-Kanal.`, result.order.userId);
      if (command === 'approve') await refreshCheckins(client);
    } else if (command === 'removeconfirm') {
      const team = requireTeam(action, interaction.user.id, true);
      premium.remove(team.id, interaction.user.id);
      payload = { content: `Premium für **${team.clubName}** wurde entfernt.`, components: [] };
      await refreshCheckins(client);
    } else throw new Error('Diese Premium-Aktion ist nicht verfügbar.');
    await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
    await ensurePanels(client).catch(error => console.error('[premium] Panel-Aktualisierung:', error));
  } catch (error) {
    console.error('[premium] Aktion fehlgeschlagen:', error);
    await interaction.editReply({ content: error.message, components: [] });
  }
  return true;
}
async function init(client) {
  await ensurePanels(client);
  const fingerprint = () => Object.keys(premium.readStore().subscriptions).filter(id => premium.hasPremium(id)).sort().join(',');
  activeFingerprint = fingerprint();
  if (!timer) {
    timer = setInterval(async () => {
      if (reconciling) return;
      reconciling = true;
      try {
        const current = fingerprint();
        if (current !== activeFingerprint) { await refreshCheckins(client); activeFingerprint = current; }
        await ensurePanels(client);
      } catch (error) { console.error('[premium] Abgleich:', error); }
      finally { reconciling = false; }
    }, 60000);
    timer.unref?.();
  }
}
module.exports = { ADMIN_CHANNEL, PUBLIC_CHANNEL, PAYPAL, canAdmin, handleInteraction, init, picker, panels };
