import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appMetadataWithTier,
  backfillTierClaims,
  claimUnlocksSport,
  profileTierClaim,
  subscriptionDeletedClaimResult,
  withinTierBackfillWindow,
  writeTierClaim,
} from '../api/_tierClaim.js';

test('a tier claim keeps the other app_metadata fields', () => {
  assert.deepEqual(
    appMetadataWithTier({ provider: 'email', providers: ['email'] }, ' combined '),
    { provider: 'email', providers: ['email'], tier: 'combined' },
  );
  assert.equal(appMetadataWithTier({ provider: 'email' }, ' '), null);
  assert.deepEqual(appMetadataWithTier(null, 'weekly'), { tier: 'weekly' });
});

test('only a tier that unlocks a sport is a trusted claim', () => {
  for (const tier of ['owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined', 'kbo', 'wnba']) {
    assert.equal(claimUnlocksSport(tier), true, tier);
  }
  for (const tier of ['free', 'discord', 'admin', '', ' ', 'nfl', 'nhl', null, undefined]) {
    assert.equal(claimUnlocksSport(tier), false, String(tier));
  }
});

test('a free sync writes the profile tier, and a failed cancellation claim is 500', () => {
  assert.equal(profileTierClaim(undefined), 'free');
  assert.equal(profileTierClaim(''), 'free');
  assert.equal(profileTierClaim(' free '), 'free');
  assert.equal(profileTierClaim('combined'), 'combined');
  assert.equal(subscriptionDeletedClaimResult(true), null);
  assert.deepEqual(subscriptionDeletedClaimResult(false), {
    status: 500,
    body: { error: 'tier claim failed' },
  });
});

test('the backfill window is midnight until 6 AM ET', () => {
  assert.equal(withinTierBackfillWindow(new Date('2026-01-15T00:00:00-05:00')), true);
  assert.equal(withinTierBackfillWindow(new Date('2026-01-15T05:59:00-05:00')), true);
  assert.equal(withinTierBackfillWindow(new Date('2026-07-15T04:15:00-04:00')), true);
  assert.equal(withinTierBackfillWindow(new Date('2026-07-15T06:00:00-04:00')), false);
  assert.equal(withinTierBackfillWindow(new Date('2026-07-15T15:00:00-04:00')), false);
  assert.equal(withinTierBackfillWindow(new Date('2026-01-15T23:30:00-05:00')), false);
});

test('writeTierClaim merges onto the auth user and skips an unchanged tier', async () => {
  const updates = [];
  const supabase = {
    auth: {
      admin: {
        async getUserById(id) {
          assert.equal(id, 'user-1');
          return { data: { user: { id, app_metadata: { provider: 'email', tier: 'free' } } }, error: null };
        },
        async updateUserById(id, body) {
          updates.push({ id, body });
          return { error: null };
        },
      },
    },
  };
  assert.equal(await writeTierClaim(supabase, 'user-1', 'combined'), true);
  assert.deepEqual(updates[0].body.app_metadata, { provider: 'email', tier: 'combined' });
  supabase.auth.admin.getUserById = async () => ({
    data: { user: { id: 'user-1', app_metadata: { provider: 'email', tier: 'combined' } } },
    error: null,
  });
  assert.equal(await writeTierClaim(supabase, 'user-1', 'combined'), true);
  assert.equal(updates.length, 1);
});

test('backfill copies paid profile tiers and skips free, discord, and blank', async () => {
  const users = {
    u1: { app_metadata: { provider: 'email' } },
    u2: { app_metadata: { provider: 'email', tier: 'free' } },
    u4: { app_metadata: { provider: 'email', tier: 'combined' } },
    u5: { app_metadata: { provider: 'email' } },
  };
  const rows = [
    { id: 'u1', tier: 'combined' },
    { id: 'u2', tier: 'free' },
    { id: 'u3', tier: '' },
    { id: 'u4', tier: 'discord' },
    { id: 'u5', tier: 'kbo' },
  ];
  const secret = 'service-role-secret';
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, method: init.method || 'GET' });
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    assert.equal(href.includes(secret), false);
    if (href.includes('/rest/v1/user_profiles')) {
      const offset = new URL(href).searchParams.get('offset');
      return { ok: true, status: 200, json: async () => (offset === '0' ? rows : []) };
    }
    const id = decodeURIComponent(href.split('/').pop());
    if ((init.method || 'GET') === 'GET') {
      if (!users[id]) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => users[id] };
    }
    const body = JSON.parse(init.body);
    users[id] = { app_metadata: body.app_metadata };
    return { ok: true, status: 200, json: async () => users[id] };
  };
  const summary = await backfillTierClaims({
    url: 'https://project.supabase.co',
    key: secret,
    fetchImpl,
  });
  assert.deepEqual(summary, { updated: 2, skipped: 3, failed: 0, dryRun: false });
  assert.deepEqual(users.u1.app_metadata, { provider: 'email', tier: 'combined' });
  assert.equal(users.u2.app_metadata.tier, 'free');
  assert.equal(users.u4.app_metadata.tier, 'combined');
  assert.deepEqual(users.u5.app_metadata, { provider: 'email', tier: 'kbo' });
  assert.equal(calls.some((call) => call.method === 'PUT' && call.href.endsWith('/u2')), false);
  assert.equal(calls.some((call) => call.method === 'PUT' && call.href.endsWith('/u4')), false);

  const dry = await backfillTierClaims({
    url: 'https://project.supabase.co',
    key: secret,
    fetchImpl,
    dryRun: true,
  });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.updated, 0);
  assert.equal(calls.some((call) => call.href.includes(secret)), false);
});
