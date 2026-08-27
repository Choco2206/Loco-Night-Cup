'use strict';

const EA_BASE_URL = 'https://proclubs.ea.com/api/fc';
const DEFAULT_PLATFORM = 'common-gen5';
const REQUEST_TIMEOUT_MS = 25000;
const MIN_REQUEST_GAP_MS = 750;
const FRIENDLY_CACHE_TTL_MS = 60000;
const MAX_REQUEST_ATTEMPTS = 3;

let queueTail = Promise.resolve();
let nextRequestAt = 0;
const friendlyCache = new Map();
let diagnostics = null;

function setEaDiagnostics(handler) {
  diagnostics = typeof handler === 'function' ? handler : null;
}

function emitDiagnostic(payload) {
  if (!diagnostics) return;
  Promise.resolve(diagnostics({ at: new Date().toISOString(), ...payload })).catch(() => null);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runQueued(task) {
  const run = async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs) await sleep(waitMs);
    try {
      return await task();
    } finally {
      nextRequestAt = Date.now() + MIN_REQUEST_GAP_MS;
    }
  };
  const current = queueTail.then(run, run);
  queueTail = current.catch(() => null);
  return current;
}

function browserHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    referer: 'https://proclubs.ea.com/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  };
}

async function fetchJson(url, context = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      emitDiagnostic({ type: 'request_started', attempt, ...context });
      const result = await runQueued(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        if (typeof timeout.unref === 'function') timeout.unref();
        try {
          const response = await fetch(url, {
            headers: browserHeaders(),
            signal: controller.signal,
          });
          if (!response.ok) {
            const error = new Error(`EA Clubs antwortet mit HTTP ${response.status}.`);
            error.status = response.status;
            throw error;
          }
          return response.json();
        } finally {
          clearTimeout(timeout);
        }
      });
      emitDiagnostic({ type: 'request_succeeded', attempt, durationMs: Date.now() - startedAt, ...context });
      return result;
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? new Error(`EA Clubs hat nach ${Math.round(REQUEST_TIMEOUT_MS / 1000)} Sekunden nicht geantwortet.`)
        : error;
      emitDiagnostic({
        type: error?.name === 'AbortError' ? 'request_timeout' : 'request_failed',
        attempt,
        durationMs: Date.now() - startedAt,
        error: String(lastError?.message || lastError),
        ...context,
      });
      const retryable = error?.name === 'AbortError' || Number(error?.status) >= 500 || error?.status === 429;
      if (!retryable || attempt >= MAX_REQUEST_ATTEMPTS) break;
      await sleep(1000 * attempt * attempt);
    }
  }
  throw lastError || new Error('EA Clubs Anfrage fehlgeschlagen.');
}

async function requestJson(path, params, context = {}) {
  const url = new URL(`${EA_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return fetchJson(url, { path, ...context });
}

function clubArray(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['clubs', 'items', 'results', 'leaderboard']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return payload && typeof payload === 'object'
    ? Object.values(payload).filter(value => value && typeof value === 'object')
    : [];
}

function normalizeClub(raw) {
  const clubId = raw?.clubId ?? raw?.club_id ?? raw?.id;
  const name = raw?.name ?? raw?.clubName ?? raw?.club_name;
  if (clubId === null || clubId === undefined || !name) return null;
  return { clubId: String(clubId), name: String(name), raw };
}

async function searchClubs(clubName, platform = DEFAULT_PLATFORM) {
  const payload = await requestJson('allTimeLeaderboard/search', { platform, clubName }, { operation: 'club_search' });
  return clubArray(payload).map(normalizeClub).filter(Boolean);
}

async function resolveClub(clubName, platform = DEFAULT_PLATFORM) {
  const cleanName = String(clubName || '').trim();
  if (!cleanName) return null;
  const clubs = await searchClubs(cleanName, platform);
  const exact = clubs.filter(club => club.name.localeCompare(cleanName, 'de', { sensitivity: 'base' }) === 0);
  if (exact.length === 1) return { ...exact[0], platform };
  if (!exact.length && clubs.length === 1) return { ...clubs[0], platform };
  if (!clubs.length) throw new Error(`EA-Club **${cleanName}** wurde nicht gefunden.`);
  throw new Error(`EA-Clubname **${cleanName}** ist nicht eindeutig. Bitte gib den Namen exakt wie in EA FC ein.`);
}

async function getFriendlyMatches(clubId, platform = DEFAULT_PLATFORM, maxResultCount = 50) {
  const cacheKey = `${platform}:${clubId}:${maxResultCount}`;
  const cached = friendlyCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < FRIENDLY_CACHE_TTL_MS) {
    emitDiagnostic({
      type: 'cache_hit',
      operation: 'friendly_matches',
      clubId: String(clubId),
      platform,
      matchCount: cached.matches.length,
      ageMs: Date.now() - cached.storedAt,
    });
    return cached.matches;
  }

  const payload = await requestJson('clubs/matches', {
    platform,
    clubIds: clubId,
    matchType: 'friendlyMatch',
    maxResultCount,
  }, {
    operation: 'friendly_matches',
    clubId: String(clubId),
    platform,
  });
  const matches = Array.isArray(payload) ? payload : (payload?.matches || []);
  friendlyCache.set(cacheKey, { storedAt: Date.now(), matches });
  emitDiagnostic({
    type: 'cache_store',
    operation: 'friendly_matches',
    clubId: String(clubId),
    platform,
    matchCount: matches.length,
  });
  return matches;
}

function clearFriendlyMatchCache() {
  friendlyCache.clear();
}

module.exports = {
  DEFAULT_PLATFORM,
  FRIENDLY_CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  clearFriendlyMatchCache,
  getFriendlyMatches,
  resolveClub,
  searchClubs,
  setEaDiagnostics,
};
