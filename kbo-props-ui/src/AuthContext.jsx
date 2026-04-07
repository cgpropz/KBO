import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext({ user: null, tier: 'free', loading: true, signOut: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tier, setTier] = useState('free');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchTier(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchTier(session.user.id);
      } else {
        setTier('free');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchTier(userId) {
    if (!supabase) return;
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
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setTier('free');
  }

  return (
    <AuthContext.Provider value={{ user, tier, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
