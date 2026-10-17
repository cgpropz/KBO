import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { handleDataRequest, _clearCache, _setTimeouts, timeouts } from '../api/data.js';
import { clearMemberTierCache, lookupMemberTier, verifyAccessToken } from '../api/_memberTier.js';
import { bearerFor, installJwtSecret, signAccessToken, TEST_JWT_SECRET } from './access-token.mjs';

installJwtSecret();

function profileClient(read) {
  const calls = { profiles: 0, getUser: 0 };
  return {
    calls,
    auth: {
      async getUser() {
        calls.getUser += 1;
        throw new Error('auth.getUser must not run');
      },
    },
    from(table) {
      const filters = {};
      const chain = {
        select() { return chain; },
        eq(col, val) { filters[col] = val; return chain; },
        abortSignal() { return chain; },
        maybeSingle() {
          if (table === 'user_profiles') {
            calls.profiles += 1;
            return read(filters.id, calls.profiles);
          }
          return Promise.resolve({
            data: {
              data: {
                generated_at: new Date().toISOString(),
                cards: Array.from({ length: 6 }, (_, i) => ({
                  name: `Player ${i}`,
                  props: [{ stat: 'SO', line: 1.5, projection: i + 1, cg_projection: i + 10, recommendation: 'OVER' }],
                })),
              },
              updated_at: new Date().toISOString(),
            },
            error: null,
          });
        },
      };
      return chain;
    },
  };
}

test('a slow profile lookup still returns the cached paid tier for that user', async () => {
  clearMemberTierCache();
  const client = profileClient(async () => ({ data: { tier: 'combined' }, error: null }));
  const first = await lookupMemberTier(client, `Bearer ${bearerFor('tok-fan')}`, { budgetMs: 400 });
  assert.equal(first.tier, 'combined');
  assert.equal(first.source, 'profile');
  assert.equal(first.userId, 'u-fan');
  assert.equal(client.calls.getUser, 0);

  const slow = profileClient(() => new Promise(() => {}));
  const second = await lookupMemberTier(slow, `Bearer ${bearerFor('tok-fan')}`, { budgetMs: 40 });
  assert.equal(second.tier, 'combined');
  assert.equal(second.source, 'cache');
  assert.equal(second.userId, 'u-fan');
  assert.equal(slow.calls.getUser, 0);
  clearMemberTierCache();
});

test('an invalid or expired token gets the free preview and does not read the profile', async () => {
  clearMemberTierCache();
  const client = profileClient(async () => ({ data: { tier: 'owner' }, error: null }));
  const forged = signAccessToken({
    aud: 'authenticated',
    role: 'authenticated',
    sub: 'u-owner',
    email: 'CGPropz@gmail.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, 'wrong-secret');
  const invalid = await lookupMemberTier(client, `Bearer ${forged}`, { budgetMs: 400 });
  assert.equal(invalid.tier, 'free');
  assert.equal(invalid.source, 'invalid');
  assert.equal(invalid.userId, null);
  assert.equal(client.calls.profiles, 0);

  const expired = await lookupMemberTier(
    client,
    `Bearer ${bearerFor('tok-owner', { exp: Math.floor(Date.now() / 1000) - 30 })}`,
    { budgetMs: 400 },
  );
  assert.equal(expired.source, 'invalid');
  assert.equal(expired.tier, 'free');
  assert.equal(client.calls.profiles, 0);
  clearMemberTierCache();
});

test('a resolved downgrade drops the cached paid tier', async () => {
  clearMemberTierCache();
  const paid = profileClient(async () => ({ data: { tier: 'monthly' }, error: null }));
  const cached = await lookupMemberTier(paid, `Bearer ${bearerFor('tok-monthly')}`, { budgetMs: 400 });
  assert.equal(cached.source, 'profile');

  const downgraded = profileClient(async () => ({ data: { tier: 'free' }, error: null }));
  const cleared = await lookupMemberTier(downgraded, `Bearer ${bearerFor('tok-monthly')}`, { budgetMs: 400 });
  assert.equal(cleared.tier, 'free');
  assert.equal(cleared.source, 'profile');

  const hung = profileClient(() => new Promise(() => {}));
  const after = await lookupMemberTier(hung, `Bearer ${bearerFor('tok-monthly')}`, { budgetMs: 40 });
  assert.equal(after.pending, true);
  assert.equal(after.source, 'timeout');
  assert.equal(after.tier, null);
  clearMemberTierCache();
});

test('an expired cache entry is pruned and cannot grant a paid tier', async () => {
  clearMemberTierCache();
  let now = 1_000_000;
  const client = profileClient(async () => ({ data: { tier: 'weekly' }, error: null }));
  const warm = await lookupMemberTier(client, `Bearer ${bearerFor('tok-weekly')}`, {
    budgetMs: 400,
    now: () => now,
  });
  assert.equal(warm.source, 'profile');
  now += (5 * 60 * 1000) + 1;
  const hung = profileClient(() => new Promise(() => {}));
  const after = await lookupMemberTier(hung, `Bearer ${bearerFor('tok-weekly')}`, {
    budgetMs: 40,
    now: () => now,
  });
  assert.equal(after.pending, true);
  assert.equal(after.source, 'timeout');
  assert.notEqual(after.tier, 'weekly');
  clearMemberTierCache();
});

test('an ES256 access token verifies from the project JWKS without auth.getUser', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-kid';
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-kid', typ: 'JWT' })).toString('base64url');
  const base = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    role: 'authenticated',
    sub: 'u-es256',
    email: 'fan@example.com',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...(base ? { iss: `${base}/auth/v1` } : {}),
  })).toString('base64url');
  const { sign } = await import('node:crypto');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const verified = await verifyAccessToken(`Bearer ${header}.${payload}.${signature}`, { jwks: [jwk] });
  assert.equal(verified.userId, 'u-es256');
  assert.equal(verified.email, 'fan@example.com');
  assert.equal(TEST_JWT_SECRET.length > 0, true);
});

test('a slow profile still serves the member the full board', async () => {
  const prev = { ...timeouts };
  _setTimeouts({ tierLookupMs: 400 });
  try {
    _clearCache();
    const warm = profileClient(async () => ({ data: { tier: 'combined' }, error: null }));
    const warmRes = mockRes();
    await handleDataRequest(
      { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: `Bearer ${bearerFor('tok-fan')}` } },
      warmRes,
      warm,
    );
    assert.equal(warmRes.statusCode, 200);
    assert.equal(warmRes.body.preview, false);
    assert.equal(warmRes.body.tier, 'combined');
    assert.equal(warm.calls.getUser, 0);

    const cold = profileClient(() => new Promise(() => {}));
    const coldRes = mockRes();
    await handleDataRequest(
      { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: `Bearer ${bearerFor('tok-fan')}` } },
      coldRes,
      cold,
    );
    assert.equal(coldRes.statusCode, 200);
    assert.equal(coldRes.body.preview, false);
    assert.equal(coldRes.body.tier, 'combined');
    assert.ok(coldRes.body.data.cards.length > 3);
    assert.equal(cold.calls.getUser, 0);
  } finally {
    _setTimeouts(prev);
    _clearCache();
  }
});

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
}
