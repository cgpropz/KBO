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
    const { data } = await supabase
      .from('user_profiles')
      .select('tier')
      .eq('id', userId)
      .single();
    setTier(data?.tier || 'free');
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
