import { useRef, useState } from 'react';
import { DISCORD_ONLY_NOTE, discordPlanCards } from './pricingTiers';
import { requestDiscordCheckoutUrl } from './tracking';
import { useAgeGate } from './ageGateContext';
import { sessionAccessToken } from './supabaseClient';
import './Discord.css';

// A session URL from an earlier click on this page is reused for this long.
// Stripe keeps the session open for 24h; the margin covers a tab left open.
export const DISCORD_URL_REUSE_MS = 60 * 60 * 1000;

export default function DiscordOnlyPlans({ variant = 'page', user, onCheckoutStart }) {
  const plans = discordPlanCards(import.meta.env || {});
  const { requireAge } = useAgeGate();
  // Checkout Sessions are created only from a Buy click, never on page load.
  // Loading /pricing used to open a weekly and a monthly session per visit
  // (and again on every auth refresh), so Stripe filled with expired sessions.
  const ready = useRef({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function start(plan) {
    if (busy) return;
    if (!(await requireAge())) return;
    setError('');
    const open = (url) => {
      onCheckoutStart?.();
      if (user && variant === 'page') {
        const opened = window.open(url, '_blank', 'noopener');
        if (!opened) window.location.assign(url);
        return;
      }
      window.location.assign(url);
    };
    // Keyed by account so a logout/login on this tab never reuses another
    // person's (or a guest's) session.
    const cacheKey = `${user?.id || 'guest'}:${plan}`;
    const cached = ready.current[cacheKey];
    if (cached && Date.now() - cached.at < DISCORD_URL_REUSE_MS) {
      open(cached.url);
      return;
    }
    setBusy(plan);
    try {
      let token = '';
      if (user) {
        try { token = await sessionAccessToken() || ''; } catch { /* guest checkout still works */ }
      }
      const url = await requestDiscordCheckoutUrl({ plan, token });
      ready.current[cacheKey] = { url, at: Date.now() };
      open(url);
    } catch {
      setError('Discord checkout is unavailable right now. Try again in a moment.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={variant === 'public' ? 'discord-plans discord-plans-public' : 'discord-plans'} aria-labelledby="discord-only-heading">
      <div className="discord-plans-copy">
        <h2 id="discord-only-heading">Discord Only</h2>
        <p>{DISCORD_ONLY_NOTE}</p>
      </div>
      <div className="discord-plan-grid">
        {plans.map((plan) => (
          <article key={plan.id} className="discord-plan-card">
            <h3>Discord Only · {plan.cadence}</h3>
            <p className="discord-plan-price">
              {plan.price || plan.cadence}
              {plan.period ? <span>{plan.period}</span> : null}
            </p>
            <ul>
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <p className="discord-plan-limited">Not included: {plan.limited}</p>
            <button
              type="button"
              className="discord-btn discord-btn-primary discord-plan-cta"
              disabled={busy === plan.plan}
              onClick={() => start(plan.plan)}
            >
              {busy === plan.plan ? 'Opening checkout…' : `${plan.cta}${plan.price ? ` · ${plan.price}` : ''}`}
            </button>
          </article>
        ))}
      </div>
      {error && <p className="discord-plan-error" role="alert">{error}</p>}
    </section>
  );
}
