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

export function readCachedSession(storage = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return null
  const key = supabaseStorageKey()
  if (!key) return null
  try {
    return parseCachedSession(storage.getItem(key))
  } catch {
    return null
  }
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
