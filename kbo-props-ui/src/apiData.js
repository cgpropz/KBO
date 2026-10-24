import { publishedAtFromPayload } from './boardFreshness';
import { runRefreshAttempts } from './refreshAttempts.mjs';
import { memberPreviewIsDowngrade } from './memberPreview';
import { filterStandardBoard } from './standardBoard';
import { boundedAccessToken, readCachedSession } from './supabaseClient';

/*
 * Client for the server-gated data endpoint (api/data.js).
 *
 * Paid datasets are no longer shipped as static files or readable straight
 * from Supabase. The server verifies the caller's access token, looks up their
 * tier, and returns either the full snapshot or a free preview:
 *   { data, updatedAt, preview, lockedCount, tier, access, lineEdges? }
 *
 * In local `vite dev` there are no serverless functions, so when the API is
 * unreachable we fall back to the developer's local, git-ignored
 * public/data/*.json files. That fallback is compiled out of production builds.
 */

// Client-side ceiling so boards surface the #32 load-error UI instead of
// hanging forever when /api/data (or upstream Supabase) stalls.
export const FETCH_TIMEOUT_MS = 12_000;

export const FREE_PREVIEW_LABEL = 'Free preview';

function accessToken({ fresh = false } = {}) {
  // fresh asks the Supabase client first, then falls back to the cached
  // bearer. The wait is capped so a stuck auth lock cannot hold the board.
  return boundedAccessToken({ fresh });
}

const inflight = new Map();

function inflightKey(ds, { player, fresh = false } = {}) {
  return `${ds}\0${player || ''}\0${fresh ? '1' : '0'}`;
}

function cachedMemberPreviewIsDowngrade(ds, body) {
  return memberPreviewIsDowngrade(ds, body, {
    session: readCachedSession(),
    tierCache: typeof sessionStorage === 'undefined' ? null : sessionStorage,
  });
}

async function fetchDevStatic(ds, staticPath) {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${staticPath}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${staticPath}`);
  const data = await res.json();
  return {
    data: filterStandardBoard(ds, data),
    updatedAt: publishedAtFromPayload(data) || res.headers.get('last-modified') || null,
    source: 'dev_static',
    preview: false,
    lockedCount: 0,
  };
}

function isTimeoutError(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

async function readErrorBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function presentDataset(ds, body) {
  const preview = !!body.preview;
  return {
    // A free preview is the production payload. Filtering it here would drop
    // the same rows the server left in the top 3. Full responses are filtered.
    data: preview ? body.data : filterStandardBoard(ds, body.data),
    updatedAt: body.updatedAt || publishedAtFromPayload(body.data) || null,
    source: 'api',
    preview,
    previewLabel: preview ? FREE_PREVIEW_LABEL : '',
    lockedCount: Number(body.lockedCount) || 0,
    ...(Array.isArray(body.lineEdges) ? { lineEdges: body.lineEdges } : {}),
    refreshing: false,
  };
}

const REFRESH_DELAYS_MS = [1500, 4000, 8000];
const datasetWatchers = new Map();
const refreshListeners = new Set();
const refreshingDatasets = new Set();

export function watchDataset(ds, listener) {
  let set = datasetWatchers.get(ds);
  if (!set) {
    set = new Set();
    datasetWatchers.set(ds, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

export function subscribeBoardRefreshing(listener) {
  refreshListeners.add(listener);
  listener(refreshingDatasets.size > 0);
  return () => refreshListeners.delete(listener);
}

function notifyRefreshing() {
  const active = refreshingDatasets.size > 0;
  for (const listener of refreshListeners) listener(active);
}

function publishDataset(ds, presented) {
  const set = datasetWatchers.get(ds);
  if (!set) return;
  for (const listener of set) listener(presented);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The foreground retry already happened. Keep asking in the background and
// publish the first full board. A later preview stays on screen. When every
// retry is still a preview, tell the board so it can label that preview and
// offer Retry.
export async function refreshFullBoard(ds, opts, {
  sleepFn = sleep,
  delays = REFRESH_DELAYS_MS,
  request = requestDataset,
  isDowngrade = cachedMemberPreviewIsDowngrade,
} = {}) {
  if (refreshingDatasets.has(ds)) return;
  refreshingDatasets.add(ds);
  notifyRefreshing();
  let outcome = { replaced: false, gaveUp: false };
  try {
    outcome = await runRefreshAttempts({
      delays,
      sleepFn,
      attempt: async () => {
        const body = await request(ds, { ...opts, fresh: true, retried: true, player: undefined });
        const presented = presentDataset(ds, body);
        if (!presented.preview) {
          publishDataset(ds, presented);
          return 'full';
        }
        if (!isDowngrade(ds, body)) return 'stop';
        return 'again';
      },
    });
  } finally {
    refreshingDatasets.delete(ds);
    notifyRefreshing();
    if (outcome.gaveUp && !outcome.replaced) {
      publishDataset(ds, { refreshExhausted: true, preview: true, refreshing: false });
    }
  }
}

async function requestDataset(ds, { priority, player, fresh = false, timeoutMs, retried = false, suppliedToken } = {}) {
  const budget = Number.isFinite(timeoutMs)
    ? Math.min(FETCH_TIMEOUT_MS, Math.max(1, timeoutMs))
    : FETCH_TIMEOUT_MS;
  // A token from the hub load is reused. fresh still refreshes when the
  // caller did not already supply one.
  const token = suppliedToken !== undefined ? suppliedToken : await accessToken({ fresh });
  const params = new URLSearchParams({ ds });
  if (player) params.set('player', player);
  const res = await fetch(`/api/data?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(budget),
    // A retry must not reuse the browser's cached copy of the bad answer.
    ...(fresh || retried ? { cache: 'no-store' } : {}),
    ...(priority ? { priority } : {}),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) {
    const body = type.includes('application/json') ? await readErrorBody(res) : null;
    const detail = body?.message || body?.error || String(res.status);
    const err = new Error(`Failed to load ${ds} (${detail})`);
    err.status = res.status;
    err.code = body?.code || '';
    throw err;
  }
  return res.json();
}

async function loadDataset(ds, opts, managed) {
  let spent = opts.retried === true;
  try {
    let body = await requestDataset(ds, opts);
    // The hub passes its own budget and retries. Sport boards retry once when
    // this session's tier should have unlocked the dataset.
    // The second answer is what we render, including a preview.
    if (!managed && !spent && cachedMemberPreviewIsDowngrade(ds, body)) {
      spent = true;
      try {
        body = await requestDataset(ds, { ...opts, fresh: true, retried: true });
      } catch (retryErr) {
        if (!isTimeoutError(retryErr)) throw retryErr;
      }
    }
    const presented = presentDataset(ds, body);
    if (!managed && !opts.player && presented.preview && cachedMemberPreviewIsDowngrade(ds, body)) {
      presented.refreshing = true;
      refreshFullBoard(ds, opts);
    }
    return presented;
  } catch (err) {
    if (!managed && !spent && (isTimeoutError(err) || err?.code === 'tier_pending')) {
      return loadDataset(ds, { ...opts, fresh: true, retried: true }, managed);
    }
    if (import.meta.env.DEV && opts.devStaticPath) {
      console.warn(`[data] ${ds} API unavailable in dev, using local static file`, err.message);
      return fetchDevStatic(ds, opts.devStaticPath);
    }
    if (isTimeoutError(err)) {
      throw new Error(`Timed out loading ${ds}. The data service may be slow — please refresh.`);
    }
    throw err;
  }
}

export function fetchApiDataset(ds, { devStaticPath, priority, player, fresh = false, timeoutMs, retried = false, accessToken: suppliedToken } = {}) {
  const opts = { devStaticPath, priority, player, fresh, timeoutMs, retried, suppliedToken };
  const key = inflightKey(ds, opts);
  const existing = inflight.get(key);
  if (existing) return existing;
  // Set the map before any await so the board and the nav search share one
  // request. A player page and a fresh retry stay on their own keys.
  const pending = loadDataset(ds, opts, Number.isFinite(timeoutMs));
  inflight.set(key, pending);
  pending.finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  return pending;
}
