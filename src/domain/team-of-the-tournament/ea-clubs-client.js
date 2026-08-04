'use strict';

const EA_BASE_URL = 'https://proclubs.ea.com/api/fc';
const DEFAULT_PLATFORM = 'common-gen5';
const REQUEST_TIMEOUT_MS = 10000;

async function requestJson(path, params) {
  const url = new URL(`${EA_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (typeof timeout.unref === 'function') timeout.unref();
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`EA Clubs antwortet mit HTTP ${response.status}.`);
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('EA Clubs hat nicht rechtzeitig geantwortet.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function clubArray(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['clubs', 'items', 'results', 'leaderboard']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return payload && typeof payload === 'object' ? Object.values(payload).filter(value => value && typeof value === 'object') : [];
}

function normalizeClub(raw) {
  const clubId = raw?.clubId ?? raw?.club_id ?? raw?.id;
  const name = raw?.name ?? raw?.clubName ?? raw?.club_name;
  if (clubId === null || clubId === undefined || !name) return null;
  return { clubId: String(clubId), name: String(name), raw };
}

async function searchClubs(clubName, platform = DEFAULT_PLATFORM) {
  const payload = await requestJson('allTimeLeaderboard/search', { platform, clubName });
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
  const payload = await requestJson('clubs/matches', {
    platform,
    clubIds: clubId,
    matchType: 'friendlyMatch',
    maxResultCount,
  });
  return Array.isArray(payload) ? payload : (payload?.matches || []);
}

module.exports = { DEFAULT_PLATFORM, getFriendlyMatches, resolveClub, searchClubs };

