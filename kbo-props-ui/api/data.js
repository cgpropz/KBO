import { createClient } from '@supabase/supabase-js';
import { DATASETS, shapeForTier, sportAccess } from './_dataAccess.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

// Same server-side env vars as the other api/ functions. Created lazily so the
// module can be imported (and unit-tested) without credentials.
let supabase = null;
function getClient() {
  if (!supabase) {
    supabase = createClient(
      cleanEnv(process.env.VITE_SUPABASE_URL),
      cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
    );
  }
  return supabase;
}

// Short in-memory cache of snapshot rows per warm function instance, so a page
// that loads several datasets does not hammer Supabase. Entitlement is still
// decided per request.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

// Hard ceiling on Supabase snapshot reads. Without this, an eastern-US latency
// incident leaves Vercel functions hung and the UI stuck on "Loading…".
// Mutable so unit tests can shrink the window without waiting a real 8s.
export const timeouts = { snapshotReadMs: 8_000, tierLookupMs: 4_000 };
export function _setTimeouts(partial) {
  Object.assign(timeouts, partial);
}

function timeoutError(message) {
  const err = new Error(message);
  err.code = 'UPSTREAM_TIMEOUT';
  err.name = 'TimeoutError';
  return err;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function readSnapshot(client, table) {
  const hit = cache.get(table);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeouts.snapshotReadMs);
  try {
    let builder = client
      .from(table)
      .select('data, updated_at')
      .eq('id', 1);
    // Real PostgREST clients cancel the HTTP request; unit mocks skip this.
    if (typeof builder.abortSignal === 'function') {
      builder = builder.abortSignal(controller.signal);
    }
    const { data, error } = await withTimeout(
      builder.maybeSingle(),
      timeouts.snapshotReadMs,
      'Dataset read timed out'
    );
    if (error) throw new Error(error.message);
    const row = data || null;
    cache.set(table, { at: Date.now(), row });
    return row;
  } catch (err) {
    if (err?.code === 'UPSTREAM_TIMEOUT') throw err;
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw timeoutError('Dataset read timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Resolve the caller's tier from a Supabase access token. Anonymous or invalid
// tokens are treated as 'free' (they still receive the public preview).
export async function resolveTier(client, authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { tier: 'free', userId: null };
  const { data, error } = await client.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return { tier: 'free', userId: null };
  const { data: profile } = await client
    .from('user_profiles')
    .select('tier')
    .eq('id', user.id)
    .maybeSingle();
  return { tier: profile?.tier || 'free', userId: user.id };
}

/**
 * GET /api/data?ds=<dataset>
 *
 * Returns { data, updatedAt, preview, lockedCount, tier, access }.
 * Paid tiers get the full snapshot; free/anonymous callers get a preview
 * (top rows only) plus the number of locked rows. The tier is read from
 * user_profiles server-side with the service-role key — never trusted from
 * the client.
 */
export async function handleDataRequest(req, res, client) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ds = String(req.query?.ds || '');
  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec) return res.status(400).json({ error: 'Unknown dataset' });

  client = client || getClient();

  let tier = 'free';
  try {
    ({ tier } = await withTimeout(
      resolveTier(client, req.headers?.authorization),
      timeouts.tierLookupMs,
      'Tier lookup timed out'
    ));
  } catch {
    // Auth/profile blips (or timeouts) must not block the public preview.
    tier = 'free';
  }

  let row;
  try {
    row = await readSnapshot(client, spec.table);
  } catch (err) {
    console.error(`[api/data] ${ds} read failed:`, err.message);
    if (err?.code === 'UPSTREAM_TIMEOUT') {
      return res.status(503).json({
        error: 'Dataset temporarily unavailable',
        code: 'upstream_timeout',
        message: 'Upstream data store timed out. Please refresh in a moment.',
      });
    }
    return res.status(502).json({ error: 'Dataset unavailable' });
  }
  if (!row) return res.status(404).json({ error: 'Dataset not published yet' });

  const shaped = shapeForTier(ds, row.data, tier);
  return res.status(200).json({
    data: shaped.data,
    updatedAt: row.updated_at || null,
    preview: shaped.preview,
    lockedCount: shaped.lockedCount,
    tier,
    access: sportAccess(tier),
  });
}

export function _clearCache() {
  cache.clear();
}

export default function handler(req, res) {
  return handleDataRequest(req, res);
}
