import { createClient } from '@supabase/supabase-js';
import bundledStatus from '../public/status.json' with { type: 'json' };
import { publicBoardStatus } from './_boardStatus.js';
import {
  DATASETS,
  NBA_PUBLIC_FLAG,
  isNbaDataset,
  isNhlDataset,
  nbaAccessDecision,
  nhlAccessDecision,
  datasetIsFullyPublic,
  shapeForTier,
  sportAccess,
} from './_dataAccess.js';
import { landingFallbackBody } from './_landingFallback.js';
import { presentBoardPayload } from './_boardPayload.js';

// Members may reuse a response for half a minute. It stays private, so the
// edge never stores a paid board. Anonymous previews keep the public cache.
export const PRIVATE_DATA_CACHE = 'private, max-age=30, stale-while-revalidate=60, stale-if-error=600';
export const PUBLIC_DATA_CACHE = 's-maxage=60, stale-while-revalidate=300, stale-if-error=1800';

// Anonymous public previews (and fully public datasets) can sit on the edge.
// A request with Authorization, or a full member snapshot, must not.
export function dataCacheControl(req, { memberGated = false } = {}) {
  const authorization = String(req?.headers?.authorization || '').trim();
  if (authorization || memberGated) return PRIVATE_DATA_CACHE;
  return PUBLIC_DATA_CACHE;
}

// A signed-in caller who gets the free preview is usually a lookup blip
// (auth or tier timeout, stale token). Never let the browser keep that copy,
// or a paying member sees an empty hub until the private cache runs out.
export function previewForSignedIn(req, body) {
  return !!String(req?.headers?.authorization || '').trim() && body?.preview === true;
}

function sendData(req, res, body, memberGated) {
  res.setHeader('Cache-Control', previewForSignedIn(req, body) ? 'private, no-store, max-age=0' : dataCacheControl(req, { memberGated }));
  return res.status(200).json(body);
}

function withPresentedData(req, shaped, fullData) {
  return {
    ...shaped,
    data: presentBoardPayload(req.query?.player, shaped, fullData),
  };
}

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
// When Supabase is slow, serve the last good row this instance read (up to
// 30 min old) instead of a 503. Identical reads share one in-flight request so
// a burst does not pile multi-MB reads onto the PostgREST pool.
export const STALE_MAX_MS = 30 * 60 * 1000;
const inflight = new Map();

// Hard ceiling on Supabase snapshot reads. Without this, an eastern-US latency
// incident leaves Vercel functions hung and the UI stuck on "Loading…".
// Mutable so unit tests can shrink the window without waiting a real 8s.
export const timeouts = { snapshotReadMs: 8_000, tierLookupMs: 4_000, lastGoodReadMs: 6_000 };
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
  if (inflight.has(table)) return inflight.get(table);
  const pending = readSnapshotFresh(client, table).catch(async (err) => {
    if (hit && hit.row && Date.now() - hit.at < STALE_MAX_MS) return hit.row;
    // Cold instance: fall back to the private last-good copy the publish job
    // writes to Storage. Read with the server key only; never a public URL.
    const lastGood = await readLastGood(client, table);
    if (lastGood) {
      cache.set(table, { at: Date.now() - CACHE_TTL_MS + 15_000, row: lastGood });
      return lastGood;
    }
    throw err;
  }).finally(() => inflight.delete(table));
  inflight.set(table, pending);
  return pending;
}

export const LAST_GOOD_BUCKET = 'board-last-good';
// Past this age the stored copy is not served (the caller gets the 503).
// Daily sports turn over every slate; NFL boards hold for the week.
export const LAST_GOOD_DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const NFL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LAST_GOOD_MAX_AGE_MS = Object.fromEntries(
  ['nfl_projections', 'nfl_lineups', 'nfl_sharp_odds', 'nfl_game_markets', 'correlations_nfl'].map((t) => [t, NFL_MAX_AGE_MS]),
);

export async function readLastGood(client, table) {
  try {
    const storage = client?.storage?.from?.(LAST_GOOD_BUCKET);
    if (!storage || typeof storage.download !== 'function') return null;
    const { data, error } = await withTimeout(
      storage.download(`${table}.json`),
      timeouts.lastGoodReadMs,
      'Last-good read timed out'
    );
    if (error || !data) return null;
    const parsed = JSON.parse(typeof data.text === 'function' ? await data.text() : String(data));
    if (!parsed || parsed.data == null) return null;
    const maxAge = Object.hasOwn(LAST_GOOD_MAX_AGE_MS, table) ? LAST_GOOD_MAX_AGE_MS[table] : LAST_GOOD_DEFAULT_MAX_AGE_MS;
    const ts = Date.parse(parsed.updated_at || '');
    if (!Number.isFinite(ts) || Date.now() - ts > maxAge) {
      console.warn(`[api/data] ${table} last-good copy too old (${parsed.updated_at || 'no time'}); not served`);
      return null;
    }
    console.warn(`[api/data] ${table} served from last-good copy (${parsed.updated_at || 'unknown time'})`);
    return { data: parsed.data, updated_at: parsed.updated_at || null };
  } catch {
    return null;
  }
}

async function readSnapshotFresh(client, table) {

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
  const shaped = withPresentedData(
    req,
    decision === 'full'
      ? { data: row.data, preview: false, lockedCount: 0 }
      : shapeForTier(ds, row.data, 'free'),
    row.data,
  );
  return sendData(req, res, {
    data: shaped.data,
    updatedAt: row.updated_at || null,
    preview: shaped.preview,
    lockedCount: shaped.lockedCount,
    tier: caller.tier,
    access: sportAccess(caller.tier),
  }, decision === 'full');
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
  let caller = { emailResolved: false, email: null, tierResolved: false, tier: 'free' };
  try {
    caller = await withTimeout(
      resolveNbaCaller(client, req.headers?.authorization),
      timeouts.tierLookupMs,
      'NHL access lookup timed out'
    );
  } catch {
    // A lookup blip must not open the board. Fall through to the free preview.
    caller = { emailResolved: false, email: null, tierResolved: false, tier: 'free' };
  }
  // Same entitlement as KBO/WNBA/NFL, plus the admin email. Anything short of
  // 'full' is the public preview, not a 403.
  const decision = nhlAccessDecision({
    emailResolved: caller.emailResolved,
    email: caller.email,
    tierResolved: caller.tierResolved,
    tier: caller.tier,
  });

  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec || spec.sport !== 'nhl') {
    return res.status(400).json({ error: 'Unknown dataset' });
  }

  let row;
  try {
    row = await readSnapshot(client, spec.table);
  } catch (err) {
    console.error(`[api/data] ${ds} read failed:`, err.message);
    const fallback = landingFallbackBody(ds, req.headers?.authorization);
    if (fallback) return sendData(req, res, fallback, false);
    if (err?.code === 'UPSTREAM_TIMEOUT') {
      return res.status(503).json({
        error: 'Dataset temporarily unavailable',
        code: 'upstream_timeout',
        message: 'Upstream data store timed out. Please refresh in a moment.',
      });
    }
    return res.status(502).json({ error: 'Dataset unavailable' });
  }
  if (!row) {
    const fallback = landingFallbackBody(ds, req.headers?.authorization);
    if (fallback) return sendData(req, res, fallback, false);
    return res.status(404).json({ error: 'Dataset not published yet' });
  }

  const shaped = withPresentedData(
    req,
    decision === 'full'
      ? { data: row.data, preview: false, lockedCount: 0 }
      : shapeForTier(ds, row.data, 'free'),
    row.data,
  );
  return sendData(req, res, {
    data: shaped.data,
    updatedAt: row.updated_at || null,
    preview: shaped.preview,
    lockedCount: shaped.lockedCount,
    tier: caller.tierResolved === true ? caller.tier : 'free',
    access: sportAccess(caller.tierResolved === true ? caller.tier : 'free'),
  }, decision === 'full');
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
    tierResolved: caller.tierResolved,
    tier: caller.tier,
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

// Clocks and prop counts only. Paid rows never ride along. A failed read
// returns the clocks shipped with the last site deploy, so a data blip
// cannot blank the public status file.
export async function handleBoardStatus(req, res, client) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const row = await readSnapshot(client || getClient(), 'board_status');
    if (row && row.data) return res.status(200).json(publicBoardStatus(row.data));
  } catch (err) {
    console.error('[api/data] board status read failed:', err.message);
  }
  return res.status(200).json(publicBoardStatus(bundledStatus));
}

export async function handleDataRequest(req, res, client) {
  const dsEarly = String(req.query?.ds || '');
  if (dsEarly === 'board_status') return handleBoardStatus(req, res, client);

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
    if (!client) {
      try {
        client = getClient();
      } catch (err) {
        console.error('[api/data] client unavailable:', err.message);
        const fallback = landingFallbackBody(ds, req.headers?.authorization);
        if (fallback) return sendData(req, res, fallback, false);
        return res.status(503).json({ error: 'Dataset unavailable' });
      }
    }
    return handleNhlRequest(req, res, client, ds);
  }
  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec) return res.status(400).json({ error: 'Unknown dataset' });

  if (!client) {
    try {
      client = getClient();
    } catch (err) {
      console.error('[api/data] client unavailable:', err.message);
      const fallback = landingFallbackBody(ds, req.headers?.authorization);
      if (fallback) return sendData(req, res, fallback, false);
      return res.status(503).json({ error: 'Dataset unavailable' });
    }
  }

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
    const fallback = landingFallbackBody(ds, req.headers?.authorization);
    if (fallback) return sendData(req, res, fallback, false);
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

  const shaped = withPresentedData(req, shapeForTier(ds, row.data, tier), row.data);
  const memberGated = shaped.preview === false && !datasetIsFullyPublic(ds);
  return sendData(req, res, {
    data: shaped.data,
    updatedAt: row.updated_at || null,
    preview: shaped.preview,
    lockedCount: shaped.lockedCount,
    tier,
    access: sportAccess(tier),
  }, memberGated);
}

export function _clearCache() {
  cache.clear();
}

export default function handler(req, res) {
  return handleDataRequest(req, res);
}
