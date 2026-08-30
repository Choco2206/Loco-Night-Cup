'use strict';

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const DEFAULT_CHANNEL_ID = '1543568893237264445';
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const STATE_FILE = path.join(process.cwd(), 'data', 'facebook-feed-state.json');

let pollTimer = null;
let pollRunning = false;

function getConfig() {
  return {
    pageId: String(process.env.FACEBOOK_PAGE_ID || '').trim(),
    accessToken: String(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim(),
    channelId: String(process.env.FACEBOOK_DISCORD_CHANNEL_ID || DEFAULT_CHANNEL_ID).trim(),
    graphVersion: String(process.env.FACEBOOK_GRAPH_VERSION || 'v23.0').trim(),
    pollIntervalMs: Math.max(
      30_000,
      Number.parseInt(process.env.FACEBOOK_POLL_INTERVAL_MS || String(DEFAULT_POLL_INTERVAL_MS), 10) || DEFAULT_POLL_INTERVAL_MS,
    ),
  };
}

function isConfigured(config) {
  return Boolean(config.pageId && config.accessToken && config.channelId);
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      initialized: Boolean(parsed.initialized),
      seenPostIds: Array.isArray(parsed.seenPostIds) ? parsed.seenPostIds.map(String).slice(0, 100) : [],
    };
  } catch {
    return { initialized: false, seenPostIds: [] };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({
      initialized: Boolean(state.initialized),
      seenPostIds: Array.from(new Set(state.seenPostIds.map(String))).slice(0, 100),
      updatedAt: new Date().toISOString(),
    }, null, 2),
    'utf8',
  );
}

function getAttachmentImage(post) {
  const attachment = post?.attachments?.data?.[0];
  if (!attachment) return null;

  const directImage = attachment?.media?.image?.src;
  if (directImage) return directImage;

  const subattachments = attachment?.subattachments?.data || [];
  for (const subattachment of subattachments) {
    const image = subattachment?.media?.image?.src;
    if (image) return image;
  }

  return null;
}

function buildPostEmbed(post) {
  const message = String(post.message || '').trim();
  const description = message
    ? message.slice(0, 4000)
    : '*Neuer Beitrag auf unserer Facebook-Seite.*';

  const embed = new EmbedBuilder()
    .setColor(0x1877f2)
    .setAuthor({ name: 'Loco Night Cup auf Facebook' })
    .setDescription(description)
    .setTimestamp(post.created_time ? new Date(post.created_time) : new Date());

  if (post.permalink_url) {
    embed.setURL(post.permalink_url);
    embed.setTitle('📱 Neuer Facebook-Beitrag');
  } else {
    embed.setTitle('📱 Neuer Facebook-Beitrag');
  }

  const image = getAttachmentImage(post);
  if (image) embed.setImage(image);

  return embed;
}

async function fetchLatestPosts(config) {
  const fields = [
    'id',
    'message',
    'created_time',
    'permalink_url',
    'attachments{media_type,media,url,subattachments{media_type,media,url}}',
  ].join(',');

  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.pageId)}/feed`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('limit', '10');
  url.searchParams.set('access_token', config.accessToken);

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Facebook Graph API: ${detail}`);
  }

  return Array.isArray(body.data) ? body.data : [];
}

async function resolveDiscordChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel?.send) {
    throw new Error(`Discord-Kanal ${channelId} wurde nicht gefunden oder ist nicht beschreibbar.`);
  }
  return channel;
}

async function postToDiscord(channel, post) {
  const payload = {
    embeds: [buildPostEmbed(post)],
    allowedMentions: { parse: [] },
  };

  if (post.permalink_url) {
    payload.content = `📱 **Neuer Post auf Facebook**\n${post.permalink_url}`;
  } else {
    payload.content = '📱 **Neuer Post auf Facebook**';
  }

  await channel.send(payload);
}

async function poll(client, { initial = false } = {}) {
  if (pollRunning) return;
  pollRunning = true;

  try {
    const config = getConfig();
    if (!isConfigured(config)) return;

    const posts = await fetchLatestPosts(config);
    if (!posts.length) return;

    const state = readState();
    const currentIds = posts.map(post => String(post.id)).filter(Boolean);

    // Beim allerersten Start nur den aktuellen Stand merken. So wird der Discord-Kanal
    // nicht mit alten Facebook-Posts geflutet. Ab dem nächsten Check werden nur neue Posts gesendet.
    if (!state.initialized) {
      writeState({ initialized: true, seenPostIds: currentIds });
      console.log(`[Facebook] Initialisiert mit ${currentIds.length} vorhandenen Posts.`);
      return;
    }

    const seen = new Set(state.seenPostIds);
    const newPosts = posts
      .filter(post => post.id && !seen.has(String(post.id)))
      .sort((a, b) => new Date(a.created_time || 0) - new Date(b.created_time || 0));

    if (!newPosts.length) return;

    const channel = await resolveDiscordChannel(client, config.channelId);
    const successfullyPostedIds = [];

    for (const post of newPosts) {
      await postToDiscord(channel, post);
      successfullyPostedIds.push(String(post.id));
      console.log(`[Facebook] Post ${post.id} nach Discord weitergeleitet.`);
    }

    writeState({
      initialized: true,
      seenPostIds: [...successfullyPostedIds, ...currentIds, ...state.seenPostIds],
    });
  } catch (error) {
    const prefix = initial ? '[Facebook] Initialisierung fehlgeschlagen:' : '[Facebook] Abruf fehlgeschlagen:';
    console.error(prefix, error?.message || error);
  } finally {
    pollRunning = false;
  }
}

async function init(client) {
  const config = getConfig();

  if (!isConfigured(config)) {
    console.log('[Facebook] Deaktiviert. FACEBOOK_PAGE_ID und FACEBOOK_PAGE_ACCESS_TOKEN fehlen.');
    return;
  }

  await poll(client, { initial: true });

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    poll(client).catch(error => console.error('[Facebook] Unerwarteter Polling-Fehler:', error));
  }, config.pollIntervalMs);
  pollTimer.unref?.();

  console.log(`[Facebook] Überwachung aktiv → Discord-Kanal ${config.channelId}, Intervall ${Math.round(config.pollIntervalMs / 1000)}s.`);
}

module.exports = {
  init,
  poll,
  fetchLatestPosts,
  buildPostEmbed,
};
