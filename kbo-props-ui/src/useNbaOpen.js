import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './AuthContext';
import { canSeeNba } from './entitlements';
import { supabase } from './supabaseClient';

// One in-flight check shared by the hub, the public landing, and the switcher.
// The owner email is full immediately. Logged-out visitors are never full, so
// they do not call the endpoint. Other signed-in accounts ask /api/nba-access
// and stay closed until that says open.
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

async function resolveRemote(key, id) {
  try {
    let token = null;
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || null;
    }
    const res = await fetch('/api/nba-access', {
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

export function useNbaOpen() {
  const { user, loading } = useAuth();
  const owner = canSeeNba(user);
  const key = loading ? '' : owner ? 'owner' : !user ? 'anon' : `user:${user.id || ''}`;
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key.startsWith('user:')) return;
    if (snapshot.key === key && (snapshot.ready || snapshot.inflight)) return;
    const id = ++ticket;
    emit({ key, open: false, ready: false, inflight: true });
    resolveRemote(key, id);
  }, [key]);

  if (!key) return { open: false, ready: false };
  if (key === 'owner') return { open: true, ready: true };
  if (key === 'anon') return { open: false, ready: true };
  if (snap.key !== key) return { open: false, ready: false };
  return { open: snap.open === true, ready: snap.ready === true };
}
