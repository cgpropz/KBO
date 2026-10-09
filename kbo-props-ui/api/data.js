import { createClient } from '@supabase/supabase-js';
import {
  DATASETS,
  NBA_PUBLIC_FLAG,
  isNbaDataset,
  isNhlDataset,
  nbaAccessDecision,
  nhlAccessDecision,
  shapeForTier,
  sportAccess,
} from './_dataAccess.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

// Same server-side env vars as the other api/ functions. Created lazily so the
// module can be imported (and unit-tested) without credentials.
let supabase = null;
export function getDataClient() {
  return getClient();
}

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

// nba_players may be one id=1 array, or a manifest plus id=2..n slices.
// The prop board needs every game log, so publish splits the row instead of
// trimming it. Callers always receive the joined player list.
export function assembleNbaPlayerRows(head, extraRows) {
  if (!head) return null;
  const marker = head.data && typeof head.data === 'object' && !Array.isArray(head.data)
    ? head.data.nbaPlayerChunks
    : null;
  if (marker == null) return head;
  const chunkIds = Array.isArray(marker)
    ? marker
    : (Number.isInteger(marker) && marker >= 1
      ? Array.from({ length: marker }, (_, index) => index + 2)
      : null);
  if (!chunkIds || chunkIds.length === 0 || chunkIds.some((id) => !Number.isInteger(id))) {
    throw new Error('nba_players chunk manifest is invalid');
  }
  const byId = new Map((extraRows || []).map((row) => [Number(row.id), row]));
  const players = [];
  let updated = head.updated_at || null;
  for (let index = 0; index < chunkIds.length; index += 1) {
    const id = chunkIds[index];
    const row = byId.get(id);
    if (!row || !Array.isArray(row.data)) {
      throw new Error(`nba_players is missing chunk ${index + 1} of ${chunkIds.length}`);
    }
    players.push(...row.data);
    if (row.updated_at && (!updated || row.updated_at > updated)) updated = row.updated_at;
  }
  return { data: players, updated_at: updated };
}

async function readNbaPlayerChunks(client) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeouts.snapshotReadMs);
  try {
    let builder = client
      .from('nba_players')
      .select('id, data, updated_at')
      .gt('id', 1)
      .order('id');
    if (typeof builder.abortSignal === 'function') {
      builder = builder.abortSignal(controller.signal);
    }
    const { data, error } = await withTimeout(
      builder,
      timeouts.snapshotReadMs,
      'Dataset read timed out'
    );
    if (error) throw new Error(error.message);
    return data || [];
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

async function readNbaPlayers(client) {
  const head = await readSnapshot(client, 'nba_players');
  if (!head) return null;
  const marker = head.data && typeof head.data === 'object' && !Array.isArray(head.data)
    ? head.data.nbaPlayerChunks
    : null;
  if (marker == null) return head;
  try {
    const assembled = assembleNbaPlayerRows(head, await readNbaPlayerChunks(client));
    cache.set('nba_players', { at: Date.now(), row: assembled });
    return assembled;
  } catch (err) {
    cache.delete('nba_players');
    throw err;
  }
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

// NBA caller identity. Unlike resolveTier, a bad token or a missing email is
// a hard failure (emailResolved false) so the NBA gate can fail closed.
export async function resolveNbaCaller(client, authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { emailResolved: true, email: null, tierResolved: true, tier: 'free' };
  }
  const { data, error } = await client.auth.getUser(token);
  const user = data?.user;
  if (error || !user || typeof user.email !== 'string' || !user.email.trim()) {
    return { emailResolved: false, email: null, tierResolved: false, tier: 'free' };
  }
  const { data: profile, error: profileError } = await client
    .from('user_profiles')
    .select('tier')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) {
    return { emailResolved: true, email: user.email, tierResolved: false, tier: 'free' };
  }
  return {
    emailResolved: true,
    email: user.email,
    tierResolved: true,
    tier: profile?.tier || 'free',
  };
}

const NBA_FLAG_CACHE_KEY = `app_flags:${NBA_PUBLIC_FLAG}`;

// Missing row is not public. A query error throws so the caller can fail closed.
export async function readNbaPublicFlag(client) {
  const hit = cache.get(NBA_FLAG_CACHE_KEY);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const { data, error } = await client
    .from('app_flags')
    .select('value')
    .eq('key', NBA_PUBLIC_FLAG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value === true;
  cache.set(NBA_FLAG_CACHE_KEY, { at: Date.now(), value });
  return value;
}

function forbid(res) {
  return res.status(403).json({ error: 'Forbidden' });
}

async function handleNbaRequest(req, res, client, ds) {
  let caller;
  try {
    caller = await withTimeout(
      resolveNbaCaller(client, req.headers?.authorization),
      timeouts.tierLookupMs,
      'NBA access lookup timed out'
    );
  } catch {
    return forbid(res);
  }
  // Auth/email failures deny before the flag read, so a hanging flag cannot
  // turn a bad token into a long request or an open gate.
  if (caller.emailResolved !== true) return forbid(res);

  let nbaPublic = false;
  let flagResolved = false;
  try {
    nbaPublic = await withTimeout(
      readNbaPublicFlag(client),
      timeouts.tierLookupMs,
      'NBA flag lookup timed out'
    );
    flagResolved = true;
  } catch {
    flagResolved = false;
  }

  const decision = nbaAccessDecision({
    emailResolved: caller.emailResolved,
    email: caller.email,
    tierResolved: caller.tierResolved,
    tier: caller.tier,
    flagResolved,
    nbaPublic,
  });
  if (decision === 'deny') return forbid(res);

  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec || spec.sport !== 'nba') {
    return res.status(400).json({ error: 'Unknown dataset' });
  }

  let row;
  try {
    row = ds === 'nba_players'
      ? await readNbaPlayers(client)
      : await readSnapshot(client, spec.table);
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

  // sportAccess() has no nba key and must stay that way. Full access returns
  // the snapshot directly. Preview (flag on, non-all-access tier) uses the
  // free trimmer. Unregistered nba_* names stay 400.
  const shaped = decision === 'full'
    ? { data: row.data, preview: false, lockedCount: 0 }
    : shapeForTier(ds, row.data, 'free');
  return res.status(200).json({
    data: shaped.data,
    updatedAt: row.updated_at || null,
    preview: shaped.preview,
    lockedCount: shaped.lockedCount,
    tier: caller.tier,
    access: sportAccess(caller.tier),
  });
}

// Landing-card bit only. Same decision as handleNbaRequest, and never a snapshot.
// True solely when nbaAccessDecision is 'full'. Errors and preview are false.
export async function nbaSectionOpen(req, client) {
  let caller;
  try {
    caller = await withTimeout(
      resolveNbaCaller(client, req.headers?.authorization),
      timeouts.tierLookupMs,
      'NBA access lookup timed out'
    );
  } catch {
    return false;
  }
  if (caller.emailResolved !== true) return false;

  let nbaPublic = false;
  let flagResolved = false;
  try {
    nbaPublic = await withTimeout(
      readNbaPublicFlag(client),
      timeouts.tierLookupMs,
      'NBA flag lookup timed out'
    );
    flagResolved = true;
  } catch {
    flagResolved = false;
  }

  return nbaAccessDecision({
    emailResolved: caller.emailResolved,
    email: caller.email,
    tierResolved: caller.tierResolved,
    tier: caller.tier,
    flagResolved,
    nbaPublic,
  }) === 'full';
}

async function handleNhlRequest(req, res, client, ds) {
  let caller;
  try {
    caller = await withTimeout(
      resolveNbaCaller(client, req.headers?.authorization),
      timeouts.tierLookupMs,
      'NHL access lookup timed out'
    );
  } catch {
    return forbid(res);
  }
  // The email on this object came from Supabase auth.getUser. A paid tier
  // and the nhl_public flag are not consulted.
  const decision = nhlAccessDecision({
    emailResolved: caller.emailResolved,
    email: caller.email,
  });
  if (decision !== 'full') return forbid(res);

  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec || spec.sport !== 'nhl') {
    return res.status(400).json({ error: 'Unknown dataset' });
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

  return res.status(200).json({
    data: row.data,
    updatedAt: row.updated_at || null,
    preview: false,
    lockedCount: 0,
    tier: caller.tier,
    access: sportAccess(caller.tier),
  });
}

export async function nhlSectionOpen(req, client) {
  let caller;
  try {
    caller = await withTimeout(
      resolveNbaCaller(client, req.headers?.authorization),
      timeouts.tierLookupMs,
      'NHL access lookup timed out'
    );
  } catch {
    return false;
  }
  return nhlAccessDecision({
    emailResolved: caller.emailResolved,
    email: caller.email,
  }) === 'full';
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
  if (isNbaDataset(ds)) {
    return handleNbaRequest(req, res, client || getClient(), ds);
  }
  if (isNhlDataset(ds)) {
    return handleNhlRequest(req, res, client || getClient(), ds);
  }
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
