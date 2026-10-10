import { useEffect, useState } from 'react';
import { DISCORD_ONLY_NOTE, discordPlanCards } from './pricingTiers';
import { requestDiscordCheckoutUrl } from './tracking';
import { supabase } from './supabaseClient';
import './Discord.css';

export default function DiscordOnlyPlans({ variant = 'page', user, onCheckoutStart }) {
  const plans = discordPlanCards(import.meta.env || {});
  const [hrefs, setHrefs] = useState({ weekly: '', monthly: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token = '';
      if (user && supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          token = session?.access_token || '';
        } catch { /* guest checkout still works */ }
      }
      for (const plan of ['weekly', 'monthly']) {
        try {
          const url = await requestDiscordCheckoutUrl({ plan, token });
          if (!cancelled) setHrefs((prev) => ({ ...prev, [plan]: url }));
        } catch { /* the click retries */ }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function start(plan) {
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
    const ready = hrefs[plan];
    if (ready) {
      open(ready);
      return;
    }
    try {
      let token = '';
      if (user && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token || '';
      }
      const url = await requestDiscordCheckoutUrl({ plan, token });
      setHrefs((prev) => ({ ...prev, [plan]: url }));
      open(url);
    } catch {
      setError('Discord checkout is unavailable right now. Try again in a moment.');
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
            {hrefs[plan.plan] ? (
              <a
                className="discord-btn discord-btn-primary discord-plan-cta"
                href={hrefs[plan.plan]}
                target={user && variant === 'page' ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={() => onCheckoutStart?.()}
              >
                {plan.cta}{plan.price ? ` · ${plan.price}` : ''}
              </a>
            ) : (
              <button type="button" className="discord-btn discord-btn-primary discord-plan-cta" onClick={() => start(plan.plan)}>
                {plan.cta}
              </button>
            )}
          </article>
        ))}
      </div>
      {error && <p className="discord-plan-error" role="alert">{error}</p>}
    </section>
  );
}
