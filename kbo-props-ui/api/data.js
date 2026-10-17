import { createClient } from '@supabase/supabase-js';
import { filterNhlSharpOdds, filterStandardBoard, standardProjectionIdSet } from '../src/standardBoard.js';
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
  FILTER_STANDARD_BEFORE_FREE_PREVIEW,
  shapeForTier,
  sportAccess,
  _resetTierShapeFilters,
} from './_dataAccess.js';
import { landingFallbackBody } from './_landingFallback.js';
import { presentBoardPayload } from './_boardPayload.js';
import { assembleSnapshotRows, snapshotChunkManifest } from './_snapshotChunks.js';
import { clearMemberTierCache, lookupMemberTier } from './_memberTier.js';

export { assembleSnapshotRows, snapshotChunkManifest };

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

// Joined board passed to tier shaping and to ?view=hub trimming. A
// snapshotChunks manifest is not a board; trimming it would publish an empty
// hub (or the manifest object) instead of the player rows.
export function boardForPresentation(data) {
  if (snapshotChunkManifest(data)) {
    throw new Error('snapshot chunk manifest is not a board');
  }
  return data;
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

// Process-wide cache of each assembled board, keyed by table and version.
// A warm instance serves a copy younger than 60s. After that it serves the
// same copy immediately and refreshes it in the background (stale-while-
// revalidate) until the copy is 30 min old. Entitlement is still decided
// per request. One in-flight read per table, so a burst shares one fetch.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
const latestVersion = new Map();
export const STALE_MAX_MS = 30 * 60 * 1000;
export const cacheWindows = { freshMs: CACHE_TTL_MS, staleMs: STALE_MAX_MS };
const inflight = new Map();

let standardFilterRuns = 0;

export function _standardFilterRuns() {
  return standardFilterRuns;
}

// Paid callers, and free or logged-out callers while the preview flag is on,
// filter once per cache entry. The stored snapshot stays raw.
function payloadForTier(ds, table, row, raw, tier) {
  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  const paid = spec ? sportAccess(tier)[spec.sport] === true : false;
  const filter = paid || FILTER_STANDARD_BEFORE_FREE_PREVIEW;
  return {
    payload: filter ? cachedStandardBoard(ds, table, row, raw) : raw,
    alreadyStandard: filter,
  };
}

// Filter after the cached read, once per cache entry. The stored snapshot
// stays raw so a player page can still receive full logs. The cache key is
// unchanged: a standard-line pass must not look like a new publish.
function cachedStandardBoard(ds, table, row, raw) {
  const hit = currentBoard(table);
  if (hit?.row === row) {
    if (!hit.standard) hit.standard = new Map();
    if (hit.standard.has(ds)) return hit.standard.get(ds);
    standardFilterRuns += 1;
    const filtered = filterStandardBoard(ds, raw);
    hit.standard.set(ds, filtered);
    return filtered;
  }
  standardFilterRuns += 1;
  return filterStandardBoard(ds, raw);
}

// The snapshot read has to finish, and the last-good copy after it, inside
// the client's 12s fetch. A split board is a head read plus a chunk read, so
// those two steps and last-good share one budget. Auth runs beside the read
// and keeps its own 4s cap. Mutable so unit tests can shrink the window.
export const CLIENT_FETCH_MS = 12_000;
export const SNAPSHOT_READ_MS = 4_500;
export const timeouts = { snapshotReadMs: SNAPSHOT_READ_MS, tierLookupMs: 4_000, lastGoodReadMs: 6_000 };

// Head + chunks + last-good. Two full snapshot slices plus last-good is
// 15s, which is past the client. Cap the shared budget near 10.5s so a slow
// head and a chunk read still leave room for last-good inside the 12s fetch.
export const BOARD_READ_BUDGET_MS = 10_500;
export function boardReadBudgetMs(limits = timeouts) {
  const split = (Number(limits.snapshotReadMs) * 2) + Number(limits.lastGoodReadMs);
  return Math.min(split, BOARD_READ_BUDGET_MS);
}

export function stepBudgetMs(deadline, cap, now = Date.now()) {
  const limit = Number(cap);
  if (!Number.isFinite(deadline)) return limit;
  return Math.max(0, Math.min(limit, deadline - now));
}
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

function nbaManifestVersion(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data, 'version')) {
    return null;
  }
  const version = data.version;
  if (typeof version !== 'string' || !version) return false;
  if (data.generated_at != null && data.generated_at !== version) return false;
  return version;
}

// nba_players may be one id=1 array, or a manifest plus id=2..n slices.
// The prop board needs every game log, so publish splits the row instead of
// trimming it. Callers always receive the joined player list. A manifest
// version requires every chunk to carry that same version, so two publishes
// are never joined. Array slices with no version stay valid.
export function assembleNbaPlayerRows(head, extraRows) {
  if (!head) return null;
  const marker = head.data && typeof head.data === 'object' && !Array.isArray(head.data)
    ? head.data.nbaPlayerChunks
    : null;
  if (marker == null) return head;
  // When the publisher adds versions, the head and every chunk must get
  // version in the same change. A version on only one of them is a mixed set.
  const version = nbaManifestVersion(head.data);
  if (version === false) throw new Error('nba_players chunk set is mixed');
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
    const missing = `nba_players is missing chunk ${index + 1} of ${chunkIds.length}`;
    if (!row) throw new Error(missing);
    if (version) {
      const chunk = row.data;
      const chunkVersion = chunk && typeof chunk === 'object' && !Array.isArray(chunk) ? chunk.version : null;
      if (chunkVersion !== version || (chunk.generated_at != null && chunk.generated_at !== version)) {
        throw new Error('nba_players chunk set is mixed');
      }
      if (!Array.isArray(chunk.players)) throw new Error(missing);
      players.push(...chunk.players);
    } else if (Array.isArray(row.data)) {
      players.push(...row.data);
    } else if (row.data && typeof row.data === 'object' && row.data.version) {
      throw new Error('nba_players chunk set is mixed');
    } else {
      throw new Error(missing);
    }
    if (row.updated_at && (!updated || row.updated_at > updated)) updated = row.updated_at;
  }
  return { data: players, updated_at: updated };
}

async function readNbaPlayerChunks(client, deadline) {
  const ms = stepBudgetMs(deadline, timeouts.snapshotReadMs);
  if (ms <= 0) throw timeoutError('Dataset read timed out');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
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
      ms,
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
  // Chunks are joined inside readSnapshotResolved, and that joined list is
  // what the in-process cache stores. A background refresh therefore replaces
  // the manifest with the player rows instead of leaving the head uncached.
  return readSnapshot(client, 'nba_players');
}

export function boardCacheVersion(row) {
  if (!row || row.data == null) return String(row?.updated_at || '');
  const data = row.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item.generated_at === 'string' && item.generated_at) return item.generated_at;
    }
  } else if (typeof data === 'object') {
    if (typeof data.generated_at === 'string' && data.generated_at) return data.generated_at;
    const manifest = snapshotChunkManifest(data);
    if (typeof manifest?.version === 'string' && manifest.version) return manifest.version;
  }
  return String(row.updated_at || '');
}

function cacheKey(table, version) {
  return `${table}\0${version}`;
}

function rememberBoard(table, row, version = boardCacheVersion(row), at = Date.now()) {
  const prev = latestVersion.get(table);
  if (prev !== undefined && prev !== version) cache.delete(cacheKey(table, prev));
  latestVersion.set(table, version);
  cache.set(cacheKey(table, version), { at, version, row });
}

function currentBoard(table) {
  if (!latestVersion.has(table)) return null;
  return cache.get(cacheKey(table, latestVersion.get(table))) || null;
}

function isNbaPlayerManifest(table, row) {
  return table === 'nba_players'
    && row?.data
    && typeof row.data === 'object'
    && !Array.isArray(row.data)
    && row.data.nbaPlayerChunks != null;
}

// Cold instance: fall back to the private last-good copy the publish job
// writes to Storage. Read with the server key only; never a public URL.
async function boardAfterReadError(client, table, err, deadline, primed) {
  const hit = currentBoard(table);
  if (hit?.row && Date.now() - hit.at < cacheWindows.staleMs) return hit.row;
  const lastGood = primed ? await primed : await readLastGood(client, table, deadline);
  if (lastGood) {
    if (primed) {
      console.warn(`[api/data] ${table} served from last-good copy (${lastGood.updated_at || 'unknown time'})`);
    }
    rememberBoard(table, lastGood, boardCacheVersion(lastGood), lastGoodMemoryAt(table, lastGood));
    return lastGood;
  }
  throw err;
}

// Odds refresh uploads these three when it publishes. The API also writes the
// next good row, without waiting on Storage, whenever the board version or
// updated_at changes. An empty board is never stored.
const KBO_FALLBACK_TABLES = new Set([
  'prizepicks_props',
  'strikeout_projections',
  'batter_projections',
]);
const LAST_GOOD_WRITE_MS = 1000;
const LAST_GOOD_ROW_KEYS = ['cards', 'projections', 'players', 'rows', 'matchups', 'pairs', 'records', 'games'];
const lastGoodWrites = new Map();
const lastGoodSaved = new Map();
let lastGoodEpoch = 0;

function lastGoodSignature(row) {
  return `${boardCacheVersion(row)}\0${String(row?.updated_at || '')}`;
}

function lastGoodHasRows(row) {
  const data = row?.data;
  if (data == null || snapshotChunkManifest(data)) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data !== 'object') return false;
  const present = LAST_GOOD_ROW_KEYS.filter((key) => Array.isArray(data[key]));
  if (present.length) return present.some((key) => data[key].length > 0);
  return false;
}

function settleWithin(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: { message: 'last-good write exceeded 1s' } }), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        resolve({ error: err });
      },
    );
  });
}

async function writeLastGood(client, table, row) {
  try {
    const storage = client?.storage?.from?.(LAST_GOOD_BUCKET);
    if (!storage || typeof storage.upload !== 'function') return false;
    const body = Buffer.from(JSON.stringify({
      data: row.data,
      updated_at: row.updated_at || null,
    }));
    const { error } = await settleWithin(storage.upload(`${table}.json`, body, {
      contentType: 'application/json',
      upsert: true,
      cacheControl: '0',
    }), LAST_GOOD_WRITE_MS);
    if (error) {
      console.warn(`[api/data] ${table} last-good write failed:`, error.message || error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[api/data] ${table} last-good write failed:`, err.message);
    return false;
  }
}

function scheduleLastGoodWrite(client, table, row) {
  if (!KBO_FALLBACK_TABLES.has(table) || !lastGoodHasRows(row)) return Promise.resolve();
  const signature = lastGoodSignature(row);
  if (lastGoodSaved.get(table) === signature) return Promise.resolve();
  const existing = lastGoodWrites.get(table);
  if (existing?.signature === signature) return existing.promise;
  const epoch = lastGoodEpoch;
  const pending = writeLastGood(client, table, row).then((ok) => {
    if (!ok || epoch !== lastGoodEpoch) return;
    const inflightWrite = lastGoodWrites.get(table);
    if (inflightWrite && inflightWrite.promise !== pending) return;
    lastGoodSaved.set(table, signature);
  }).finally(() => {
    if (lastGoodWrites.get(table)?.promise === pending) lastGoodWrites.delete(table);
  });
  pending.catch(() => {});
  lastGoodWrites.set(table, { signature, promise: pending });
  return pending;
}

export function _lastGoodWrite(table) {
  return lastGoodWrites.get(table)?.promise || Promise.resolve();
}

function startBoardRead(client, table) {
  if (inflight.has(table)) return inflight.get(table);
  const deadline = Date.now() + boardReadBudgetMs();
  // Own deadline, not the shared 10.5s board budget. NHL stays sequential.
  const primed = KBO_FALLBACK_TABLES.has(table)
    ? readLastGood(client, table, Date.now() + timeouts.lastGoodReadMs, { announce: false })
    : null;
  const pending = readSnapshotResolved(client, table, deadline)
    .catch((err) => boardAfterReadError(client, table, err, deadline, primed));
  inflight.set(table, pending);
  // Both handlers are attached so a background refresh cannot reject later
  // as an unhandled rejection. Callers that await `pending` still see it.
  pending.then(() => {
    if (inflight.get(table) === pending) inflight.delete(table);
  }, () => {
    if (inflight.get(table) === pending) inflight.delete(table);
  });
  return pending;
}

async function readSnapshot(client, table) {
  const hit = currentBoard(table);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < cacheWindows.freshMs) return hit.row;
  if (hit && age < cacheWindows.staleMs) {
    startBoardRead(client, table);
    return hit.row;
  }
  return startBoardRead(client, table);
}

export const LAST_GOOD_BUCKET = 'board-last-good';
// Past this age the stored copy is not served (the caller gets the 503).
// Daily sports turn over every slate; NFL boards hold for the week.
export const LAST_GOOD_DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const NFL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LAST_GOOD_MAX_AGE_MS = Object.fromEntries(
  ['nfl_projections', 'nfl_lineups', 'correlations_nfl'].map((t) => [t, NFL_MAX_AGE_MS]),
);
// KBO and WNBA publishes often land many hours apart, and a timed-out read
// used to 503 because the 6h copy was already past the window. Serve the
// stored board for 12h instead of an empty hub.
export const LAST_GOOD_KBO_WNBA_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function datasetSport(table) {
  for (const spec of Object.values(DATASETS)) {
    if (spec.table === table) return spec.sport;
  }
  return null;
}

export function lastGoodMaxAgeMs(table) {
  if (Object.hasOwn(LAST_GOOD_MAX_AGE_MS, table)) return LAST_GOOD_MAX_AGE_MS[table];
  const sport = datasetSport(table);
  if (sport === 'kbo' || sport === 'wnba') return LAST_GOOD_KBO_WNBA_MAX_AGE_MS;
  return LAST_GOOD_DEFAULT_MAX_AGE_MS;
}

// Age comes from the board's own generated time first (data[0].generated_at or
// a top-level generated_at), then the stored updated_at, because
// nhl_projections.updated_at has historically not auto-updated.
export function lastGoodTimestamp(parsed) {
  const data = parsed?.data;
  const candidates = [
    Array.isArray(data) ? data[0]?.generated_at : null,
    data && typeof data === 'object' && !Array.isArray(data) ? data.generated_at : null,
    parsed?.updated_at,
  ];
  for (const value of candidates) {
    const ts = Date.parse(value || '');
    if (Number.isFinite(ts)) return ts;
  }
  return NaN;
}

export async function readLastGood(client, table, deadline, { announce = true } = {}) {
  try {
    const storage = client?.storage?.from?.(LAST_GOOD_BUCKET);
    if (!storage || typeof storage.download !== 'function') return null;
    const ms = stepBudgetMs(deadline, timeouts.lastGoodReadMs);
    if (ms <= 0) return null;
    const { data, error } = await withTimeout(
      storage.download(`${table}.json`),
      ms,
      'Last-good read timed out'
    );
    if (error || !data) return null;
    const parsed = JSON.parse(typeof data.text === 'function' ? await data.text() : String(data));
    if (!parsed || parsed.data == null) return null;
    // A chunk manifest is not the board. The bucket stores the full payload.
    if (snapshotChunkManifest(parsed.data)) return null;
    const maxAge = lastGoodMaxAgeMs(table);
    const ts = lastGoodTimestamp(parsed);
    if (!Number.isFinite(ts) || Date.now() - ts > maxAge) {
      console.warn(`[api/data] ${table} last-good copy too old (${parsed.updated_at || 'no time'}); not served`);
      return null;
    }
    if (announce) {
      console.warn(`[api/data] ${table} served from last-good copy (${parsed.updated_at || 'unknown time'})`);
    }
    return { data: parsed.data, updated_at: parsed.updated_at || null };
  } catch {
    return null;
  }
}

// Keep a Storage copy in memory only for the time still left under its age
// limit. The usual backdate makes a cold copy refresh immediately, and the
// 30 min stale window must not keep serving it after that limit.
export function lastGoodMemoryAt(table, row, now = Date.now()) {
  const ts = lastGoodTimestamp(row);
  const timeLeft = Number.isFinite(ts) ? ts + lastGoodMaxAgeMs(table) - now : 0;
  const withinStaleWindow = now - cacheWindows.freshMs + 15_000;
  const withinAgeLimit = now + timeLeft - cacheWindows.staleMs;
  return Math.min(withinStaleWindow, withinAgeLimit);
}

async function fetchSnapshotRow(client, table, id, deadline) {
  const ms = stepBudgetMs(deadline, timeouts.snapshotReadMs);
  if (ms <= 0) throw timeoutError('Dataset read timed out');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    let builder = client
      .from(table)
      .select('id, data, updated_at')
      .eq('id', id);
    // Real PostgREST clients cancel the HTTP request; unit mocks skip this.
    if (typeof builder.abortSignal === 'function') {
      builder = builder.abortSignal(controller.signal);
    }
    const { data, error } = await withTimeout(
      builder.maybeSingle(),
      ms,
      'Dataset read timed out'
    );
    if (error) throw new Error(error.message);
    return data || null;
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

async function fetchSnapshotRows(client, table, ids, deadline) {
  const ms = stepBudgetMs(deadline, timeouts.snapshotReadMs);
  if (ms <= 0) throw timeoutError('Dataset read timed out');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    let builder = client
      .from(table)
      .select('id, data, updated_at')
      .in('id', ids);
    if (typeof builder.abortSignal === 'function') {
      builder = builder.abortSignal(controller.signal);
    }
    const { data, error } = await withTimeout(
      builder,
      ms,
      'Dataset read timed out'
    );
    if (error) throw new Error(error.message);
    if (Array.isArray(data)) return data;
    return data ? [data] : [];
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

// id=1 is the board, or a manifest plus the chunk ids it names. Every chunk
// in that manifest is one .in('id', ids) read, then reassembled only when
// the set is complete and every row carries the manifest version. The cached
// row is that joined payload, identical to a single-row publish. Reassemble
// here, before the cache and before any ?view=hub trim, so a caller never
// shapes the manifest.
async function readSnapshotResolved(client, table, deadline) {
  const head = await fetchSnapshotRow(client, table, 1, deadline);
  if (head && snapshotChunkManifest(head.data)) {
    const ids = head.data.snapshotChunks.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
      throw new Error('snapshot chunk manifest is invalid');
    }
    const extra = await fetchSnapshotRows(client, table, ids, deadline);
    const assembled = assembleSnapshotRows(head, extra);
    rememberBoard(table, assembled, head.data.snapshotChunks.version);
    scheduleLastGoodWrite(client, table, assembled);
    return assembled;
  }
  if (isNbaPlayerManifest(table, head)) {
    // A failed join must not drop the previous good list. The fallback
    // below this read still checks that in-memory copy before Storage.
    const assembled = assembleNbaPlayerRows(head, await readNbaPlayerChunks(client, deadline));
    rememberBoard(table, assembled);
    return assembled;
  }
  rememberBoard(table, head);
  scheduleLastGoodWrite(client, table, head);
  return head;
}

// NBA caller identity. Unlike resolveTier, a bad token or a missing email is
// a hard failure (emailResolved false) so the NBA gate can fail closed.
// Identity comes from the signed access token. user_profiles is read inside
// lookupMemberTier, which owns the 4s budget and never calls auth.getUser.
export async function resolveNbaCaller(client, authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { emailResolved: true, email: null, tierResolved: true, tier: 'free' };
  }
  const result = await lookupMemberTier(client, authorization, { budgetMs: timeouts.tierLookupMs });
  if (!result.userId || !result.email) {
    return { emailResolved: false, email: null, tierResolved: false, tier: 'free', pending: false };
  }
  if (result.pending) {
    return {
      emailResolved: true,
      email: result.email,
      tierResolved: false,
      tier: 'free',
      pending: true,
    };
  }
  const tierResolved = result.source === 'profile' || result.source === 'cache';
  return {
    emailResolved: true,
    email: result.email,
    tierResolved,
    tier: tierResolved ? result.tier : 'free',
    pending: false,
  };
}

function sendTierPending(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.status(503).json({
    error: 'Member tier is still loading',
    code: 'tier_pending',
    message: "Couldn't confirm your membership. Please retry.",
  });
}

const NBA_FLAG_CACHE_KEY = `app_flags:${NBA_PUBLIC_FLAG}`;

// Missing row is not public. A query error throws so the caller can fail closed.
export async function readNbaPublicFlag(client) {
  const hit = cache.get(NBA_FLAG_CACHE_KEY);
  if (hit && Date.now() - hit.at < cacheWindows.freshMs) return hit.value;

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
  const caller = await resolveNbaCaller(client, req.headers?.authorization);
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
  // A valid token whose profile read did not finish is retryable. The owner
  // email is already on the token, so that short-circuit still opens the board.
  if (caller.pending && decision !== 'full') return sendTierPending(res);
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
  let board;
  try {
    board = boardForPresentation(row.data);
  } catch (err) {
    console.error(`[api/data] ${ds} manifest was not reassembled:`, err.message);
    return res.status(502).json({ error: 'Dataset unavailable' });
  }
  const shaped = withPresentedData(
    req,
    decision === 'full'
      ? { data: cachedStandardBoard(ds, spec.table, row, board), preview: false, lockedCount: 0 }
      : shapeForTier(
        ds,
        FILTER_STANDARD_BEFORE_FREE_PREVIEW ? cachedStandardBoard(ds, spec.table, row, board) : board,
        'free',
        { alreadyStandard: FILTER_STANDARD_BEFORE_FREE_PREVIEW },
      ),
    board,
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
  const caller = await resolveNbaCaller(client, req.headers?.authorization);
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

// Ids on the board a member receives for nhl_projections. Sharp-odds rows
// whose id is not in this set are unknown and are not returned.
async function standardNhlProjectionIds(projectionsPromise) {
  const projRow = await projectionsPromise;
  if (!projRow || projRow.data == null) return new Set();
  let projBoard;
  try {
    projBoard = boardForPresentation(projRow.data);
  } catch (err) {
    console.error(`[api/data] nhl_projections for sharp odds was not reassembled: ${err.message}`);
    return new Set();
  }
  const tierPayload = payloadForTier('nhl_projections', 'nhl_projections', projRow, projBoard, 'owner');
  const shaped = shapeForTier('nhl_projections', tierPayload.payload, 'owner', {
    alreadyStandard: tierPayload.alreadyStandard,
  });
  return standardProjectionIdSet(shaped.data);
}

async function handleNhlRequest(req, res, client, ds) {
  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec || spec.sport !== 'nhl') {
    return res.status(400).json({ error: 'Unknown dataset' });
  }

  // Auth and the snapshot start together. lookupMemberTier owns the 4s cap,
  // including a paid-tier cache used only on timeout. A lookup blip must not
  // hold the read: the free preview is the fallback.
  const callerPromise = resolveNbaCaller(client, req.headers?.authorization);
  const rowPromise = readSnapshot(client, spec.table);
  // Standard ids come from the member NHL board. The read starts with the
  // sharp-odds snapshot so a paid caller is not waiting on a second serial fetch.
  const projectionsPromise = ds === 'nhl_sharp_odds'
    ? readSnapshot(client, 'nhl_projections').then(
      (projRow) => projRow,
      (err) => {
        console.error(`[api/data] nhl_projections read for sharp odds failed: ${err?.message || err}`);
        return null;
      },
    )
    : null;

  let caller = { emailResolved: false, email: null, tierResolved: false, tier: 'free' };
  let row;
  try {
    [caller, row] = await Promise.all([callerPromise, rowPromise]);
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

  // Same entitlement as KBO/WNBA/NFL, plus the admin email. A valid token
  // whose profile read timed out is retryable, not the free preview. The
  // admin email is on the token and still opens the board.
  const decision = nhlAccessDecision({
    emailResolved: caller.emailResolved,
    email: caller.email,
    tierResolved: caller.tierResolved,
    tier: caller.tier,
  });
  if (caller.pending && decision !== 'full') return sendTierPending(res);

  let board;
  try {
    board = boardForPresentation(row.data);
  } catch (err) {
    console.error(`[api/data] ${ds} manifest was not reassembled:`, err.message);
    return res.status(502).json({ error: 'Dataset unavailable' });
  }
  // Full access still goes through shapeForTier so demon, goblin, and
  // unlabeled lines are dropped. An admin whose stored tier does not unlock
  // NHL still gets the full filtered board.
  const tier = caller.tierResolved === true ? caller.tier : 'free';
  const fullTier = sportAccess(tier).nhl ? tier : 'owner';
  const shapingTier = decision === 'full' ? fullTier : 'free';
  const tierPayload = payloadForTier(ds, spec.table, row, board, shapingTier);
  let payload = tierPayload.payload;
  let presented = board;
  if (ds === 'nhl_sharp_odds') {
    const standardIds = await standardNhlProjectionIds(projectionsPromise);
    payload = filterNhlSharpOdds(payload, standardIds);
    presented = payload;
  }
  const shaped = withPresentedData(
    req,
    shapeForTier(ds, payload, shapingTier, { alreadyStandard: tierPayload.alreadyStandard }),
    presented,
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
  const caller = await resolveNbaCaller(client, req.headers?.authorization);
  return nhlAccessDecision({
    emailResolved: caller.emailResolved,
    email: caller.email,
    tierResolved: caller.tierResolved,
    tier: caller.tier,
  }) === 'full';
}

// Resolve the caller's tier from a Supabase access token. Anonymous or invalid
// tokens are treated as 'free' (they still receive the public preview).
// The lookup itself lives in _memberTier.js so a later tier-cache change can
// rebase onto this helper instead of a second in-handler cache.
export async function resolveTier(client, authorization) {
  const result = await lookupMemberTier(client, authorization, { budgetMs: timeouts.tierLookupMs });
  return {
    tier: result.pending ? null : (result.tier || 'free'),
    userId: result.userId,
    pending: result.pending === true,
    source: result.source,
  };
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
  // Live publish asks this before it splits a board. The marker is only
  // present once this reader is deployed, so an older site keeps id=1 as the
  // board. No dataset read, and not cacheable.
  if (String(req.query?.capability || '') === 'snapshot-chunks') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return res.status(200).json({ snapshotChunks: 1, capability: 'snapshot-chunks' });
  }

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

  // The profile read starts with the snapshot. lookupMemberTier owns the 4s
  // cap, including one retry and a paid-tier cache used only on timeout.
  // A valid token with no resolved tier is not the free preview.
  // This reader does not keep its own tier cache.
  const tierPromise = resolveTier(client, req.headers?.authorization);
  const rowPromise = readSnapshot(client, spec.table);

  let tierResult = { tier: 'free', pending: false };
  let row;
  try {
    [tierResult, row] = await Promise.all([tierPromise, rowPromise]);
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
  if (tierResult?.pending) return sendTierPending(res);
  const tier = tierResult?.tier || 'free';

  let board;
  try {
    board = boardForPresentation(row.data);
  } catch (err) {
    console.error(`[api/data] ${ds} manifest was not reassembled:`, err.message);
    return res.status(502).json({ error: 'Dataset unavailable' });
  }
  const tierPayload = payloadForTier(ds, spec.table, row, board, tier);
  const shaped = withPresentedData(
    req,
    shapeForTier(ds, tierPayload.payload, tier, { alreadyStandard: tierPayload.alreadyStandard }),
    board,
  );
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
  latestVersion.clear();
  inflight.clear();
  lastGoodEpoch += 1;
  lastGoodWrites.clear();
  lastGoodSaved.clear();
  clearMemberTierCache();
  standardFilterRuns = 0;
  _resetTierShapeFilters();
}

export default function handler(req, res) {
  return handleDataRequest(req, res);
}
