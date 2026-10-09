'use strict';

function escapeLabel(value) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').replace(/([\\`*_{}\[\]()<>~|])/g, '\\$1');
}

function profileLink(userId, name = 'Unbekannter Nutzer') {
  if (!userId) return 'Kein VM';
  return `[@${escapeLabel(String(name).slice(0, 100))}](https://discord.com/users/${userId})`;
}

async function resolveProfileLinks(client, guild, teams) {
  const ids = [...new Set(teams.flatMap(team => [team.manager?.userId, ...(team.coManagers || []).map(co => co.userId)]).filter(Boolean).map(String))];
  const links = new Map();
  // Fresh fetch per refresh, with limited concurrency to avoid a request burst.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const member = await guild?.members.fetch({ user: id, force: true }).catch(() => null);
      const user = member?.user || await client.users.fetch(id, { force: true }).catch(() => null);
      links.set(id, profileLink(id, member?.displayName || user?.globalName || user?.username || 'Unbekannter Nutzer'));
    }
  }));
  return links;
}

module.exports = { escapeLabel, profileLink, resolveProfileLinks };
