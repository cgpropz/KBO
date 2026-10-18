// SEV-1 Oct 18: forced refreshSession() calls on every board load hit the
// Supabase 429 rate limit; the library then dropped the session (SIGNED_OUT)
// and members fell to free. "Fresh" tokens now come from getSession().
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _setSupabaseClientFactory, boundedAccessToken, refreshedAccessToken, loadSupabase, onSupabaseLoaded } from '../src/supabaseClient.js';
import { runRefreshAttempts } from '../src/refreshAttempts.mjs';

function storageWith(token) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    'sb-project-auth-token': JSON.stringify({ access_token: token, expires_at: expiresAt, user: { id: 'u1' } }),
    getItem(key) { return this[key] ?? null; },
  };
}

function rateLimitedClient(counter) {
  return {
    auth: {
      refreshSession: async () => {
        counter.refresh += 1;
        return { data: { session: null }, error: { status: 429, code: 'over_request_rate_limit' } };
      },
      getSession: async () => {
        counter.get += 1;
        return { data: { session: { access_token: 'stored-tok', user: { id: 'u1' } } } };
      },
    },
  };
}

async function withClient(counter, fn) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storageWith('cached-tok');
  _setSupabaseClientFactory(() => rateLimitedClient(counter));
  try { return await fn(); } finally {
    _setSupabaseClientFactory(null);
    globalThis.localStorage = previous;
  }
}

test('10 concurrent fresh-token requests make no refreshSession call', async () => {
  const counter = { refresh: 0, get: 0 };
  await withClient(counter, async () => {
    const tokens = await Promise.all(Array.from({ length: 10 }, () => boundedAccessToken({ fresh: true, waitMs: 500 })));
    assert.equal(counter.refresh, 0);
    assert.ok(tokens.every((t) => t === 'stored-tok'));
  });
});

test('a 429 from the auth server cannot drop the session: refreshSession is never called', async () => {
  const counter = { refresh: 0, get: 0 };
  await withClient(counter, async () => {
    const token = await refreshedAccessToken();
    assert.equal(token, 'stored-tok');
    assert.equal(counter.refresh, 0);
  });
  const src = readFileSync(new URL('../src/supabaseClient.js', import.meta.url), 'utf8');
  assert.equal(src.includes('auth.refreshSession('), false);
});

test('refreshFullBoard retries make no extra refreshSession calls', async () => {
  // refreshFullBoard asks requestDataset for fresh:true on every attempt;
  // requestDataset gets that token from boundedAccessToken({ fresh }).
  const api = readFileSync(new URL('../src/apiData.js', import.meta.url), 'utf8');
  assert.ok(api.includes('return boundedAccessToken({ fresh });'));
  assert.match(api, /request\(ds, \{ \.\.\.opts, fresh: true, retried: true/);
  const counter = { refresh: 0, get: 0 };
  let attempts = 0;
  await withClient(counter, async () => {
    await runRefreshAttempts({
      delays: [0, 0, 0],
      sleepFn: async () => {},
      attempt: async () => {
        attempts += 1;
        await boundedAccessToken({ fresh: true, waitMs: 500 });
        return 'again';
      },
    });
  });
  assert.ok(attempts >= 3);
  assert.equal(counter.refresh, 0);
});

test('a client loaded by the sign-in form reaches AuthContext listeners', async () => {
  const seen = [];
  const client = { auth: {} };
  _setSupabaseClientFactory(() => client);
  try {
    const stop = onSupabaseLoaded((c) => seen.push(c));
    await loadSupabase();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(seen, [client]);
    onSupabaseLoaded((c) => seen.push(c));
    assert.equal(seen.length, 2);
    stop();
  } finally {
    _setSupabaseClientFactory(null);
  }
  const ctx = readFileSync(new URL('../src/AuthContext.jsx', import.meta.url), 'utf8');
  assert.match(ctx, /onSupabaseLoaded\(\(client\) => subscribe\(client\)\)/);
});
