import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './AuthContext';
import { canSeeNhl, nhlDevBypass } from './entitlements';
import { supabase } from './supabaseClient';

// Same shape as useNbaOpen. The owner email is full immediately. Logged-out
// visitors stay closed. Other accounts ask /api/nhl-access.
// A dev server with ?nhl=1 opens the tab for screenshots. Production builds
// compile DEV to false, so that query cannot open the live site.
const listeners = new Set();
let snapshot = { key: '', open: false, ready: false, inflight: false };
let ticket = 0;

function emit(next) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function devOpen() {
  if (typeof window === 'undefined') return false;
  return nhlDevBypass(import.meta.env.DEV, window.location.search);
}

async function resolveRemote(key, id) {
  try {
    let token = null;
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || null;
    }
    const res = await fetch('/api/nhl-access', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    let open = false;
    if (res.ok) {
      const body = await res.json();
      open = body?.open === true;
    }
    if (id === ticket) emit({ key, open, ready: true, inflight: false });
  } catch {
    if (id === ticket) emit({ key, open: false, ready: true, inflight: false });
  }
}

export function useNhlOpen() {
  const { user, loading } = useAuth();
  const owner = canSeeNhl(user);
  const dev = devOpen();
  const key = loading ? '' : dev ? 'dev' : owner ? 'owner' : !user ? 'anon' : `user:${user.id || ''}`;
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key.startsWith('user:')) return;
    if (snapshot.key === key && (snapshot.ready || snapshot.inflight)) return;
    const id = ++ticket;
    emit({ key, open: false, ready: false, inflight: true });
    resolveRemote(key, id);
  }, [key]);

  if (!key) return { open: false, ready: false };
  if (key === 'dev' || key === 'owner') return { open: true, ready: true };
  if (key === 'anon') return { open: false, ready: true };
  if (snap.key !== key) return { open: false, ready: false };
  return { open: snap.open === true, ready: snap.ready === true };
}
