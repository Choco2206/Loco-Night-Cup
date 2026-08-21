'use strict';

const { ensureRoyaleBaseResources } = require('./royale-resources');
const { handleRoyaleInteraction } = require('./royale-interactions');
const { ensureRoyaleCycle } = require('./royale-service');
const { getRoyaleState, lockRoyaleAndCreateBracket } = require('./royale-service');
const { syncRoyaleRoundResources } = require('./royale-rounds');
const { postRoyaleCeremony } = require('./royale-ceremony');

let reconcileTimer = null;

async function reconcile(client, now = new Date()) {
  ensureRoyaleCycle(now);
  let event = getRoyaleState(now);
  if (!event.bracket && event.schedule?.bracketAt && now.getTime() >= new Date(event.schedule.bracketAt).getTime()
    && now.getTime() < new Date(event.schedule.resetAt).getTime()) {
    try { lockRoyaleAndCreateBracket({ actorUserId: 'automatic', now }); } catch (error) { console.warn(`[royale] Turnierbaum noch nicht erstellt: ${error.message}`); }
    event = getRoyaleState(now);
  }
  if (event.bracket && now.getTime() >= new Date(event.schedule.tournamentStartAt).getTime()) await syncRoyaleRoundResources(client);
  if (event.bracket?.status === 'completed') await postRoyaleCeremony(client);
}

async function init(client) {
  ensureRoyaleCycle();
  await ensureRoyaleBaseResources(client);
  await reconcile(client);
  if (!reconcileTimer) reconcileTimer = setInterval(() => reconcile(client).catch(error => console.error('[royale] Abgleich fehlgeschlagen:', error)), 60000);
}

module.exports = {
  ...require('./royale-bracket'),
  ...require('./royale-format'),
  ...require('./royale-schedule'),
  ...require('./royale-ceremony'),
  handleRoyaleInteraction,
  init,
  reconcile,
};
