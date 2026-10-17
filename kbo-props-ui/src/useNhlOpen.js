import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './AuthContext';
import { nhlDevBypass } from './entitlements';
import { readOpenFlag } from './openFlag';
import { boundedAccessToken, cachedAccessToken } from './supabaseClient';

// The browser does not decide full access. Every signed-in account asks
// /api/nhl-access, which uses the same All-Access entitlement as KBO, WNBA,
// and NFL, plus the admin email. Logged-out visitors stay closed and do not
// call it. The NHL tab itself stays visible; this flag only lifts the paywall
// for the admin when their stored tier is not already All-Access.
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
    let token = cachedAccessToken();
    if (!token) token = await boundedAccessToken();
    const open = await readOpenFlag('/api/nhl-access', {
      token,
      cancelled: () => id !== ticket,
    });
    if (id === ticket) emit({ key, open, ready: true, inflight: false });
  } catch {
    if (id === ticket) emit({ key, open: false, ready: true, inflight: false });
  }
}

export function useNhlOpen() {
  const { user, loading } = useAuth();
  const dev = devOpen();
  const key = loading ? '' : dev ? 'dev' : !user ? 'anon' : `user:${user.id || ''}`;
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key.startsWith('user:')) return;
    if (snapshot.key === key && (snapshot.ready || snapshot.inflight)) return;
    const id = ++ticket;
    emit({ key, open: false, ready: false, inflight: true });
    resolveRemote(key, id);
  }, [key]);

  if (!key) return { open: false, ready: false };
  if (key === 'dev') return { open: true, ready: true };
  if (key === 'anon') return { open: false, ready: true };
  if (snap.key !== key) return { open: false, ready: false };
  return { open: snap.open === true, ready: snap.ready === true };
}
