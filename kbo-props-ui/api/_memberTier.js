import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

// Member tier lookup that does not call auth.getUser.
// A valid signed access token yields the user id locally (HS256 secret when
// one is configured, otherwise the project's JWKS). The profile row is read
// beside the board. A paid tier is remembered for five minutes and used only
// when that read times out. A resolved non-paid tier drops the cache.
// #203's handler-level recentTiers should call this helper instead of adding
// a second cache.

export const PAID_TIER_TTL_MS = 5 * 60 * 1000;
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_FORCE_REFRESH_MS = 60 * 1000;
const SECRET_ENV_KEYS = ['SUPABASE_JWT_SECRET', 'JWT_SECRET'];

const paidTiers = new Map();
const inflightLookups = new Map();
let jwksCache = { url: '', at: 0, keys: [], forcedAt: 0 };

function envOf(options) {
  return options.env || process.env;
}

function nowMs(options) {
  return typeof options.now === 'function' ? options.now() : Date.now();
}

function stripBearer(authorization) {
  return String(authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function jwtSecret(env) {
  for (const key of SECRET_ENV_KEYS) {
    const value = String(env?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function projectBase(env) {
  return String(env?.VITE_SUPABASE_URL || env?.SUPABASE_URL || '').replace(/\/$/, '');
}

function expectedIssuer(env) {
  const base = projectBase(env);
  return base ? `${base}/auth/v1` : '';
}

function audienceOk(aud) {
  if (aud === 'authenticated') return true;
  return Array.isArray(aud) && aud.includes('authenticated');
}

function claimsOk(payload, options) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) return false;
  if (payload.role !== 'authenticated') return false;
  if (!audienceOk(payload.aud)) return false;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs(options)) return false;
  const nbf = Number(payload.nbf);
  if (payload.nbf != null && Number.isFinite(nbf) && nbf * 1000 > nowMs(options)) return false;
  const issuer = expectedIssuer(envOf(options));
  if (issuer && payload.iss !== issuer) return false;
  return true;
}

function verifyHs256(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let actual;
  try {
    actual = Buffer.from(parts[2], 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function verifyWithJwk(signingInput, signaturePart, jwk) {
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const signature = Buffer.from(signaturePart, 'base64url');
    if (jwk.kty === 'EC') {
      return cryptoVerify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }, signature);
    }
    return cryptoVerify('RSA-SHA256', Buffer.from(signingInput), key, signature);
  } catch {
    return false;
  }
}

async function loadJwks(env, fetchImpl, { force = false, now = Date.now } = {}) {
  const issuer = expectedIssuer(env);
  if (!issuer) return [];
  const clock = typeof now === 'function' ? now() : Date.now();
  const sameUrl = jwksCache.url === issuer;
  const fresh = sameUrl && jwksCache.keys.length && clock - jwksCache.at < JWKS_TTL_MS;
  if (fresh && !force) return jwksCache.keys;
  if (force && sameUrl && clock - jwksCache.forcedAt < JWKS_FORCE_REFRESH_MS) {
    return jwksCache.keys;
  }
  if (force) jwksCache = { ...jwksCache, forcedAt: clock };
  const anon = String(env?.VITE_SUPABASE_ANON_KEY || env?.SUPABASE_ANON_KEY || '').trim();
  const response = await fetchImpl(`${issuer}/.well-known/jwks.json`, {
    headers: anon ? { apikey: anon } : {},
    signal: AbortSignal.timeout(2000),
  });
  if (!response?.ok) return jwksCache.keys;
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (keys.length) {
    jwksCache = { url: issuer, at: clock, keys, forcedAt: force ? clock : jwksCache.forcedAt };
  }
  return keys.length ? keys : jwksCache.keys;
}

export function clearMemberTierCache() {
  paidTiers.clear();
  inflightLookups.clear();
  jwksCache = { url: '', at: 0, keys: [], forcedAt: 0 };
}

function prunePaidTiers(now) {
  for (const [userId, entry] of paidTiers) {
    if (!entry || now - entry.at > PAID_TIER_TTL_MS) paidTiers.delete(userId);
  }
}

function isPaidTier(tier) {
  return typeof tier === 'string' && tier !== '' && tier !== 'free';
}

function rememberPaidTier(userId, tier, now) {
  if (!isPaidTier(tier)) {
    paidTiers.delete(userId);
    return;
  }
  paidTiers.set(userId, { tier, at: now });
}

function cachedPaidTier(userId, now) {
  prunePaidTiers(now);
  const entry = paidTiers.get(userId);
  if (!entry || now - entry.at > PAID_TIER_TTL_MS) {
    paidTiers.delete(userId);
    return '';
  }
  return entry.tier;
}

function isTimeout(err) {
  return err?.code === 'UPSTREAM_TIMEOUT' || err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

function timeoutError(message) {
  const err = new Error(message);
  err.code = 'UPSTREAM_TIMEOUT';
  err.name = 'TimeoutError';
  return err;
}

function withBudget(promise, ms, message) {
  let timer;
  return new Promise((resolve, reject) => {
    const limit = Number(ms);
    if (!Number.isFinite(limit) || limit <= 0) {
      reject(timeoutError(message));
      return;
    }
    timer = setTimeout(() => reject(timeoutError(message)), limit);
    Promise.resolve(promise).then(resolve, reject);
  }).finally(() => clearTimeout(timer));
}

async function readProfileTier(client, userId, ms) {
  const run = async () => {
    let query = client.from('user_profiles').select('tier').eq('id', userId);
    let killer;
    if (typeof query.abortSignal === 'function') {
      const controller = new AbortController();
      killer = setTimeout(() => controller.abort(), Math.max(1, ms));
      query = query.abortSignal(controller.signal);
    }
    try {
      const result = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query;
      if (result?.error) throw new Error(result.error.message || 'profile read failed');
      const tier = result?.data?.tier;
      return typeof tier === 'string' && tier ? tier : 'free';
    } finally {
      clearTimeout(killer);
    }
  };
  return withBudget(run(), ms, 'Tier lookup timed out');
}

// Local verification only. Returns null unless the signature, expiry,
// audience, role, and (when the project URL is set) issuer all check out.
export async function verifyAccessToken(authorization, options = {}) {
  const token = stripBearer(authorization);
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || !payload) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  let signed = false;
  if (header.alg === 'none' || header.alg == null) return null;
  if (header.alg === 'HS256') {
    const secret = options.secret ?? jwtSecret(envOf(options));
    if (!secret) return null;
    signed = verifyHs256(token, secret);
  } else if (header.alg === 'ES256' || header.alg === 'RS256') {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    let keys = Array.isArray(options.jwks)
      ? options.jwks
      : await loadJwks(envOf(options), fetchImpl, { now: options.now }).catch(() => []);
    let jwk = keys.find((key) => key && key.kid === header.kid);
    if (!jwk && !Array.isArray(options.jwks)) {
      keys = await loadJwks(envOf(options), fetchImpl, { force: true, now: options.now }).catch(() => keys);
      jwk = keys.find((key) => key && key.kid === header.kid);
    }
    if (!jwk) return null;
    signed = verifyWithJwk(signingInput, parts[2], jwk);
  }
  if (!signed || !claimsOk(payload, options)) return null;
  return {
    userId: payload.sub.trim(),
    email: typeof payload.email === 'string' ? payload.email : '',
  };
}

function pendingTier(verified, source, timedOut) {
  return {
    tier: null,
    userId: verified.userId,
    email: verified.email,
    source,
    timedOut,
    pending: true,
  };
}

// One profile read for this user. A resolved row is the only free-preview
// path. A timeout with no paid cache stays pending so the handler can ask
// the client to retry instead of serving the free board.
async function lookupMemberTierOnce(client, verified, options, started) {
  const budgetMs = Number.isFinite(options.budgetMs) ? options.budgetMs : 4000;
  const clock = () => (typeof options.now === 'function' ? options.now() : Date.now());
  let sawTimeout = false;
  // Leave time for one retry. A single hung read must not spend the whole cap.
  const reserve = Math.min(1_200, Math.max(1, Math.floor(budgetMs / 2)));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = budgetMs - (clock() - started);
    const slice = attempt === 0 ? Math.min(remaining, Math.max(remaining - reserve, 1)) : remaining;
    try {
      const tier = await readProfileTier(client, verified.userId, slice);
      rememberPaidTier(verified.userId, tier, clock());
      return {
        tier,
        userId: verified.userId,
        email: verified.email,
        source: 'profile',
        timedOut: false,
        pending: false,
      };
    } catch (err) {
      if (isTimeout(err)) sawTimeout = true;
    }
  }
  if (sawTimeout) {
    const cached = cachedPaidTier(verified.userId, clock());
    if (cached) {
      return {
        tier: cached,
        userId: verified.userId,
        email: verified.email,
        source: 'cache',
        timedOut: true,
        pending: false,
      };
    }
    return pendingTier(verified, 'timeout', true);
  }
  return pendingTier(verified, 'fallback', false);
}

// Always settles. Concurrent callers for one verified user share the lookup
// that is already in flight. A cached paid tier is returned only after a
// timeout, and only for this verified user id.
export async function lookupMemberTier(client, authorization, options = {}) {
  const now = nowMs(options);
  prunePaidTiers(now);
  const verified = options.verified || await verifyAccessToken(authorization, options);
  if (!verified?.userId) {
    return { tier: 'free', userId: null, email: '', source: 'invalid', timedOut: false, pending: false };
  }
  const existing = inflightLookups.get(verified.userId);
  if (existing) return existing;
  const pending = lookupMemberTierOnce(client, verified, options, now).finally(() => {
    if (inflightLookups.get(verified.userId) === pending) inflightLookups.delete(verified.userId);
  });
  inflightLookups.set(verified.userId, pending);
  return pending;
}
