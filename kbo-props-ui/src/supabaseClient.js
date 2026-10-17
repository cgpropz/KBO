// The Supabase browser client is a large dependency. Callers load it on
// demand so the first paint of the shell does not wait on it. Anonymous
// visitors can read public preview data with no session at all.

const viteEnv = import.meta.env ?? {}

let clientPromise = null

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

export function loadSupabase() {
  const url = viteEnv.VITE_SUPABASE_URL || ''
  const key = viteEnv.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !key) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(url, key))
      .catch((err) => {
        clientPromise = null
        throw err
      })
  }
  return clientPromise
}

// Forces a token refresh. Used when the server answered a signed-in request
// as logged out (revoked or rejected access token that has not expired yet).
export async function refreshedAccessToken() {
  const client = await loadSupabase()
  if (!client) return null
  try {
    const { data, error } = await client.auth.refreshSession()
    if (!error && data?.session?.access_token) return data.session.access_token
  } catch {
    /* fall through to the stored session */
  }
  return sessionAccessToken()
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
