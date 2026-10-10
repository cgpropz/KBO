import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import './Discord.css';

const EMPTY = { userId: null, username: null, discordOnly: false };

export default function DiscordAccount({ compact = false }) {
  const { user, discord, refreshDiscord } = useAuth();
  const linked = discord || EMPTY;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('discord');
    if (!status) return undefined;
    if (status === 'connected') {
      setMessage('Discord connected. Your role updates within a minute.');
    } else if (status === 'error') {
      setMessage('Discord connection didn’t finish. Try Connect again.');
    }
    params.delete('discord');
    params.delete('reason');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', next);
    refreshDiscord?.();
    return undefined;
  }, [refreshDiscord]);

  if (!user) return null;

  async function authHeader() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    return { Authorization: `Bearer ${token}` };
  }

  async function connect() {
    setBusy(true);
    setMessage('');
    try {
      const headers = await authHeader();
      if (!headers) {
        setMessage('Sign in again to connect Discord.');
        return;
      }
      const res = await fetch('/api/discord-auth', { method: 'POST', headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        setMessage(body.error || 'Discord connect is not available yet.');
        return;
      }
      window.location.assign(body.url);
    } catch {
      setMessage('Discord connect is not available yet.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage('');
    try {
      const headers = await authHeader();
      if (!headers) {
        setMessage('Sign in again to disconnect Discord.');
        return;
      }
      const res = await fetch('/api/discord-disconnect', { method: 'POST', headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Could not disconnect Discord.');
        return;
      }
      await refreshDiscord?.();
      setMessage('Discord disconnected. Hand-assigned server roles are unchanged.');
    } catch {
      setMessage('Could not disconnect Discord.');
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(linked.userId);

  return (
    <section className={`discord-account${compact ? ' discord-account-compact' : ''}`} aria-label="Discord account">
      <div className="discord-account-copy">
        <h3>Discord</h3>
        {connected ? (
          <p>Connected{linked.username ? ` as ${linked.username}` : ''}.</p>
        ) : (
          <p>Connect Discord to get the role for your plan. Paying members see the plays in the server.</p>
        )}
        {message && <p className="discord-account-msg" role="status">{message}</p>}
      </div>
      <div className="discord-account-actions">
        {connected ? (
          <>
            <button type="button" className="discord-btn discord-btn-primary" onClick={connect} disabled={busy}>Reconnect</button>
            <button type="button" className="discord-btn" onClick={disconnect} disabled={busy}>Disconnect</button>
          </>
        ) : (
          <button type="button" className="discord-btn discord-btn-primary" onClick={connect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect Discord'}
          </button>
        )}
      </div>
    </section>
  );
}
