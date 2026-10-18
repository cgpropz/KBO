// SEV-1 Oct 18: forced refreshSession() calls on every board load hit the
// Supabase 429 rate limit; auth-js then dropped the session (SIGNED_OUT) and
// members fell to free. A real refresh now runs only when an unexpired stored
// token was rejected, at most once per page per 60s, shared by concurrent
// callers, and a 429 keeps the session and the tier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REFRESH_COOLDOWN_MS,
  _resetRefreshState,
  _setSupabaseClientFactory,
  boundedAccessToken,
  deferSignOutDuringRefresh,
  isTransientAuthError,
  loadSupabase,
  onSupabaseLoaded,
  refreshedAccessToken,
} from '../src/supabaseClient.js';
import { runRefreshAttempts } from '../src/refreshAttempts.mjs';

const KEY = 'sb-project-auth-token';

function memoryStorage(token, expiresInSec = 3600) {
  const data = new Map();
  data.set(KEY, JSON.stringify({
    access_token: token,
    refresh_token: 'r1',
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    user: { id: 'u1' },
  }));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    keys: () => data.keys(),
  };
}

// Mimics auth-js 2.x: a non-retryable refresh error (429 included) removes the
// stored session and emits SIGNED_OUT before refreshSession() resolves.
function fakeClient({ storage, counter, outcome = 'ok', delayMs = 5, listener = null }) {
  return {
    auth: {
      refreshSession: async () => {
        counter.refresh += 1;
        await new Promise((r) => setTimeout(r, delayMs));
        if (outcome === 'ok') {
          return { data: { session: { access_token: `new-tok-${counter.refresh}`, user: { id: 'u1' } } }, error: null };
        }
        const error = outcome === '429'
          ? { status: 429, code: 'over_request_rate_limit', name: 'AuthApiError' }
          : { status: 400, code: 'refresh_token_not_found', name: 'AuthApiError' };
        storage.removeItem(KEY);
        listener?.('SIGNED_OUT', null);
        return { data: { session: null, user: null }, error };
      },
      getSession: async () => {
        counter.get += 1;
        const raw = storage.getItem(KEY);
        return { data: { session: raw ? JSON.parse(raw) : null } };
      },
    },
  };
}

async function withSetup({ token = 'cached-tok', expiresInSec = 3600, outcome = 'ok', listener, now } = {}, fn) {
  const previous = globalThis.localStorage;
  const storage = memoryStorage(token, expiresInSec);
  const counter = { refresh: 0, get: 0 };
  globalThis.localStorage = storage;
  _resetRefreshState({ now });
  _setSupabaseClientFactory(() => fakeClient({ storage, counter, outcome, listener }));
  try {
    return await fn({ storage, counter });
  } finally {
    _setSupabaseClientFactory(null);
    _resetRefreshState();
    globalThis.localStorage = previous;
  }
}

test('concurrent callers share one refresh', async () => {
  await withSetup({}, async ({ counter }) => {
    const tokens = await Promise.all(Array.from({ length: 10 }, () => refreshedAccessToken()));
    assert.equal(counter.refresh, 1);
    assert.ok(tokens.every((t) => t === 'new-tok-1'));
  });
});

test('10 concurrent bounded fresh previews make at most one refresh', async () => {
  await withSetup({}, async ({ counter }) => {
    await Promise.all(Array.from({ length: 10 }, () => boundedAccessToken({ fresh: true, waitMs: 500 })));
    assert.ok(counter.refresh <= 1);
  });
});

test('a second refresh within 60s is skipped and reuses the stored session', async () => {
  let clock = 1_000_000;
  await withSetup({ now: () => clock }, async ({ counter }) => {
    await refreshedAccessToken();
    assert.equal(counter.refresh, 1);
    clock += REFRESH_COOLDOWN_MS - 1;
    await refreshedAccessToken();
    assert.equal(counter.refresh, 1);
    assert.ok(counter.get >= 1);
    clock += 2;
    await refreshedAccessToken();
    assert.equal(counter.refresh, 2);
  });
});

test('refreshFullBoard-style retries make at most one refresh', async () => {
  const api = readFileSync(new URL('../src/apiData.js', import.meta.url), 'utf8');
  assert.ok(api.includes('return boundedAccessToken({ fresh });'));
  await withSetup({}, async ({ counter }) => {
    let attempts = 0;
    await runRefreshAttempts({
      delays: [0, 0, 0],
      sleepFn: async () => {},
      attempt: async () => {
        attempts += 1;
        await boundedAccessToken({ fresh: true, waitMs: 500 });
        return 'again';
      },
    });
    assert.ok(attempts >= 3);
    assert.equal(counter.refresh, 1);
  });
});

test('a 429 keeps the session and the tier', async () => {
  const events = [];
  let tier = 'monthly';
  const apply = (event) => { events.push(event); if (event === 'SIGNED_OUT') tier = 'free'; };
  // Same shape as AuthContext: a SIGNED_OUT during our refresh is deferred.
  const listener = (event) => {
    if (event === 'SIGNED_OUT' && deferSignOutDuringRefresh(() => apply(event))) return;
    apply(event);
  };
  await withSetup({ outcome: '429', listener }, async ({ storage, counter }) => {
    const token = await refreshedAccessToken();
    assert.equal(counter.refresh, 1);
    assert.equal(token, 'cached-tok');
    assert.ok(storage.getItem(KEY), 'stored session restored');
    assert.deepEqual(events, []);
    assert.equal(tier, 'monthly');
    // The bounded path still hands the board a bearer.
    assert.equal(await boundedAccessToken({ fresh: true, waitMs: 500 }), 'cached-tok');
  });
});

test('a revoked refresh token still signs out', async () => {
  const events = [];
  const listener = (event) => {
    if (event === 'SIGNED_OUT' && deferSignOutDuringRefresh(() => events.push(event))) return;
    events.push(event);
  };
  await withSetup({ outcome: 'revoked', listener }, async ({ storage }) => {
    const token = await refreshedAccessToken();
    assert.equal(token, null);
    assert.equal(storage.getItem(KEY), null);
    assert.deepEqual(events, ['SIGNED_OUT']);
  });
});

test('no refresh when the token is valid and not rejected', async () => {
  await withSetup({}, async ({ counter }) => {
    const tokens = await Promise.all(Array.from({ length: 5 }, () => boundedAccessToken({ fresh: false })));
    assert.ok(tokens.every((t) => t === 'cached-tok'));
    assert.equal(counter.refresh, 0);
  });
});

test('an expired token is left to the library (getSession), no forced refresh', async () => {
  await withSetup({ expiresInSec: -60 }, async ({ counter }) => {
    await refreshedAccessToken();
    assert.equal(counter.refresh, 0);
    assert.equal(counter.get, 1);
  });
});

test('logged-out visitors never refresh', async () => {
  const previous = globalThis.localStorage;
  const counter = { refresh: 0, get: 0 };
  const storage = memoryStorage('x');
  storage.removeItem(KEY);
  globalThis.localStorage = storage;
  _resetRefreshState();
  _setSupabaseClientFactory(() => fakeClient({ storage, counter }));
  try {
    assert.equal(await refreshedAccessToken(), null);
    assert.equal(counter.refresh, 0);
  } finally {
    _setSupabaseClientFactory(null);
    globalThis.localStorage = previous;
  }
});

test('transient auth errors are recognised', () => {
  assert.equal(isTransientAuthError({ status: 429 }), true);
  assert.equal(isTransientAuthError({ status: 503 }), true);
  assert.equal(isTransientAuthError({ name: 'AuthRetryableFetchError', status: 0 }), true);
  assert.equal(isTransientAuthError({ status: 400, code: 'refresh_token_not_found' }), false);
  const src = readFileSync(new URL('../src/supabaseClient.js', import.meta.url), 'utf8');
  assert.equal(src.split('auth.refreshSession(').length - 1, 1);
  const ctx = readFileSync(new URL('../src/AuthContext.jsx', import.meta.url), 'utf8');
  assert.match(ctx, /deferSignOutDuringRefresh\(\(\) => onAuthEvent\(event, session\)\)/);
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
