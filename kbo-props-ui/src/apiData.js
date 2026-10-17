import { publishedAtFromPayload } from './boardFreshness';
import { filterStandardBoard } from './standardBoard';
import { cachedAccessToken, readCachedSession, refreshedAccessToken, sessionAccessToken } from './supabaseClient';

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

async function accessToken({ fresh = false } = {}) {
  // fresh skips the localStorage copy and asks the Supabase client, which
  // refreshes an expired or rejected session before handing back a token.
  const cached = fresh ? null : cachedAccessToken();
  if (cached) return cached;
  // Logged-out visitors have no session. Skip the client download entirely.
  if (!readCachedSession()) return null;
  try {
    return await (fresh ? refreshedAccessToken() : sessionAccessToken());
  } catch {
    return null;
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

export const FREE_PREVIEW_LABEL = 'Free preview';

async function readErrorBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchApiDataset(ds, { devStaticPath, priority, player, fresh = false, timeoutMs } = {}) {
  const budget = Number.isFinite(timeoutMs)
    ? Math.min(FETCH_TIMEOUT_MS, Math.max(1, timeoutMs))
    : FETCH_TIMEOUT_MS;
  try {
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
      const body = type.includes('application/json') ? await readErrorBody(res) : null;
      const detail = body?.message || body?.error || String(res.status);
      const err = new Error(`Failed to load ${ds} (${detail})`);
      err.status = res.status;
      err.code = body?.code || '';
      throw err;
    }
    const body = await res.json();
    const preview = !!body.preview;
    return {
      data: filterStandardBoard(ds, body.data),
      updatedAt: body.updatedAt || publishedAtFromPayload(body.data) || null,
      source: 'api',
      preview,
      previewLabel: preview ? FREE_PREVIEW_LABEL : '',
      lockedCount: Number(body.lockedCount) || 0,
    };
  } catch (err) {
    if (import.meta.env.DEV && devStaticPath) {
      console.warn(`[data] ${ds} API unavailable in dev, using local static file`, err.message);
      return fetchDevStatic(ds, devStaticPath);
    }
    if (isTimeoutError(err)) {
      throw new Error(`Timed out loading ${ds}. The data service may be slow — please refresh.`);
    }
    throw err;
  }
}
