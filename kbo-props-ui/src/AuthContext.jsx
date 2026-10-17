import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { devTierOverride, NBA_OWNER_EMAIL } from './entitlements';
import { loadSupabase, readCachedSession } from './supabaseClient';
import { SET_PASSWORD_PATH, isPasswordRecoveryLocation } from './passwordRecovery';

const EMPTY_DISCORD = { userId: null, username: null, discordOnly: false };
const TIER_CACHE_KEY = 'cg_tier';
const AuthContext = createContext({
  user: null,
  tier: 'free',
  tierConfirmed: true,
  loading: false,
  signOut: () => {},
  refreshTier: () => {},
  discord: EMPTY_DISCORD,
  refreshDiscord: () => {},
  passwordRecovery: false,
  clearPasswordRecovery: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function readDevPreview() {
  if (typeof window === 'undefined') return null;
  const tier = devTierOverride(import.meta.env.DEV, window.location.search);
  if (!tier) return null;
  return {
    user: { id: 'dev-tier-preview', email: tier === 'owner' ? NBA_OWNER_EMAIL : `${tier}@preview.local` },
    tier,
  };
}

function recoveryFromWindow() {
  if (typeof window === 'undefined') return false;
  return isPasswordRecoveryLocation(window.location.search, window.location.hash, window.location.pathname);
}

function readCachedTier(userId) {
  if (typeof sessionStorage === 'undefined' || !userId) return 'free';
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TIER_CACHE_KEY) || 'null');
    if (parsed?.userId === userId && typeof parsed.tier === 'string') return parsed.tier;
  } catch { /* ignore */ }
  return 'free';
}

function writeCachedTier(userId, tier) {
  if (typeof sessionStorage === 'undefined' || !userId || !tier) return;
  try { sessionStorage.setItem(TIER_CACHE_KEY, JSON.stringify({ userId, tier })); } catch { /* ignore */ }
}

function clearCachedTier() {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.removeItem(TIER_CACHE_KEY); } catch { /* ignore */ }
}

// Read once at load. Production builds pass isDev=false, so this stays null.
const DEV_PREVIEW = readDevPreview();
const CACHED_SESSION = DEV_PREVIEW ? null : readCachedSession();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(DEV_PREVIEW?.user ?? CACHED_SESSION?.user ?? null);
  const [tier, setTier] = useState(DEV_PREVIEW?.tier ?? (CACHED_SESSION?.user ? readCachedTier(CACHED_SESSION.user.id) : 'free'));
  const [tierConfirmed, setTierConfirmed] = useState(() => Boolean(DEV_PREVIEW) || !CACHED_SESSION?.user);
  const [discord, setDiscord] = useState(EMPTY_DISCORD);
  const [passwordRecovery, setPasswordRecovery] = useState(recoveryFromWindow);
  // Session is resolved from local storage before paint. Tier refresh and the
  // Supabase client download stay off the first render.
  const loading = false;
  const userRef = useRef(DEV_PREVIEW?.user ?? CACHED_SESSION?.user ?? null);
  const lastPaidDiscordSync = useRef(0);

  const applyTier = useCallback((next, userId) => {
    setTier(next || 'free');
    writeCachedTier(userId || userRef.current?.id, next || 'free');
  }, []);

  const fetchDiscord = useCallback(async (userId) => {
    const client = await loadSupabase();
    if (!client || !userId) return;
    const { data, error } = await client
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
    const client = await loadSupabase();
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
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
    if (DEV_PREVIEW || !userId) return;
    const client = await loadSupabase();
    if (!client) return;
    const { data: rows } = await client
      .from('user_profiles')
      .select('tier')
      .eq('id', userId)
      .limit(1);

    const dbTier = Array.isArray(rows) && rows.length > 0 ? rows[0]?.tier : null;

    // Paid site tiers are not recomputed on the client. Still retry the
    // Discord role sync (throttled) so a failed webhook update can land.
    // Discord-only is not a site tier: the server may upgrade it to All-Access.
    if (dbTier && dbTier !== 'free' && dbTier !== 'discord') {
      applyTier(dbTier, userId);
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
        applyTier(body.tier || 'free', userId);
        await fetchDiscord(userId);
        return;
      }
    } catch {
      // Sync failed (e.g. local dev with no API) — fall through to free
    }

    applyTier(dbTier || 'free', userId);
    await fetchDiscord(userId);
  }, [applyTier, fetchDiscord, postSync]);

  // Public method: force a tier re-check (e.g. after payment)
  const confirmTier = useCallback((userId) => {
    setTierConfirmed(false);
    return Promise.resolve(fetchTier(userId)).finally(() => {
      if (userRef.current?.id === userId) setTierConfirmed(true);
    });
  }, [fetchTier]);

  const refreshTier = useCallback(() => {
    const uid = userRef.current?.id;
    if (uid) return fetchTier(uid);
  }, [fetchTier]);

  const refreshDiscord = useCallback(() => {
    const uid = userRef.current?.id;
    if (uid) return fetchDiscord(uid);
  }, [fetchDiscord]);

  useEffect(() => {
    if (DEV_PREVIEW) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};
    const start = () => {
      loadSupabase().then((client) => {
        if (cancelled || !client) return;
        client.auth.getSession().then(({ data: { session } }) => {
          if (cancelled) return;
          const u = session?.user ?? null;
          setUser(u);
          userRef.current = u;
          if (u) confirmTier(u.id);
          else {
            setTier('free');
            setTierConfirmed(true);
            clearCachedTier();
          }
        });
        const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
          const u = session?.user ?? null;
          setUser(u);
          userRef.current = u;
          if (u) {
            confirmTier(u.id);
          } else {
            setTier('free');
            setTierConfirmed(true);
            setDiscord(EMPTY_DISCORD);
            clearCachedTier();
          }
        });
        if (cancelled) subscription.unsubscribe();
        else unsubscribe = () => subscription.unsubscribe();
      }).catch(() => { /* a failed client download must not block the shell */ });
    };
    // Logged-out visitors have nothing to refresh. The Supabase client is a
    // separate ~51KB chunk; downloading it on the landing page competes with
    // the hero. Sign-in loads it from AuthPage. A cached session still
    // refreshes immediately so a member reaches the Sports Hub. A recovery
    // link has no cached session yet; the client must start so the
    // PASSWORD_RECOVERY event can establish one.
    if (!readCachedSession() && !passwordRecovery) return undefined;
    start();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [confirmTier, passwordRecovery]);

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

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('recovery');
    if (url.pathname.replace(/\/+$/, '') === SET_PASSWORD_PATH) url.pathname = '/';
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, []);

  async function signOut() {
    const client = await loadSupabase();
    if (client) await client.auth.signOut();
    setUser(null);
    userRef.current = null;
    setTier('free');
    setTierConfirmed(true);
    setDiscord(EMPTY_DISCORD);
    clearCachedTier();
  }

  return (
    <AuthContext.Provider value={{ user, tier, tierConfirmed, loading, signOut, refreshTier, discord, refreshDiscord, passwordRecovery, clearPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  );
}
