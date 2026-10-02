'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('co-manager additions reject active personal bans before saving and allow expired or revoked bans', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lnc-co-manager-ban-'));
  try {
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const { FILES, writeJsonAtomic } = require(${JSON.stringify(path.resolve(__dirname, '../src/storage'))});
      const { addCoManager, adminAddCoManager } = require(${JSON.stringify(path.resolve(__dirname, '../src/domain/teams/team-service'))});
      const settings = { teams: { coManagerLimit: 5 }, channels: { banlistChannelId: '123456789012345678' } };
      const team = { id: 'new-club', status: 'active', manager: { userId: 'vm' }, coManagers: [], meta: {} };
      const future = new Date(Date.now() + 86400000).toISOString();
      const past = new Date(Date.now() - 86400000).toISOString();
      const targets = [
        { managerId: 'banned' }, { coManagerIds: ['banned'] },
        { affectedUsers: [{ userId: 'banned' }] }, { targets: { userIds: ['banned'] } },
        { targets: { managerUserId: 'banned' } }, { targets: { coManagerUserIds: ['banned'] } },
        { target: { userIds: ['banned'] } }, { target: { userId: 'banned' } }, { userId: 'banned' },
      ];
      for (const add of [addCoManager, adminAddCoManager]) {
        for (const target of targets) {
          writeJsonAtomic(FILES.teams, { teams: [team] });
          writeJsonAtomic(FILES.bans, { bans: [{ status: 'active', teamId: 'old-club', expiresAt: future, ...target }] });
          const before = fs.readFileSync(FILES.teams, 'utf8');
          assert.throws(() => add({ teamId: team.id, userId: 'banned', actorUserId: 'vm', settings }), error => {
            assert.match(error.message, /aktive Sperre/);
            assert.match(error.message, /<#123456789012345678>/);
            return true;
          });
          assert.equal(fs.readFileSync(FILES.teams, 'utf8'), before);
        }
        for (const ban of [
          { status: 'active', userId: 'banned', expiresAt: past },
          { status: 'revoked', userId: 'banned', expiresAt: future },
          { status: 'active', userId: 'other', expiresAt: future },
          { status: 'active', teamId: 'old-club', expiresAt: future },
        ]) {
          writeJsonAtomic(FILES.teams, { teams: [team] });
          writeJsonAtomic(FILES.bans, { bans: [ban] });
          const result = add({ teamId: team.id, userId: 'banned', actorUserId: 'vm', settings });
          assert.equal(result.coManagers[0].userId, 'banned');
        }
      }
    `], { cwd, stdio: 'pipe' });
    assert.ok(true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
