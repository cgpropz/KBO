import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext({ user: null, tier: 'free', loading: true, signOut: () => {}, refreshTier: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tier, setTier] = useState('free');
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);

  const fetchTier = useCallback(async (userId) => {
    if (!supabase || !userId) return;
    const { data: rows } = await supabase
      .from('user_profiles')
      .select('tier')
      .eq('id', userId)
      .limit(1);

    const dbTier = Array.isArray(rows) && rows.length > 0 ? rows[0]?.tier : null;

    // If they already have a paid tier, we're done
    if (dbTier && dbTier !== 'free') {
      setTier(dbTier);
      return;
    }

    // No paid tier in DB — ask the server to check Stripe and self-heal
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token) {
        const resp = await fetch('/api/sync-subscription', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const { tier: syncedTier } = await resp.json();
          setTier(syncedTier || 'free');
          return;
        }
      }
    } catch (_) {
      // Sync failed (e.g. local dev with no API) — fall through to free
    }

    setTier(dbTier || 'free');
  }, []);

  // Public method: force a tier re-check (e.g. after payment)
  const refreshTier = useCallback(() => {
    const uid = userRef.current?.id;
    if (uid) return fetchTier(uid);
  }, [fetchTier]);

  useEffect(() => {
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
  }

  return (
    <AuthContext.Provider value={{ user, tier, loading, signOut, refreshTier }}>
      {children}
    </AuthContext.Provider>
  );
}
