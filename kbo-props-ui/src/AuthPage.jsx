import { useState } from 'react';
import { supabase } from './supabaseClient';
import { getAttribution } from './tracking';
import './AuthPage.css';

export default function AuthPage({ initialMode = 'login', onBack } = {}) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    if (!supabase) {
      setError('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.');
      setLoading(false);
      return;
    }

    if (mode === 'reset') {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (err) setError(err.message);
      else setMessage('Password reset email sent! Check your inbox.');
      setLoading(false);
      return;
    }

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
    } else {
      // Keep marketing attribution (utm_* / twclid captured on landing) with the
      // new account as Supabase user metadata.
      const attribution = getAttribution();
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        ...(Object.keys(attribution).length ? { options: { data: { attribution } } } : {}),
      });
      if (err) {
        setError(err.message);
      } else {
        setMessage('Check your email to confirm your account, then log in.');
        setMode('login');
        // X (Twitter) lead generation conversion tracking event
        window.twq && window.twq('event', 'tw-pul9k-pul9n', {});
      }
    }
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-card">
        <button type="button" className="auth-logo" onClick={onBack} disabled={!onBack}>
          <span className="auth-logo-k">cgpropz</span>
        </button>
        <p className="auth-tagline">Hand-crafted props for ⚾ KBO, 🏀 WNBA & 🏈 NFL</p>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'auth-tab-active' : ''}`}
            onClick={() => { setMode('login'); setError(''); setMessage(''); }}
          >
            Log In
          </button>
          <button
            className={`auth-tab ${mode === 'signup' ? 'auth-tab-active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); setMessage(''); }}
          >
            Sign Up Free
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>
          {mode !== 'reset' && (
            <label className="auth-label">
              Password
              <input
                className="auth-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Create a password (6+ chars)' : 'Your password'}
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
          )}

          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-success">{message}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? '...' : mode === 'reset' ? 'Send Reset Link' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>

          {mode === 'login' && (
            <button type="button" className="auth-link auth-forgot" onClick={() => { setMode('reset'); setError(''); setMessage(''); }}>
              Forgot password?
            </button>
          )}
          {mode === 'reset' && (
            <button type="button" className="auth-link auth-forgot" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>
              Back to login
            </button>
          )}
        </form>

        <div className="auth-footer">
          {mode === 'login' ? (
            <p>No account? <button className="auth-link" onClick={() => setMode('signup')}>Sign up free</button></p>
          ) : (
            <p>Already have an account? <button className="auth-link" onClick={() => setMode('login')}>Log in</button></p>
          )}
        </div>

        <div className="auth-features">
          <div className="auth-feature"><span className="auth-feature-icon">⚡</span> Free: Today's top picks &amp; schedule</div>
          <div className="auth-feature"><span className="auth-feature-icon">🔓</span> Pro: Full projections, slip builder &amp; more</div>
        </div>

        {onBack && (
          <button type="button" className="auth-link auth-back" onClick={onBack}>
            ← Back to home
          </button>
        )}
      </div>
    </div>
  );
}
