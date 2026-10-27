import { canSeeCheatsheets } from '../entitlements.js'
import { loadSupabase } from '../supabaseClient.js'

// Used only when the page loads with ?cheatsheets=1 and no user yet.
// A cached session is already on the auth user, so this does not run then.
export async function signedInCanSeeCheatsheets() {
  try {
    const client = await loadSupabase()
    if (!client) return false
    const { data } = await client.auth.getSession()
    return canSeeCheatsheets(data?.session?.user ?? null)
  } catch {
    return false
  }
}
