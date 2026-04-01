import { useState } from 'react';
import { supabase } from './supabaseClient';
import './AuthPage.css';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
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
      const { error: err } = await supabase.auth.signUp({ email, password });
      if (err) {
        setError(err.message);
      } else {
        setMessage('Check your email to confirm your account, then log in.');
        setMode('login');
      }
    }
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-k">KBO</span>
          <span className="auth-logo-divider" />
          <span className="auth-logo-sub">PROPS</span>
        </div>
        <p className="auth-tagline">AI-powered projections for Korean baseball</p>

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
      </div>
    </div>
  );
}
