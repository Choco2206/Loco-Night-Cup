'use strict';

const config = require('../config');
const { normalizePosition } = require('../position-normalizer');

class ProClubsApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProClubsApiError';
    this.code = code;
    this.retryable = Boolean(details.retryable);
    this.status = details.status || null;
  }
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return value === undefined || value === null ? null : String(value); }

function normalizeClub(raw) {
  if (!object(raw)) throw new ProClubsApiError('unsupported_response_shape', 'EA-Clubdaten sind kein Objekt.');
  // EA responses seen by the bot must expose these semantic fields. Alternate
  // names are deliberately not guessed: add them only from a captured fixture.
  const clubId = text(raw.clubId);
  const name = text(raw.name);
  if (!clubId || !name) throw new ProClubsApiError('unsupported_response_shape', 'EA-Clubantwort enthaelt clubId/name nicht in der verifizierten Form.');
  return { clubId, name, platform: text(raw.platform) || config.platform, raw };
}

function normalizePlayer(raw, context = {}) {
  if (!object(raw)) throw new ProClubsApiError('unsupported_response_shape', 'EA-Spielerdaten sind kein Objekt.');
  const playerName = text(raw.playername);
  const position = text(raw.pos);
  const rating = Number(raw.rating);
  if (!playerName || !position) throw new ProClubsApiError('unsupported_response_shape', 'EA-Spielerantwort enthaelt playername/pos nicht in der verifizierten Form.');
  return {
    playerName,
    proClubId: text(context.clubId),
    position,
    normalizedPosition: normalizePosition(position),
    rating: Number.isFinite(rating) ? rating : null,
    playerId: text(context.playerId),
    isHuman: Number(raw.secondsPlayed) > 0 && Number(raw.gameTime ?? raw.secondsPlayed) > 0,
    goals: Number.isFinite(Number(raw.goals)) ? Number(raw.goals) : null,
    assists: Number.isFinite(Number(raw.assists)) ? Number(raw.assists) : null,
    cards: object(raw.cards) ? raw.cards : null,
    playerOfTheMatch: Number(raw.mom) > 0,
    minutes: Number.isFinite(Number(raw.secondsPlayed)) ? Number(raw.secondsPlayed) / 60 : null,
    secondsPlayed: Number(raw.secondsPlayed) || 0,
    saves: Number(raw.saves) || 0,
    tackles: Number(raw.tacklesmade) || 0,
    redCards: Number(raw.redcards) || 0,
    raw,
  };
}

function normalizeMatch(raw) {
  if (!object(raw)) throw new ProClubsApiError('unsupported_response_shape', 'EA-Matchdaten sind kein Objekt.');
  if (!raw.matchId || !raw.timestamp || !object(raw.clubs) || !object(raw.players)) {
    throw new ProClubsApiError('unsupported_response_shape', 'EA-Matchantwort entspricht noch keiner verifizierten Fixture-Struktur.');
  }
  const clubEntries = Object.entries(raw.clubs).filter(([key]) => key !== 'aggregate');
  if (clubEntries.length !== 2) throw new ProClubsApiError('unsupported_response_shape', 'EA-Match enthaelt nicht exakt zwei Clubs.');
  const side = ([key, entry]) => {
    const details = entry.details || {};
    const clubId = text(details.clubId || key);
    const club = normalizeClub({ clubId, name: details.name, platform: config.platform });
    const playerObject = object(raw.players[clubId]) ? raw.players[clubId] : (object(raw.players[key]) ? raw.players[key] : {});
    return { club, goals: Number(entry.goals), goalsAgainst: Number(entry.goalsAgainst), players: Object.entries(playerObject).filter(([id]) => id !== 'aggregate').map(([playerId, player]) => normalizePlayer(player, { clubId, playerId })) };
  };
  const [home, away] = clubEntries.map(side);
  return { matchId: text(raw.matchId), timestamp: new Date(Number(raw.timestamp) < 1e12 ? Number(raw.timestamp) * 1000 : raw.timestamp).toISOString(), matchType: 'friendlyMatch', home, away, raw };
}

class EaProClubsProvider {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.baseUrl;
    this.timeoutMs = options.timeoutMs || config.timeoutMs;
    this.fetch = options.fetch || global.fetch;
    if (typeof this.fetch !== 'function') throw new Error('Native fetch ist in dieser Node.js-Version nicht verfuegbar.');
  }

  async request(pathname, params) {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/${pathname.replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Loco-Night-Cup-Bot/1.0', 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' } });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok) throw new ProClubsApiError(`http_${response.status}`, `EA Pro Clubs antwortete mit HTTP ${response.status}.`, { status: response.status, retryable: response.status === 429 || response.status >= 500 });
        if (!contentType.toLowerCase().includes('json')) throw new ProClubsApiError('invalid_content_type', 'EA Pro Clubs lieferte keine JSON-Antwort.');
        return await response.json();
      } catch (error) {
        lastError = error?.name === 'AbortError' ? new ProClubsApiError('timeout', 'EA Pro Clubs Zeitlimit ueberschritten.', { retryable: true }) : error;
        if (!lastError.retryable || attempt === 3) throw lastError;
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
      } finally { clearTimeout(timer); }
    }
    throw lastError;
  }

  async searchClubsByName(clubName, platform = config.platform) {
    const raw = await this.request('/allTimeLeaderboard/search', { platform, clubName });
    if (!Array.isArray(raw)) throw new ProClubsApiError('unsupported_response_shape', 'EA-Clubsuche lieferte keine verifizierte Liste.');
    return raw.map(normalizeClub);
  }
  async getClubInfo(clubId, platform = config.platform) {
    const raw = await this.request('/clubs/info', { platform, clubIds: clubId });
    const entry = Array.isArray(raw) ? raw[0] : raw;
    return normalizeClub(entry);
  }
  async getRecentFriendlyMatches(clubId, platform = config.platform, maxResultCount = config.matchResultCount) {
    const raw = await this.request('/clubs/matches', { clubIds: clubId, platform, matchType: 'friendlyMatch', maxResultCount });
    if (!Array.isArray(raw)) throw new ProClubsApiError('unsupported_response_shape', 'EA-Matchantwort lieferte keine verifizierte Liste.');
    return raw.map(normalizeMatch);
  }
}

module.exports = { EaProClubsProvider, ProClubsApiError, normalizeClub, normalizeMatch, normalizePlayer };
