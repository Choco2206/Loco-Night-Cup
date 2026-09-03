'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');

const CATEGORIES = Object.freeze({
  team_registration: { label: 'Teamanmeldung', emoji: '📝' },
  roles_rights: { label: 'Rollen & Rechte', emoji: '🛡️' },
  cup_support: { label: 'Cup-Support', emoji: '🏆' },
  rule_violation: { label: 'Regelverstoß melden', emoji: '🚨' },
  cooperation: { label: 'Kooperation & Partnerschaft', emoji: '🤝' },
  other: { label: 'Sonstiges', emoji: '❓' },
});

const STATUS = Object.freeze({
  open: { label: 'Offen', emoji: '🟢', color: 0x2ecc71 },
  in_progress: { label: 'In Bearbeitung', emoji: '🟡', color: 0xf1c40f },
  closed: { label: 'Geschlossen', emoji: '🔴', color: 0xe74c3c },
  creating: { label: 'Wird erstellt', emoji: '⚪', color: 0x95a5a6 },
  failed: { label: 'Fehlgeschlagen', emoji: '⚫', color: 0x7f8c8d },
});

function formatTicketNumber(number) {
  return String(number).padStart(3, '0');
}

function categoryDetails(key) {
  return CATEGORIES[key] || CATEGORIES.other;
}

function statusDetails(status) {
  return STATUS[status] || STATUS.open;
}

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x7b2cff)
    .setAuthor({ name: 'LOCO NIGHT CUP • SUPPORT NEVER SLEEPS' })
    .setTitle('🎫 SUPPORT DESK')
    .setDescription([
      '# 🐺 **DEIN DIREKTER DRAHT ZU UNS**',
      '',
      '*Du brauchst Hilfe, hast ein Problem während des Cups oder möchtest dein Team anmelden?*',
      '**Kein Stress. Eröffne dein Ticket und wir kümmern uns darum.**',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      '## ⚡ **IN DREI SCHRITTEN ZUM SUPPORT**',
    ].join('\n'))
    .addFields(
      {
        name: '01 • AUSWÄHLEN',
        value: '*Passende Kategorie auswählen*',
        inline: true,
      },
      {
        name: '02 • BESCHREIBEN',
        value: '*Formular kurz ausfüllen*',
        inline: true,
      },
      {
        name: '03 • HILFE BEKOMMEN',
        value: '*Privat mit uns klären*',
        inline: true,
      },
      {
        name: '🎯 WOMIT KÖNNEN WIR HELFEN?',
        value: [
          '📝 **Teamanmeldung**',
          '🛡️ **Rollen & Rechte**',
          '🏆 **Cup-Support**',
        ].join('\n'),
        inline: true,
      },
      {
        name: '​',
        value: [
          '🚨 **Regelverstoß melden**',
          '🤝 **Kooperation & Partnerschaft**',
          '❓ **Sonstiges**',
        ].join('\n'),
        inline: true,
      },
      {
        name: '🔒 DEIN TICKET. DEIN ANLIEGEN. PRIVAT.',
        value: [
          '*Andere Mitglieder können dein Ticket nicht sehen.*',
          'Zugriff haben nur **du**, hinzugefügte Personen und unsere **Ticket Mods**.',
          '',
          '> ⚠️ **Bitte nur ein Ticket pro Anliegen eröffnen.**',
        ].join('\n'),
      }
    )
    .setFooter({ text: '🐺 LOCO NIGHT CUP • SCHNELL. DIREKT. FÜR EUCH DA.' });
}

function buildPanelComponents() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_category_select')
    .setPlaceholder('🎫 Ticket-Kategorie auswählen')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(Object.entries(CATEGORIES).map(([value, details]) => ({
      label: details.label,
      value,
      emoji: details.emoji,
    })));
  return [new ActionRowBuilder().addComponents(menu)];
}

function buildCreateModal(categoryKey) {
  const details = categoryDetails(categoryKey);
  return new ModalBuilder()
    .setCustomId(`ticket_create_modal:${categoryKey}`)
    .setTitle(`Ticket: ${details.label}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('team_name')
          .setLabel('Teamname')
          .setPlaceholder('Optional, falls dein Anliegen ein Team betrifft')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(60)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('subject')
          .setLabel('Betreff')
          .setPlaceholder('Fasse dein Anliegen kurz zusammen')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Beschreibe dein Anliegen')
          .setPlaceholder('Was ist passiert und wobei benötigst du Hilfe?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(1000)
      )
    );
}

function buildTicketEmbed(ticket) {
  const category = categoryDetails(ticket.category);
  const status = statusDetails(ticket.status);
  const claimedBy = ticket.claimedById ? `<@${ticket.claimedById}>` : 'Noch niemand';
  const embed = new EmbedBuilder()
    .setColor(status.color)
    .setTitle(`Ticket #${formatTicketNumber(ticket.number)}`)
    .addFields(
      { name: 'Status', value: `${status.emoji} ${status.label}`, inline: true },
      { name: 'Kategorie', value: `${category.emoji} ${category.label}`, inline: true },
      { name: 'Erstellt von', value: `<@${ticket.creatorId}>`, inline: true },
      { name: 'Serverrolle', value: ticket.roleLabel || 'Unbekannt', inline: true }
    )
    .setFooter({ text: 'Loco Night Cup Ticket-System' })
    .setTimestamp(new Date(ticket.createdAt));

  if (ticket.category !== 'team_registration') {
    embed.addFields(
      { name: 'Team', value: ticket.teamName || 'Nicht angegeben', inline: true },
      { name: 'Übernommen von', value: claimedBy, inline: true },
      { name: 'Betreff', value: ticket.subject || 'Kein Betreff' },
      { name: 'Anliegen', value: ticket.description || 'Keine Beschreibung' }
    );
  }
  return embed;
}

function buildTeamRegistrationGuideEmbed() {
  return new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle('📝 ANLEITUNG: TEAM REGISTRIEREN')
    .setDescription([
      'Du möchtest dein Team auf dem **Loco-Night-Cup-Server** registrieren? Dann folge einfach diesen Schritten:',
      '',
      '## **1️⃣ MANAGERROLLE AUSWÄHLEN**',
      'Gehe zuerst in den Kanal <#1516543498113908866> und wähle dort die **Managerrolle** aus.',
      '',
      '> ⚠️ **Wichtig:** Nimm dir diese Rolle nur, wenn du wirklich ein eigenes Team auf dem Server registrieren möchtest.',
      '',
      '## **2️⃣ TEAM REGISTRIEREN**',
      'Sobald du die Managerrolle hast, kannst du im Kanal <#1516429663457775687> dein Team registrieren.',
      '',
      'Fülle dort bitte alle abgefragten Angaben **vollständig und korrekt** aus.',
      '',
      '*Die Registrierung ist noch keine Anmeldung für einen bestimmten Cup.* Sie dient dazu, dein Team und alle wichtigen Daten auf dem Server zu hinterlegen. Erst danach kannst du dein Team für die einzelnen Cups anmelden.',
      '',
      '## **3️⃣ DEIN TEAM VERWALTEN**',
      'Im Kanal <#1522775227703103589> kannst du dein registriertes Team anschließend selbst verwalten.',
      '',
      '> 🖼️ **Teamlogo hinterlegen oder ändern**',
      '> 👥 **Co-VMs hinzufügen oder entfernen**',
      '> 🟣 **Twitch-Kanal hinterlegen oder ändern**',
      '> 🎮 **EA-Club-ID hinterlegen oder ändern**',
      '> 🚪 **Dein Team verlassen**',
      '> 🗑️ **Dein Team vollständig löschen**',
      '',
      '## **4️⃣ FÜR EINEN CUP ANMELDEN**',
      'Wenn dein Team vollständig registriert ist, kannst du es in den jeweiligen **Check-in-Kanälen von Montag bis Sonntag** für den gewünschten Cup an- oder abmelden.',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      '✅ **Alles geklappt?** Klicke auf **„Ticket schließen (User)“**.',
      '',
      '🆘 **Du brauchst weiterhin Hilfe?** Klicke auf **„Ticket Mod anfordern“**.',
    ].join('\n'))
    .setFooter({ text: 'Loco Night Cup • Automatische Hilfe zur Teamanmeldung' });
}

function buildTeamRegistrationControls(ticket) {
  const disabled = ticket.status === 'closed';
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_user_close:${ticket.number}`)
      .setLabel('Ticket schließen (User)')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`ticket_request_mod:${ticket.number}`)
      .setLabel(ticket.supportRequestedAt ? 'Ticket Mod angefordert' : 'Ticket Mod anfordern')
      .setEmoji('🆘')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || Boolean(ticket.supportRequestedAt))
  )];
}

function buildTicketControls(ticket) {
  if (ticket.category === 'team_registration') return buildTeamRegistrationControls(ticket);
  const disabled = ticket.status === 'closed';
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_claim:${ticket.number}`)
      .setLabel(ticket.claimedById ? 'Bereits übernommen' : 'Ticket übernehmen')
      .setEmoji('✋')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || Boolean(ticket.claimedById)),
    new ButtonBuilder()
      .setCustomId(`ticket_add_user:${ticket.number}`)
      .setLabel('Person hinzufügen')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`ticket_close:${ticket.number}`)
      .setLabel('Ticket schließen')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  )];
}

function buildUserSelect(ticketNumber) {
  return [new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`ticket_user_select:${ticketNumber}`)
      .setPlaceholder('Servermitglied suchen')
      .setMinValues(1)
      .setMaxValues(1)
  )];
}

function buildCloseConfirmation(ticketNumber) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close_confirm:${ticketNumber}`)
      .setLabel('Ja, schließen')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket_close_cancel:${ticketNumber}`)
      .setLabel('Abbrechen')
      .setStyle(ButtonStyle.Secondary)
  )];
}

function buildCloseModal(ticketNumber) {
  return new ModalBuilder()
    .setCustomId(`ticket_close_modal:${ticketNumber}`)
    .setTitle(`Ticket #${formatTicketNumber(ticketNumber)} schließen`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('close_reason')
        .setLabel('Schließgrund')
        .setPlaceholder('Warum wird das Ticket geschlossen?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(500)
    ));
}

function buildRatingComponents(ticketNumber) {
  return [new ActionRowBuilder().addComponents(
    ...[1, 2, 3, 4, 5].map(value => new ButtonBuilder()
      .setCustomId(`ticket_rate:${ticketNumber}:${value}`)
      .setLabel(String(value))
      .setEmoji('⭐')
      .setStyle(ButtonStyle.Secondary))
  )];
}

function buildRatingModal(ticketNumber, rating) {
  return new ModalBuilder()
    .setCustomId(`ticket_rating_modal:${ticketNumber}:${rating}`)
    .setTitle(`${rating} von 5 Sternen`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rating_feedback')
        .setLabel('Möchtest du uns noch etwas mitteilen?')
        .setPlaceholder('Optionales Feedback zu unserem Support')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(750)
    ));
}

function stars(rating) {
  const value = Number(rating);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? '⭐'.repeat(value) : 'Noch keine Bewertung';
}

function discordTimestamp(value) {
  const milliseconds = new Date(value || 0).getTime();
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? `<t:${Math.floor(milliseconds / 1000)}:F>`
    : 'Unbekannt';
}

function buildLogEmbed(ticket) {
  const category = categoryDetails(ticket.category);
  return new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`Ticket #${formatTicketNumber(ticket.number)} geschlossen`)
    .addFields(
      { name: 'Kategorie', value: `${category.emoji} ${category.label}`, inline: true },
      { name: 'Erstellt von', value: `<@${ticket.creatorId}>`, inline: true },
      { name: 'Serverrolle', value: ticket.roleLabel || 'Unbekannt', inline: true },
      { name: 'Team', value: ticket.teamName || 'Nicht angegeben', inline: true },
      { name: 'Bearbeitet von', value: ticket.claimedById ? `<@${ticket.claimedById}>` : 'Nicht übernommen', inline: true },
      { name: 'Geschlossen von', value: ticket.closedById ? `<@${ticket.closedById}>` : 'Unbekannt', inline: true },
      { name: 'Erstellt am', value: discordTimestamp(ticket.createdAt), inline: true },
      { name: 'Geschlossen am', value: discordTimestamp(ticket.closedAt), inline: true },
      { name: 'Betreff', value: ticket.subject || 'Kein Betreff' },
      { name: 'Anliegen', value: ticket.description || 'Keine Beschreibung' },
      { name: 'Schließgrund', value: ticket.closeReason || 'Nicht angegeben' },
      { name: 'Bewertung', value: stars(ticket.rating), inline: true },
      { name: 'Feedback', value: ticket.ratingFeedback || 'Kein Feedback', inline: false }
    )
    .setFooter({ text: 'Der vollständige Verlauf ist als Datei angehängt.' })
    .setTimestamp(ticket.closedAt ? new Date(ticket.closedAt) : new Date());
}

module.exports = {
  CATEGORIES,
  buildCloseConfirmation,
  buildCloseModal,
  buildCreateModal,
  buildLogEmbed,
  buildPanelComponents,
  buildPanelEmbed,
  buildRatingComponents,
  buildRatingModal,
  buildTicketControls,
  buildTicketEmbed,
  buildTeamRegistrationControls,
  buildTeamRegistrationGuideEmbed,
  buildUserSelect,
  categoryDetails,
  discordTimestamp,
  formatTicketNumber,
  stars,
};
