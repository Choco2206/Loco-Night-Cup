'use strict';

const { ensureAllCheckinMessages } = require('./checkin-panel');
const { handleInteraction: handleNormalInteraction } = require('./checkin-interactions');
const { startCheckinReconcile } = require('./checkin-reconcile');
const bomberRegistration = require('./bomber-x-loco-registration');
const bomberManualDraw = require('./bomber-x-loco-manual-draw');

async function init(client) {
  // Der offizielle Bomber-X-Loco-Check-in läuft unabhängig vom normalen Saturday-State,
  // solange die regulären Samstags-Cups am 05.09. und 12.09. noch anstehen.
  // Erst wenn der rollierende Saturday-Zyklus selbst den 19.09. erreicht, übernimmt
  // bomberRegistration die bestehenden Bomber-Anmeldungen in genau diesen Event-State.
  await bomberRegistration.init(client);
  await ensureAllCheckinMessages(client);
  bomberManualDraw.scheduleManualDrawPreparation(client);
  startCheckinReconcile(client);
}

async function handleInteraction(interaction, client) {
  if (await bomberRegistration.handleInteraction(interaction, client)) return true;
  if (await bomberManualDraw.handleInteraction(interaction, client)) return true;
  return handleNormalInteraction(interaction, client);
}

module.exports = {
  handleInteraction,
  init,
  startCheckinReconcile,
};
