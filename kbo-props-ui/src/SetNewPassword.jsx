import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { loadSupabase } from './supabaseClient';
import { applyNewPassword } from './passwordRecovery';
import './AuthPage.css';

export default function SetNewPassword({ onDone } = {}) {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [linkReady, setLinkReady] = useState(false);
  const sessionReady = Boolean(user) || linkReady;

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    loadSupabase().then((supabase) => {
      if (cancelled || !supabase) return;
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (event === 'PASSWORD_RECOVERY' || session?.user) setLinkReady(true);
      });
      unsubscribe = () => subscription.unsubscribe();
      supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && data?.session?.user) setLinkReady(true);
      }).catch(() => { /* the form stays until a session arrives */ });
    }).catch(() => { /* a failed client download must not block the form */ });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const supabase = await loadSupabase();
    if (!supabase) {
      setError('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.');
      setLoading(false);
      return;
    }
    if (!sessionReady) {
      setError('This reset link is still opening. Wait a moment and try again.');
      setLoading(false);
      return;
    }
    const result = await applyNewPassword(supabase, password);
    if (!result.ok) setError(result.message);
    else setMessage(result.message);
    setLoading(false);
  }

  const email = user?.email || '';

  return (
    <div className="auth-page" data-testid="set-new-password">
      <div className="auth-bg" />
      <div className="auth-card">
        <div className="auth-logo" aria-hidden="true">
          <span className="auth-logo-k">cgpropz</span>
        </div>
        <p className="auth-tagline">Set a new password</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <p className="auth-notice">
            {email
              ? `Choose a new password for ${email}. You'll stay signed in after saving.`
              : "Choose a new password. You'll stay signed in after saving."}
          </p>
          <label className="auth-label">
            New password
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password (6+ chars)"
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          <label className="auth-label">
            Confirm password
            <input
              className="auth-input"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Repeat the new password"
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          {error && <div className="auth-error" data-testid="set-password-error">{error}</div>}
          {message && <div className="auth-success" data-testid="set-password-success">{message}</div>}
          {message ? (
            <button className="auth-submit" type="button" onClick={() => onDone?.()}>
              Continue
            </button>
          ) : (
            <button className="auth-submit" type="submit" disabled={loading || !sessionReady}>
              {loading ? '...' : 'Save password'}
            </button>
          )}
          {!message && !sessionReady && (
            <p className="auth-notice">Opening your reset link…</p>
          )}
        </form>
      </div>
    </div>
  );
}
