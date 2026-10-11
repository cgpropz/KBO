import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { devTierOverride } from './entitlements';
import { supabase } from './supabaseClient';

const EMPTY_DISCORD = { userId: null, username: null, discordOnly: false };
const AuthContext = createContext({
  user: null,
  tier: 'free',
  loading: true,
  signOut: () => {},
  refreshTier: () => {},
  discord: EMPTY_DISCORD,
  refreshDiscord: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function readDevPreview() {
  if (typeof window === 'undefined') return null;
  const tier = devTierOverride(import.meta.env.DEV, window.location.search);
  if (!tier) return null;
  return {
    user: { id: 'dev-tier-preview', email: `${tier}@preview.local` },
    tier,
  };
}

// Read once at load. Production builds pass isDev=false, so this stays null.
const DEV_PREVIEW = readDevPreview();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(DEV_PREVIEW?.user ?? null);
  const [tier, setTier] = useState(DEV_PREVIEW?.tier ?? 'free');
  const [discord, setDiscord] = useState(EMPTY_DISCORD);
  const [loading, setLoading] = useState(!DEV_PREVIEW);
  const userRef = useRef(DEV_PREVIEW?.user ?? null);
  const lastPaidDiscordSync = useRef(0);

  const fetchDiscord = useCallback(async (userId) => {
    if (!supabase || !userId) return;
    const { data, error } = await supabase
      .from('user_profiles')
      .select('discord_user_id, discord_username, discord_only')
      .eq('id', userId)
      .limit(1);
    if (error) return;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    setDiscord({
      userId: row?.discord_user_id || null,
      username: row?.discord_username || null,
      discordOnly: row?.discord_only === true,
    });
  }, []);

  const postSync = useCallback(async () => {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    const resp = await fetch('/api/sync-subscription', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return resp.json();
  }, []);

  const fetchTier = useCallback(async (userId) => {
    if (DEV_PREVIEW || !supabase || !userId) return;
    const { data: rows } = await supabase
      .from('user_profiles')
      .select('tier')
      .eq('id', userId)
      .limit(1);

    const dbTier = Array.isArray(rows) && rows.length > 0 ? rows[0]?.tier : null;

    // Paid site tiers are not recomputed on the client. Still retry the
    // Discord role sync (throttled) so a failed webhook update can land.
    // Discord-only is not a site tier: the server may upgrade it to All-Access.
    if (dbTier && dbTier !== 'free' && dbTier !== 'discord') {
      setTier(dbTier);
      await fetchDiscord(userId);
      if (Date.now() - lastPaidDiscordSync.current > 60_000) {
        lastPaidDiscordSync.current = Date.now();
        try { await postSync(); } catch { /* Discord retry must not block the app */ }
        await fetchDiscord(userId);
      }
      return;
    }

    // No site tier in the DB — ask the server to check Stripe and self-heal.
    try {
      const body = await postSync();
      if (body) {
        setTier(body.tier || 'free');
        await fetchDiscord(userId);
        return;
      }
    } catch {
      // Sync failed (e.g. local dev with no API) — fall through to free
    }

    setTier(dbTier || 'free');
    await fetchDiscord(userId);
  }, [fetchDiscord, postSync]);

  // Public method: force a tier re-check (e.g. after payment)
  const refreshTier = useCallback(() => {
    const uid = userRef.current?.id;
    if (uid) return fetchTier(uid);
  }, [fetchTier]);

  const refreshDiscord = useCallback(() => {
    const uid = userRef.current?.id;
    if (uid) return fetchDiscord(uid);
  }, [fetchDiscord]);

  useEffect(() => {
    if (DEV_PREVIEW) return;
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Wait for BOTH session + tier before clearing loading
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      userRef.current = u;
      if (u) await fetchTier(u.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      userRef.current = u;
      if (u) {
        fetchTier(u.id);
      } else {
        setTier('free');
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchTier]);

  // Re-check tier when user returns to the tab (e.g. after paying in Stripe tab)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && userRef.current?.id) {
        fetchTier(userRef.current.id);
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchTier]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    userRef.current = null;
    setTier('free');
    setDiscord(EMPTY_DISCORD);
  }

  return (
    <AuthContext.Provider value={{ user, tier, loading, signOut, refreshTier, discord, refreshDiscord }}>
      {children}
    </AuthContext.Provider>
  );
}
