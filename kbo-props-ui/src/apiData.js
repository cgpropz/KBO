import { publishedAtFromPayload } from './boardFreshness';
import { cachedAccessToken, readCachedSession, sessionAccessToken } from './supabaseClient';

/*
 * Client for the server-gated data endpoint (api/data.js).
 *
 * Paid datasets are no longer shipped as static files or readable straight
 * from Supabase. The server verifies the caller's access token, looks up their
 * tier, and returns either the full snapshot or a free preview:
 *   { data, updatedAt, preview, lockedCount, tier, access }
 *
 * In local `vite dev` there are no serverless functions, so when the API is
 * unreachable we fall back to the developer's local, git-ignored
 * public/data/*.json files. That fallback is compiled out of production builds.
 */

// Client-side ceiling so boards surface the #32 load-error UI instead of
// hanging forever when /api/data (or upstream Supabase) stalls.
export const FETCH_TIMEOUT_MS = 12_000;

async function accessToken() {
  const cached = cachedAccessToken();
  if (cached) return cached;
  // Logged-out visitors have no session. Skip the client download entirely.
  if (!readCachedSession()) return null;
  try {
    return await sessionAccessToken();
  } catch {
    return null;
  }
}

async function fetchDevStatic(staticPath) {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${staticPath}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${staticPath}`);
  const data = await res.json();
  return {
    data,
    updatedAt: publishedAtFromPayload(data) || res.headers.get('last-modified') || null,
    source: 'dev_static',
    preview: false,
    lockedCount: 0,
  };
}

function isTimeoutError(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

async function readErrorDetail(res) {
  try {
    const body = await res.json();
    return body?.message || body?.error || String(res.status);
  } catch {
    return String(res.status);
  }
}

// Deploy bakes these from the free preview. They are the fallback when the
// live endpoint is down, not a second copy of the paid board.
const BAKED_LANDING = {
  nfl_projections: 'landing/nfl-projections.json',
  nfl_game_markets: 'landing/nfl-game-markets.json',
};

function snapshotFromBody(body, source) {
  return {
    data: body.data,
    updatedAt: body.updatedAt || publishedAtFromPayload(body.data) || null,
    source,
    preview: !!body.preview,
    lockedCount: Number(body.lockedCount) || 0,
  };
}

function takePrefetch(ds) {
  const bag = globalThis.window?.__cgPrefetch;
  const pending = bag?.[ds];
  if (!pending) return null;
  delete bag[ds];
  return pending;
}

async function fetchBakedLanding(ds) {
  const file = BAKED_LANDING[ds];
  if (!file) return null;
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`, {
    cache: 'default',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) return null;
  const body = await res.json();
  if (!body || body.preview !== true) return null;
  return snapshotFromBody(body, 'landing');
}

async function fetchLiveDataset(ds, token, priority) {
  const res = await fetch(`/api/data?ds=${encodeURIComponent(ds)}`, {
    cache: token ? 'no-store' : 'default',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ...(priority ? { priority } : {}),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) {
    const detail = type.includes('application/json')
      ? await readErrorDetail(res)
      : String(res.status);
    throw new Error(`Failed to load ${ds} (${detail})`);
  }
  return snapshotFromBody(await res.json(), 'api');
}

export async function fetchApiDataset(ds, { devStaticPath, priority } = {}) {
  const token = await accessToken();
  try {
    if (!token) {
      const prefetched = takePrefetch(ds);
      if (prefetched) {
        try {
          return snapshotFromBody(await prefetched, 'api');
        } catch (err) {
          const baked = await fetchBakedLanding(ds).catch(() => null);
          if (baked) return baked;
          throw err;
        }
      }
    }
    return await fetchLiveDataset(ds, token, priority);
  } catch (err) {
    if (!token) {
      try {
        const baked = await fetchBakedLanding(ds);
        if (baked) return baked;
      } catch { /* the dev static file is the last local fallback */ }
    }
    if (import.meta.env.DEV && devStaticPath) {
      console.warn(`[data] ${ds} API unavailable in dev, using local static file`, err.message);
      return fetchDevStatic(devStaticPath);
    }
    if (isTimeoutError(err)) {
      throw new Error(`Timed out loading ${ds}. The data service may be slow — please refresh.`);
    }
    throw err;
  }
}
