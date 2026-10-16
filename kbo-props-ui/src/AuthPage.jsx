import { useState } from 'react';
import { loadSupabase } from './supabaseClient';
import { getAttribution } from './tracking';
import { readAgeConfirmation } from './ageConfirmation';
import { useAgeGate } from './ageGateContext';
import { authErrorMessage } from './authErrors';
import { recoveryRedirectUrl } from './passwordRecovery';
import './AuthPage.css';

export default function AuthPage({ initialMode = 'login', onBack, notice = '' } = {}) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { requireAge } = useAgeGate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    const supabase = await loadSupabase();
    if (!supabase) {
      setError('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.');
      setLoading(false);
      return;
    }

    if (mode === 'reset') {
      // Supabase Auth sends this mail. This app does not. Custom SMTP is a
      // project setting (smtp.resend.com:465, username resend), not app code.
      // redirectTo is this page's origin plus /set-password. The Supabase
      // Site URL is http://localhost:3000, so a missing redirectTo sends
      // every recovery link there instead of the live site.
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: recoveryRedirectUrl(window.location.origin),
      });
      if (err) setError(authErrorMessage(err));
      else setMessage('Password reset email sent! Check your inbox.');
      setLoading(false);
      return;
    }

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) setError(authErrorMessage(err));
    } else {
      const allowed = await requireAge();
      if (!allowed) {
        setLoading(false);
        return;
      }
      // Keep marketing attribution (utm_* / twclid captured on landing) and the
      // saved 21+ confirmation time with the new account as Supabase user metadata.
      const attribution = getAttribution();
      const ageConfirmedAt = readAgeConfirmation()?.confirmedAt;
      const data = {};
      if (Object.keys(attribution).length) data.attribution = attribution;
      if (ageConfirmedAt) data.age_confirmed_at = ageConfirmedAt;
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        ...(Object.keys(data).length ? { options: { data } } : {}),
      });
      if (err) {
        setError(authErrorMessage(err));
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

        {notice ? <p className="auth-notice">{notice}</p> : null}

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'auth-tab-active' : ''}`}
            onClick={() => { setMode('login'); setError(''); setMessage(''); }}
          >
            Log In
          </button>
          <button
            className={`auth-tab ${mode === 'signup' ? 'auth-tab-active' : ''}`}
            onClick={async () => {
              const allowed = await requireAge();
              if (!allowed) return;
              setMode('signup');
              setError('');
              setMessage('');
            }}
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

          {error && <div className="auth-error" data-testid="auth-error">{error}</div>}
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
            <p>No account? <button className="auth-link" onClick={async () => {
              const allowed = await requireAge();
              if (!allowed) return;
              setMode('signup');
            }}>Sign up free</button></p>
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
