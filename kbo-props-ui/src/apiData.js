import { publishedAtFromPayload } from './boardFreshness';
import { filterStandardBoard } from './standardBoard';
import { boundedAccessToken } from './supabaseClient';

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

function accessToken({ fresh = false } = {}) {
  // fresh asks the Supabase client first, then falls back to the cached
  // bearer. The wait is capped so a stuck auth lock cannot hold the board.
  return boundedAccessToken({ fresh });
}

const inflight = new Map();

function inflightKey(ds, { player, fresh = false } = {}) {
  return `${ds}\0${player || ''}\0${fresh ? '1' : '0'}`;
}

function paidMemberCached() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    const parsed = JSON.parse(sessionStorage.getItem('cg_tier') || 'null');
    const tier = parsed?.tier;
    return typeof tier === 'string' && tier !== '' && tier !== 'free' && tier !== 'discord';
  } catch {
    return false;
  }
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

async function readErrorDetail(res) {
  try {
    const body = await res.json();
    return body?.message || body?.error || String(res.status);
  } catch {
    return String(res.status);
  }
}

function presentDataset(ds, body) {
  return {
    data: filterStandardBoard(ds, body.data),
    updatedAt: body.updatedAt || publishedAtFromPayload(body.data) || null,
    source: 'api',
    preview: !!body.preview,
    lockedCount: Number(body.lockedCount) || 0,
  };
}

function paidDowngrade(body) {
  return paidMemberCached() && body?.preview === true;
}

async function requestDataset(ds, { priority, player, fresh = false, timeoutMs } = {}) {
  const budget = Number.isFinite(timeoutMs)
    ? Math.min(FETCH_TIMEOUT_MS, Math.max(1, timeoutMs))
    : FETCH_TIMEOUT_MS;
  const token = await accessToken({ fresh });
  const params = new URLSearchParams({ ds });
  if (player) params.set('player', player);
  const res = await fetch(`/api/data?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(budget),
    // A retry must not reuse the browser's cached copy of the bad answer.
    ...(fresh ? { cache: 'no-store' } : {}),
    ...(priority ? { priority } : {}),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) {
    const detail = type.includes('application/json')
      ? await readErrorDetail(res)
      : String(res.status);
    throw new Error(`Failed to load ${ds} (${detail})`);
  }
  return res.json();
}

async function loadDataset(ds, opts, managed) {
  let spent = opts.retried === true;
  try {
    let body = await requestDataset(ds, opts);
    // The hub passes its own budget and retries. Sport boards do not: a paid
    // member who received the free preview, or a timed-out read, tries once
    // more and does not render the free rows.
    if (!managed && !spent && paidDowngrade(body)) {
      spent = true;
      body = await requestDataset(ds, { ...opts, fresh: true, retried: true });
    }
    if (!managed && paidDowngrade(body)) {
      throw new Error(`Paid board for ${ds} was returned as the free preview.`);
    }
    return presentDataset(ds, body);
  } catch (err) {
    if (!managed && !spent && isTimeoutError(err)) {
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

export function fetchApiDataset(ds, { devStaticPath, priority, player, fresh = false, timeoutMs, retried = false } = {}) {
  const opts = { devStaticPath, priority, player, fresh, timeoutMs, retried };
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

export const FREE_PREVIEW_LABEL = 'Free preview';
