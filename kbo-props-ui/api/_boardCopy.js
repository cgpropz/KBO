// Private Vercel Blob copy of a published board.
//
// Global Config (formerly Edge Config) is a small read-optimized config store,
// and these boards are multi-megabyte files rewritten on every publish. Blob
// is the file store, and a private store does not require a new paid plan.
// Nothing in the repo is connected to either store yet, so this stays idle
// until BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID plus VERCEL_OIDC_TOKEN is set.
//
// The HTTP contract matches @vercel/blob 2.8.2: PUT https://vercel.com/api/blob
// with x-api-version 13, and GET https://<storeId>.private.blob.vercel-storage.com/<pathname>.
// Paid rows are not a public URL. /api/data still gates them after the read.

const BLOB_API = 'https://vercel.com/api/blob';
const BLOB_API_VERSION = '13';
const TABLE_NAME = /^[a-z0-9_]+$/;

let fetchImpl = globalThis.fetch;

export function _setBoardCopyFetch(fn) {
  fetchImpl = typeof fn === 'function' ? fn : globalThis.fetch;
}

export function boardCopyPath(table) {
  return `boards/${table}.json`;
}

function clean(value) {
  return String(value || '').trim();
}

// Read-write tokens encode the store id as the fourth underscore segment
// (vercel_blob_rw_<storeId>). OIDC uses BLOB_STORE_ID, without a store_ prefix
// in the hostname.
export function blobCredentials(env = process.env) {
  const readWrite = clean(env.BLOB_READ_WRITE_TOKEN);
  if (readWrite) {
    const storeId = readWrite.split('_')[3] || '';
    if (!storeId) return null;
    return { token: readWrite, storeId };
  }
  const oidc = clean(env.VERCEL_OIDC_TOKEN);
  let storeId = clean(env.BLOB_STORE_ID);
  if (storeId.startsWith('store_')) storeId = storeId.slice('store_'.length);
  if (!oidc || !storeId) return null;
  return { token: oidc, storeId };
}

export async function readBoardCopy(table, options = {}) {
  if (!TABLE_NAME.test(table)) return null;
  const auth = blobCredentials(options.env || process.env);
  if (!auth) return null;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500;
  if (timeoutMs <= 0) return null;
  const url = new URL(`https://${auth.storeId}.private.blob.vercel-storage.com/${boardCopyPath(table)}`);
  // An overwrite has to be visible on the next cold read.
  url.searchParams.set('cache', '0');
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response || response.status === 404 || !response.ok) return null;
    const body = await response.json();
    if (!body || body.data == null || typeof body !== 'object') return null;
    return { data: body.data, updated_at: body.updated_at || null };
  } catch {
    return null;
  }
}

export { BLOB_API, BLOB_API_VERSION };
