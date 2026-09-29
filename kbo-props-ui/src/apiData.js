import { supabase } from './supabaseClient';

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
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function fetchDevStatic(staticPath) {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${staticPath}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${staticPath}`);
  return {
    data: await res.json(),
    updatedAt: res.headers.get('last-modified') || null,
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

export async function fetchApiDataset(ds, { devStaticPath } = {}) {
  try {
    const token = await accessToken();
    const res = await fetch(`/api/data?ds=${encodeURIComponent(ds)}`, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('application/json')) {
      const detail = type.includes('application/json')
        ? await readErrorDetail(res)
        : String(res.status);
      throw new Error(`Failed to load ${ds} (${detail})`);
    }
    const body = await res.json();
    return {
      data: body.data,
      updatedAt: body.updatedAt || null,
      source: 'api',
      preview: !!body.preview,
      lockedCount: Number(body.lockedCount) || 0,
    };
  } catch (err) {
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
