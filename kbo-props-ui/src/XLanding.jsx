import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import FreePicksPreview from './FreePicksPreview';
import { STRIPE_LINKS } from './pricingTiers';
import { OPERATOR_DISCLAIMER, STANDARD_LINE } from './responsibleGambling';
import { sessionAccessToken } from './supabaseClient';
import {
  campaignCheckoutHref,
  campaignUtm,
  prefetchWeeklyCheckoutUrl,
} from './tracking';
import './XLanding.css';

export const X_CHECKOUT_CTA = 'Unlock full boards: first week $4.99 with code XWEEK (auto-fills at checkout), then $9.99/wk, cancel anytime';

export default function XLanding({ onLogin, onSignUp, onOpenBoard }) {
  const { user } = useAuth();
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const [href, setHref] = useState(() => campaignCheckoutHref({
    link: STRIPE_LINKS.weekly,
    user: user || null,
    search,
  }));

  useEffect(() => {
    let cancelled = false;
    const utm = campaignUtm(search);
    (async () => {
      let token = '';
      if (user) {
        try { token = await sessionAccessToken() || ''; } catch { /* guest checkout still works */ }
      }
      if (!cancelled) {
        setHref(campaignCheckoutHref({ link: STRIPE_LINKS.weekly, user: user || null, search }));
      }
      try {
        const url = await prefetchWeeklyCheckoutUrl(token ? { token, utm } : { utm });
        if (!cancelled && url) {
          setHref(campaignCheckoutHref({ link: STRIPE_LINKS.weekly, user: user || null, search, sessionUrl: url }));
        }
      } catch { /* weekly Payment Link fallback is already on the href */ }
    })();
    return () => { cancelled = true; };
  }, [user, search]);

  const showCheckout = () => {
    document.getElementById('x-checkout')?.scrollIntoView();
    document.getElementById('x-checkout')?.focus();
  };

  return (
    <div className="x-landing">
      <header className="x-header">
        <a className="x-wordmark" href="/">cg<span>propz</span></a>
        {user ? (
          <button type="button" className="x-login" onClick={() => onOpenBoard?.('nfl')}>Boards</button>
        ) : (
          <button type="button" className="x-login" onClick={onLogin}>Log in</button>
        )}
      </header>
      <main className="x-main">
        <p className="x-kicker">Free on CGPropz</p>
        <h1>Today's free top 3</h1>
        <p className="x-lead">Three props from today's board. CG Score, hit rates and projections are on the same boards.</p>
        <FreePicksPreview
          onSignUp={onSignUp}
          onOpenBoard={onOpenBoard}
          onSeePlans={showCheckout}
          showActions={false}
        />
        <a id="x-checkout" className="x-cta" href={href}>{X_CHECKOUT_CTA}</a>
        <p className="x-rg">{STANDARD_LINE}</p>
        <ul className="x-tools">
          <li>CG Score on every standard line</li>
          <li>Hit rates and game logs</li>
          <li>Defense vs position and daily lineups</li>
        </ul>
      </main>
      <footer className="x-footer">
        <p>{STANDARD_LINE}</p>
        <p>{OPERATOR_DISCLAIMER}</p>
        <p className="x-footer-links">
          <a href="/pricing">Pricing</a>
          <a href="/responsible-gaming">Responsible gaming</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </p>
      </footer>
    </div>
  );
}
