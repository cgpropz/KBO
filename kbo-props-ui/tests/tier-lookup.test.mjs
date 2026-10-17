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

test('alg none, a forged or unknown kid, and the wrong iss, aud, or role do not verify', async () => {
  clearMemberTierCache();
  const env = {
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  };
  const claims = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: 'u-fan',
    email: 'fan@example.com',
    exp: Math.floor(Date.now() / 1000) + 600,
    iss: 'https://project.supabase.co/auth/v1',
  };
  const client = profileClient(async () => ({ data: { tier: 'combined' }, error: null }));
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const nonePayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const none = await lookupMemberTier(client, `Bearer ${noneHeader}.${nonePayload}.`, { env, budgetMs: 400 });
  assert.equal(none.source, 'invalid');
  assert.equal(none.userId, null);

  const forged = await lookupMemberTier(
    client,
    `Bearer ${signAccessToken(claims, 'wrong-secret')}`,
    { env, secret: TEST_JWT_SECRET, budgetMs: 400 },
  );
  assert.equal(forged.source, 'invalid');

  for (const bad of [
    { ...claims, iss: 'https://evil.example/auth/v1' },
    { ...claims, aud: 'anon' },
    { ...claims, role: 'service_role' },
  ]) {
    const verified = await verifyAccessToken(`Bearer ${signAccessToken(bad)}`, { env, secret: TEST_JWT_SECRET });
    assert.equal(verified, null);
  }
  assert.equal(client.calls.profiles, 0);

  let now = 1_700_000_000_000;
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return {
      ok: true,
      json: async () => ({ keys: [{ kid: 'real-kid', kty: 'EC', crv: 'P-256' }] }),
    };
  };
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'forged-kid', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = `${header}.${payload}.${Buffer.from('not-a-signature').toString('base64url')}`;
  const opts = { env, fetchImpl, now: () => now };
  assert.equal(await verifyAccessToken(`Bearer ${token}`, opts), null);
  assert.equal(fetches, 2);
  assert.equal(await verifyAccessToken(`Bearer ${token}`, opts), null);
  assert.equal(fetches, 2);
  now += 60_000;
  assert.equal(await verifyAccessToken(`Bearer ${token}`, opts), null);
  assert.equal(fetches, 3);
  const lookedUp = await lookupMemberTier(client, `Bearer ${token}`, opts);
  assert.equal(lookedUp.source, 'invalid');
  assert.equal(client.calls.profiles, 0);
  clearMemberTierCache();
});

test('forged-kid tokens fetch JWKS at most once a minute when no keys come back', async () => {
  clearMemberTierCache();
  const env = { VITE_SUPABASE_URL: 'https://project.supabase.co' };
  const claims = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: 'u-fan',
    email: 'fan@example.com',
    exp: 1_700_000_600,
    iss: 'https://project.supabase.co/auth/v1',
  };
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'forged-kid', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = `Bearer ${header}.${payload}.${Buffer.from('not-a-signature').toString('base64url')}`;
  let now = 1_700_000_000_000;

  async function burst(fetchImpl) {
    let fetches = 0;
    const counting = async (...args) => {
      fetches += 1;
      return fetchImpl(...args);
    };
    const opts = { env, fetchImpl: counting, now: () => now };
    await Promise.all(Array.from({ length: 5 }, () => verifyAccessToken(token, opts)));
    assert.equal(fetches, 1);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(await verifyAccessToken(token, opts), null);
    }
    assert.equal(fetches, 1);
    now += 59_000;
    assert.equal(await verifyAccessToken(token, opts), null);
    assert.equal(fetches, 1);
    now += 1_000;
    assert.equal(await verifyAccessToken(token, opts), null);
    assert.equal(fetches, 2);
    clearMemberTierCache();
    now += 60_000;
  }

  await burst(async () => ({ ok: true, json: async () => ({ keys: [] }) }));
  await burst(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await burst(async () => {
    throw new Error('jwks down');
  });
});

test('a failed JWKS fetch keeps the once-a-minute window after cached keys go stale', async () => {
  clearMemberTierCache();
  const env = { VITE_SUPABASE_URL: 'https://project.supabase.co' };
  const claims = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: 'u-fan',
    email: 'fan@example.com',
    exp: 1_800_000_000,
    iss: 'https://project.supabase.co/auth/v1',
  };
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'forged-kid', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = `Bearer ${header}.${payload}.${Buffer.from('not-a-signature').toString('base64url')}`;
  let now = 1_700_000_000_000;
  let fail = false;
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    if (fail) throw new Error('jwks down');
    return { ok: true, json: async () => ({ keys: [{ kid: 'real-kid', kty: 'EC', crv: 'P-256' }] }) };
  };
  const opts = { env, fetchImpl, now: () => now };
  assert.equal(await verifyAccessToken(token, opts), null);
  assert.equal(fetches, 2);

  now += (10 * 60 * 1000) + 1;
  fail = true;
  assert.equal(await verifyAccessToken(token, opts), null);
  assert.equal(fetches, 3);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(await verifyAccessToken(token, opts), null);
  }
  assert.equal(fetches, 3);
  now += 59_000;
  assert.equal(await verifyAccessToken(token, opts), null);
  assert.equal(fetches, 3);
  now += 1_000;
  assert.equal(await verifyAccessToken(token, opts), null);
  assert.equal(fetches, 4);
  clearMemberTierCache();
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
