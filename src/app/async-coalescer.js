'use strict';

const states = new Map();

function enqueueCoalesced(key, task, debounceMs = 150) {
  const normalizedKey = String(key);
  let state = states.get(normalizedKey);
  if (!state) {
    state = { running: false, scheduled: false, dirty: false, task: null, waiters: [] };
    states.set(normalizedKey, state);
  }
  state.task = task;
  state.dirty = true;

  const promise = new Promise((resolve, reject) => state.waiters.push({ resolve, reject }));
  if (!state.running && !state.scheduled) {
    state.scheduled = true;
    const timer = setTimeout(() => run(normalizedKey, state), Math.max(0, Number(debounceMs) || 0));
    if (typeof timer.unref === 'function') timer.unref();
  }
  return promise;
}

async function run(key, state) {
  state.scheduled = false;
  state.running = true;
  let result;
  try {
    do {
      state.dirty = false;
      result = await state.task();
    } while (state.dirty);
    const waiters = state.waiters.splice(0);
    for (const waiter of waiters) waiter.resolve(result);
  } catch (error) {
    const waiters = state.waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  } finally {
    state.running = false;
    if (state.dirty || state.waiters.length) {
      state.scheduled = true;
      const timer = setTimeout(() => run(key, state), 0);
      if (typeof timer.unref === 'function') timer.unref();
    } else {
      states.delete(key);
    }
  }
}

module.exports = { enqueueCoalesced };

