// The Supabase browser client is a large dependency. Callers load it on
// demand so the first paint of the shell does not wait on it. Anonymous
// visitors can read public preview data with no session at all.

const viteEnv = import.meta.env ?? {}

let clientPromise = null
let clientFactory = null

// Tests stand in for the dynamic import. Production leaves this unset.
export function _setSupabaseClientFactory(factory) {
  clientPromise = null
  loadedClient = null
  clientFactory = typeof factory === 'function' ? factory : null
}

export function supabaseStorageKey(url = viteEnv.VITE_SUPABASE_URL || '') {
  try {
    const ref = new URL(url).hostname.split('.')[0]
    return ref ? `sb-${ref}-auth-token` : ''
  } catch {
    return ''
  }
}

export function parseCachedSession(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const session = parsed?.currentSession?.user ? parsed.currentSession : parsed
    const user = session?.user
    if (!user?.id) return null
    return {
      user,
      expiresAt: Number(session.expires_at) || null,
      accessToken: session.access_token || null,
    }
  } catch {
    return null
  }
}

function isAuthTokenKey(name) {
  return typeof name === 'string' && /^sb-[a-z0-9-]+-auth-token$/.test(name)
}

function storageKeyNames(storage) {
  try {
    if (typeof storage.keys === 'function') return [...storage.keys()]
    return Object.keys(storage)
  } catch {
    return []
  }
}

// Prefer the key for this build. A preview whose bundle did not inline the
// project URL still has to see the session the proof (or an older build)
// stored under sb-<ref>-auth-token, or the member stays on the free paywall.
export function readCachedSession(storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  const preferred = supabaseStorageKey()
  const names = []
  if (preferred) names.push(preferred)
  for (const name of storageKeyNames(storage)) {
    if (isAuthTokenKey(name) && !names.includes(name)) names.push(name)
  }
  for (const name of names) {
    try {
      const parsed = parseCachedSession(storage.getItem(name))
      if (parsed) return parsed
    } catch {
      /* try the next key */
    }
  }
  return null
}

// A still-valid cached access token lets paid data start before the client
// library downloads. Expired tokens return null so the caller can refresh.
export function cachedAccessToken(now = Date.now()) {
  const cached = readCachedSession()
  if (!cached?.accessToken) return null
  if (cached.expiresAt && cached.expiresAt * 1000 < now + 30_000) return null
  return cached.accessToken
}

// getSession takes the auth lock and can sit there indefinitely. Board loads
// wait this long, then use the cached bearer or continue without one.
export const TOKEN_WAIT_MS = 2_000

export async function boundedAccessToken({ fresh = false, waitMs = TOKEN_WAIT_MS } = {}) {
  const cached = cachedAccessToken()
  if (cached && !fresh) return cached
  if (!readCachedSession() && !cached) return null
  let timer
  try {
    const token = await Promise.race([
      fresh ? refreshedAccessToken() : sessionAccessToken(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs) }),
    ])
    return token || cachedAccessToken()
  } catch {
    return cachedAccessToken()
  } finally {
    clearTimeout(timer)
  }
}

export function loadSupabase() {
  const url = viteEnv.VITE_SUPABASE_URL || ''
  const key = viteEnv.VITE_SUPABASE_ANON_KEY || ''
  if (!clientFactory && (!url || !key)) return Promise.resolve(null)
  if (!clientPromise) {
    const pending = clientFactory
      ? Promise.resolve().then(() => clientFactory())
      : import('@supabase/supabase-js').then(({ createClient }) => createClient(url, key))
    clientPromise = pending.catch((err) => {
      clientPromise = null
      throw err
    })
    clientPromise.then(notifyLoaded, () => {})
  }
  return clientPromise
}

// AuthContext skips the client download for logged-out visitors. When the
// sign-in form loads the client, AuthContext still has to hear SIGNED_IN, or
// the page stays on the form until a reload.
const loadedListeners = new Set()
let loadedClient = null

function notifyLoaded(client) {
  if (!client) return
  loadedClient = client
  for (const fn of [...loadedListeners]) {
    try { fn(client) } catch { /* a listener error must not block sign-in */ }
  }
}

export function onSupabaseLoaded(fn) {
  if (typeof fn !== 'function') return () => {}
  if (loadedClient) {
    fn(loadedClient)
    return () => {}
  }
  loadedListeners.add(fn)
  return () => loadedListeners.delete(fn)
}

// refreshedAccessToken() is called only by the board paths in apiData.js that
// run after a paid member was answered with a free preview (the server did
// not accept the stored token). Hub loads and sport retries use the stored
// token and never come here. In that case:
//   - if the stored token has expired (or there is none) nothing is forced;
//     getSession() lets the library refresh it on its own,
//   - otherwise one real refreshSession() runs, at most once per tab per
//     REFRESH_COOLDOWN_MS (the time is kept in sessionStorage, so a reload
//     does not start a new window), and concurrent callers share it,
//   - a 429, 5xx or network error puts the stored session back and keeps the
//     tier, unless the member signed out meanwhile. Other tabs see a guard
//     flag in localStorage and recheck before treating SIGNED_OUT as real.
// Forcing a refresh on every board load hit Supabase's 429 rate limit and the
// library then signed the member out (SEV-1, Oct 18, #268).
export const REFRESH_COOLDOWN_MS = 60_000
export const LAST_REFRESH_KEY = 'cg_auth_last_refresh'
export const REFRESH_GUARD_KEY = 'cg_auth_refresh_guard'
export const USER_SIGNOUT_KEY = 'cg_auth_user_signout'
// A guard older than this is stale (tab closed mid-refresh).
export const REFRESH_GUARD_TTL_MS = 15_000

let refreshInFlight = null
let refreshGuard = null
let nowFn = () => Date.now()

function local() {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function session() {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage
}

function readNumber(storage, key) {
  try {
    const n = Number(storage?.getItem?.(key))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function writeValue(storage, key, value) {
  try {
    if (value == null) storage?.removeItem?.(key)
    else storage?.setItem?.(key, String(value))
  } catch {
    /* blocked storage: the in-memory state still applies */
  }
}

// Tests only.
// keepStorage simulates a page reload: memory resets, storage survives.
export function _resetRefreshState({ now, keepStorage = false } = {}) {
  refreshInFlight = null
  refreshGuard = null
  nowFn = typeof now === 'function' ? now : () => Date.now()
  if (keepStorage) return
  writeValue(session(), LAST_REFRESH_KEY, null)
  writeValue(local(), REFRESH_GUARD_KEY, null)
  writeValue(local(), USER_SIGNOUT_KEY, null)
}

// The member signed out (this tab's Sign out, or a SIGNED_OUT that no
// refresh of ours caused). A transient refresh result must not undo it.
export function markUserSignOut() {
  writeValue(local(), USER_SIGNOUT_KEY, nowFn())
}

function signedOutSince(startedAt) {
  return readNumber(local(), USER_SIGNOUT_KEY) >= startedAt
}

// True while some tab runs a guarded refresh.
export function crossTabRefreshActive(now = nowFn()) {
  const at = readNumber(local(), REFRESH_GUARD_KEY)
  return at > 0 && now - at < REFRESH_GUARD_TTL_MS
}

// auth-js removes the stored session and emits SIGNED_OUT on any refresh error
// that is not a 5xx/network error, 429 included. While this tab's refresh
// runs, AuthContext hands a SIGNED_OUT here instead of applying it. It is
// applied only if the refresh turns out to be a real rejection.
export function deferSignOutDuringRefresh(apply) {
  if (!refreshGuard || typeof apply !== 'function') return false
  refreshGuard.deferred.push(apply)
  return true
}

// A SIGNED_OUT from another tab (BroadcastChannel) or the library: hold it if
// the stored token is still good or a refresh is running somewhere.
export function shouldHoldSignOut(now = nowFn()) {
  if (signedOutSince(now - REFRESH_GUARD_TTL_MS) && !crossTabRefreshActive(now)) return false
  return Boolean(cachedAccessToken(now)) || crossTabRefreshActive(now)
}

// Waits, then asks the client again. Resolves true when the member really is
// signed out, false when a session came back (transient 429 in another tab).
export async function confirmSignOut(getSession, {
  waitMs = 500,
  maxWaits = 8,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  for (let i = 0; i < maxWaits; i += 1) {
    await sleep(waitMs)
    if (crossTabRefreshActive()) continue
    break
  }
  try {
    const { data } = await getSession()
    return !data?.session?.user
  } catch {
    return !readCachedSession()
  }
}

export function isTransientAuthError(err) {
  if (!err) return false
  const status = Number(err.status)
  if (status === 429 || status >= 500) return true
  if (err.code === 'over_request_rate_limit') return true
  if (err.name === 'AuthRetryableFetchError') return true
  // A thrown fetch failure has no status at all.
  return !status
}

function storedSessionEntry(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  const preferred = supabaseStorageKey()
  const names = []
  if (preferred) names.push(preferred)
  for (const name of storageKeyNames(storage)) {
    if (isAuthTokenKey(name) && !names.includes(name)) names.push(name)
  }
  for (const name of names) {
    try {
      const raw = storage.getItem(name)
      if (parseCachedSession(raw)) return { name, raw }
    } catch {
      /* next key */
    }
  }
  return null
}

function restoreStoredSession(storage, entry) {
  if (!entry || !storage || typeof storage.setItem !== 'function') return
  try {
    if (storage.getItem(entry.name) !== entry.raw) storage.setItem(entry.name, entry.raw)
  } catch {
    /* storage full or blocked: nothing more to do */
  }
}

async function runGuardedRefresh(cached) {
  const storage = local()
  const entry = storedSessionEntry(storage)
  const guard = { deferred: [] }
  const startedAt = nowFn()
  refreshGuard = guard
  writeValue(storage, REFRESH_GUARD_KEY, startedAt)
  let transient = true
  try {
    const client = await loadSupabase()
    if (!client) return cached.accessToken
    const { data, error } = await client.auth.refreshSession()
    if (!error && data?.session?.access_token) {
      transient = false
      guard.deferred = []
      return data.session.access_token
    }
    transient = error ? isTransientAuthError(error) : true
    if (transient && !signedOutSince(startedAt)) return cached.accessToken
    return null
  } catch {
    return signedOutSince(startedAt) ? null : cached.accessToken
  } finally {
    if (refreshGuard === guard) refreshGuard = null
    const userLeft = signedOutSince(startedAt)
    if (transient && !userLeft) {
      restoreStoredSession(storage, entry)
    } else {
      for (const apply of guard.deferred) {
        try { apply() } catch { /* keep going */ }
      }
    }
    writeValue(storage, REFRESH_GUARD_KEY, null)
  }
}

export async function refreshedAccessToken() {
  if (refreshInFlight) return refreshInFlight
  const cached = readCachedSession()
  // Logged out, or an expired token the library refreshes itself.
  if (!cached?.accessToken || !cachedAccessToken(nowFn())) return sessionAccessToken()
  const last = readNumber(session(), LAST_REFRESH_KEY)
  if (last && nowFn() - last < REFRESH_COOLDOWN_MS) return sessionAccessToken()
  writeValue(session(), LAST_REFRESH_KEY, nowFn())
  refreshInFlight = runGuardedRefresh(cached).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

export async function sessionAccessToken() {
  const client = await loadSupabase()
  if (!client) return null
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.access_token || null
  } catch {
    return null
  }
}
