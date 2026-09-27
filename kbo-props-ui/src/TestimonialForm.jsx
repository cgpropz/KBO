import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import './Testimonials.css';

const MAX_NAME = 40;
const MAX_QUOTE = 280;

async function authHeader() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Lets a logged-in subscriber submit/edit their own testimonial. New and
// edited submissions always come back in with approved=false — they only
// appear in <Testimonials /> once manually approved.
export default function TestimonialForm() {
  const { user } = useAuth();
  const [mine, setMine] = useState(undefined);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [quote, setQuote] = useState('');
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!user) {
      setMine(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeader();
        const res = await fetch('/api/testimonials', { headers });
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        setMine(body?.mine || null);
        if (body?.mine) {
          setDisplayName(body.mine.display_name || '');
          setQuote(body.mine.quote || '');
        }
      } catch {
        if (!cancelled) setMine(null);
      }
    })();
    return () => { cancelled = true };
  }, [user]);

  if (!user || mine === undefined) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const name = displayName.trim();
    const text = quote.trim();
    if (name.length < 2 || text.length < 10) {
      setStatus('error');
      setErrorMsg('Please add your name and at least a short sentence.');
      return;
    }
    setStatus('saving');
    setErrorMsg('');
    try {
      const headers = await authHeader();
      const res = await fetch('/api/testimonials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ display_name: name, quote: text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to submit');
      setMine(body.testimonial);
      setStatus('saved');
      setOpen(false);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Something went wrong. Try again.');
    }
  }

  if (!open) {
    return (
      <div className="testi-prompt">
        {mine ? (
          <p>
            {mine.approved ? 'Your testimonial is live — thanks for sharing!' : 'Thanks! Your testimonial is pending review.'}{' '}
            <button type="button" className="testi-prompt-link" onClick={() => setOpen(true)}>Edit</button>
          </p>
        ) : (
          <p>
            Enjoying cgpropz?{' '}
            <button type="button" className="testi-prompt-link" onClick={() => setOpen(true)}>Share your experience</button>{' '}
            with other subscribers.
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="testi-form" onSubmit={handleSubmit}>
      <div className="testi-form-row">
        <label htmlFor="testi-name">Your name / handle</label>
        <input
          id="testi-name"
          value={displayName}
          maxLength={MAX_NAME}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Alex R."
        />
      </div>
      <div className="testi-form-row">
        <label htmlFor="testi-quote">Your experience</label>
        <textarea
          id="testi-quote"
          value={quote}
          maxLength={MAX_QUOTE}
          onChange={(e) => setQuote(e.target.value)}
          placeholder="What's cgpropz helped you do?"
          rows={3}
        />
      </div>
      {status === 'error' && <p className="testi-form-error">{errorMsg}</p>}
      <div className="testi-form-actions">
        <button type="submit" className="testi-form-submit" disabled={status === 'saving'}>
          {status === 'saving' ? 'Submitting…' : mine ? 'Update' : 'Submit'}
        </button>
        <button type="button" className="testi-form-cancel" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="testi-form-note">Submissions are reviewed before appearing publicly.</p>
    </form>
  );
}
