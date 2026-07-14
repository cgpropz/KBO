import { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import './SubscriptionPage.css';

/*
 * ─── STRIPE PAYMENT LINKS ──────────────────────────────────────────
 * Live Payment Links (from the Stripe dashboard). Each maps to a tier in
 * api/_stripeTier.js so access is granted per sport:
 *   combined → both sports · kbo → KBO only · wnba → WNBA only
 * ────────────────────────────────────────────────────────────────────
 */
const STRIPE_LINKS = {
  combined:    'https://buy.stripe.com/6oU5kFfgzdeCfPIcXu5Ne09', // KBO + WNBA   $29.99 / mo
  kboMonthly:  'https://buy.stripe.com/28EfZj9Wf3E26f84qY5Ne05', // KBO Monthly  $19.99 / mo
  kboSeason:   'https://buy.stripe.com/eVqcN75FZdeC6f8cXu5Ne02', // KBO Season   $49.99 / yr
  kboWeekly:   'https://buy.stripe.com/00wcN7gkD7Ui8ng6z65Ne08', // KBO Weekly   $9.99  / wk
  kboLifetime: 'https://buy.stripe.com/dRmeVfd8r3E2avo4qY5Ne03', // KBO Lifetime $99.99 once
  wnbaMonthly: 'https://buy.stripe.com/dRm4gBc4n2zY0UO6z65Ne07', // WNBA Monthly $19.99 / mo
  wnbaWeekly:  'https://buy.stripe.com/fZudRb2tN7UibzsbTq5Ne06', // WNBA Weekly  $9.99  / wk
};

const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    badge: null,
    description: 'Preview both sports before you commit',
    features: [
      'Today\'s KBO & WNBA schedules',
      'Top 3 KBO projections',
      'WNBA dashboard & team pages',
      'Landing page overview',
    ],
    limited: [
      'Full KBO + WNBA projections',
      'Player prop cards & PrizePicks edge',
      'Slip builder & optimizer',
      'Matchups, lineups & tracker',
    ],
    cta: 'Current Plan',
    ctaStyle: 'free',
    link: null,
  },
  {
    id: 'combined',
    name: '⚾🏀 All Access',
    price: '$29.99',
    period: '/ month',
    badge: 'BEST VALUE',
    description: 'Everything unlocked — KBO + WNBA',
    features: [
      '⚾ All KBO pitcher & batter projections',
      '⚾ Prop cards, rankings & matchup deep dive',
      '🏀 WNBA PrizePicks edge board',
      '🏀 Points / reb / ast projections',
      '🏀 Defense vs position & daily lineups',
      'Slip builder, optimizer & prop tracker',
      'Full game log history for both sports',
      'Save $10/mo vs. buying each sport',
    ],
    limited: [],
    cta: 'Get All Access',
    ctaStyle: 'combined',
    link: STRIPE_LINKS.combined,
  },
  {
    id: 'kboMonthly',
    name: '⚾ KBO Monthly',
    price: '$19.99',
    period: '/ month',
    badge: null,
    description: 'Full KBO toolkit',
    features: [
      'All KBO pitcher & batter projections',
      'Player prop cards + hit rates',
      'Pitcher rankings & matchup deep dive',
      'Slip builder, optimizer & tracker',
      'Full KBO game log history',
    ],
    limited: ['WNBA projections & edge board'],
    cta: 'Subscribe to KBO',
    ctaStyle: 'kbo',
    link: STRIPE_LINKS.kboMonthly,
  },
  {
    id: 'wnbaMonthly',
    name: '🏀 WNBA Monthly',
    price: '$19.99',
    period: '/ month',
    badge: null,
    description: 'Full WNBA toolkit',
    features: [
      'WNBA PrizePicks edge board',
      'Points / reb / ast projections',
      'Defense vs position matchups',
      'Daily lineups & starters',
      'Full WNBA prop history',
    ],
    limited: ['KBO projections & prop cards'],
    cta: 'Subscribe to WNBA',
    ctaStyle: 'wnba',
    link: STRIPE_LINKS.wnbaMonthly,
  },
  {
    id: 'kboSeason',
    name: '⚾ KBO Full Season',
    price: '$49.99',
    period: '/ year',
    badge: 'SAVE 79%',
    description: 'Lock in KBO for the whole year',
    features: [
      'Everything in KBO Monthly',
      'All season long — no monthly charges',
      'Season-long prop history',
      'Priority data updates',
    ],
    limited: [],
    cta: 'Get KBO Season',
    ctaStyle: 'season',
    link: STRIPE_LINKS.kboSeason,
  },
  {
    id: 'kboWeekly',
    name: '⚾ KBO Weekly',
    price: '$9.99',
    period: '/ week',
    badge: null,
    description: 'Try KBO week to week',
    features: [
      'Full KBO projections & prop cards',
      'Pitcher rankings & matchups',
      'Slip builder, optimizer & tracker',
      'Cancel anytime',
    ],
    limited: ['WNBA projections & edge board'],
    cta: 'Start KBO Weekly',
    ctaStyle: 'kbo',
    link: STRIPE_LINKS.kboWeekly,
  },
  {
    id: 'wnbaWeekly',
    name: '🏀 WNBA Weekly',
    price: '$9.99',
    period: '/ week',
    badge: null,
    description: 'Try WNBA week to week',
    features: [
      'WNBA PrizePicks edge board',
      'Points / reb / ast projections',
      'Defense vs position & lineups',
      'Cancel anytime',
    ],
    limited: ['KBO projections & prop cards'],
    cta: 'Start WNBA Weekly',
    ctaStyle: 'wnba',
    link: STRIPE_LINKS.wnbaWeekly,
  },
  {
    id: 'kboLifetime',
    name: '⚾ KBO Lifetime',
    price: '$99.99',
    period: 'once',
    badge: 'ONE-TIME',
    description: 'Pay once, keep KBO forever',
    features: [
      'Everything in KBO Season',
      'Lifetime access — no renewals ever',
      'All future KBO features included',
    ],
    limited: ['WNBA projections & edge board'],
    cta: 'Buy KBO Lifetime',
    ctaStyle: 'season',
    link: STRIPE_LINKS.kboLifetime,
  },
];

// Human-readable label for the user's current tier (used in the active banner).
const TIER_LABELS = {
  combined: 'All Access', all: 'All Access', monthly: 'All Access', season: 'All Access',
  weekly: 'All Access', pro: 'All Access', owner: 'All Access',
  kbo: 'KBO', wnba: 'WNBA',
};

// Tiers that represent an active, cancellable subscription (excludes one-time
// lifetime and free). Grandfathered all-access tiers remain cancellable.
const CANCELLABLE_TIERS = new Set(['combined', 'kbo', 'wnba', 'monthly', 'season', 'weekly', 'pro', 'all']);

function SubscriptionPage() {
  const [selectedTier, setSelectedTier] = useState(null);
  const { user, tier, refreshTier } = useAuth();
  const pollRef = useRef(null);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelResult, setCancelResult] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // After user clicks a payment link, poll for tier upgrade every 4s for up to 2 min
  useEffect(() => {
    if (!awaitingPayment) return;
    const start = Date.now();
    pollRef.current = setInterval(async () => {
      await refreshTier();
      if (Date.now() - start > 120_000) {
        clearInterval(pollRef.current);
        setAwaitingPayment(false);
      }
    }, 4000);
    return () => clearInterval(pollRef.current);
  }, [awaitingPayment, refreshTier]);

  // Stop polling once tier becomes paid
  useEffect(() => {
    if (tier && tier !== 'free' && awaitingPayment) {
      clearInterval(pollRef.current);
      setAwaitingPayment(false);
    }
  }, [tier, awaitingPayment]);

  const handleSubscribe = (tier) => {
    if (!tier.link) return;
    // Pass Supabase user ID + prefill email so Stripe webhook can match the payment
    const url = new URL(tier.link);
    if (user?.id) url.searchParams.set('client_reference_id', user.id);
    if (user?.email) url.searchParams.set('prefilled_email', user.email);
    window.open(url.toString(), '_blank', 'noopener');
    setAwaitingPayment(true);
  };

  const handleCancel = async () => {
    setCancelling(true);
    setCancelResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setCancelResult({ ok: false, message: 'Please sign in again to cancel.' });
        return;
      }
      const resp = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        const endDate = data.access_until
          ? new Date(data.access_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : 'the end of your billing period';
        setCancelResult({ ok: true, message: `Your subscription has been cancelled. You'll keep full access until ${endDate}.` });
      } else {
        setCancelResult({ ok: false, message: data.error || 'Failed to cancel subscription.' });
      }
    } catch {
      setCancelResult({ ok: false, message: 'Network error — please try again.' });
    } finally {
      setCancelling(false);
      setShowCancelConfirm(false);
    }
  };

  const noLinksConfigured = !STRIPE_LINKS.combined;

  return (
    <div className="sub-page">
      <div className="sub-header">
        <div className="sub-badge">SUBSCRIPTION PLANS</div>
        <h1 className="sub-title">
          Unlock <span className="sub-highlight">All Access</span>
        </h1>
        <p className="sub-subtitle">
          Go all-in with ⚾ KBO and 🏀 WNBA, or pick a single sport. Every plan unlocks
          full projections, hit rates, prop cards, and edge boards for what you choose.
        </p>
      </div>

      <div className="sub-combine-banner">
        <span className="sub-combine-icon">⚾🏀</span>
        <span>Want both sports? <strong>All Access is $29.99/mo</strong> — $10 less than buying KBO and WNBA separately.</span>
      </div>

      {noLinksConfigured && (
        <div className="sub-setup-notice">
          <span className="sub-setup-icon">⚙️</span>
          <div>
            <strong>Setup Required</strong>
            <p>Configure your Stripe Payment Links in <code>SubscriptionPage.jsx</code> to enable checkout.</p>
          </div>
        </div>
      )}

      <div className="sub-grid">
        {TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`sub-card ${tier.id === 'combined' ? 'sub-card-featured' : ''} ${selectedTier === tier.id ? 'sub-card-selected' : ''}`}
            onClick={() => setSelectedTier(tier.id)}
          >
            {tier.badge && <div className="sub-card-badge">{tier.badge}</div>}
            <div className="sub-card-header">
              <h3 className="sub-card-name">{tier.name}</h3>
              <div className="sub-card-price">
                <span className="sub-price-amount">{tier.price}</span>
                {tier.period && <span className="sub-price-period">{tier.period}</span>}
              </div>
              <p className="sub-card-desc">{tier.description}</p>
            </div>

            <div className="sub-card-features">
              {tier.features.map((f, i) => (
                <div key={i} className="sub-feature">
                  <span className="sub-feature-icon sub-check">✓</span>
                  <span>{f}</span>
                </div>
              ))}
              {tier.limited.map((f, i) => (
                <div key={`l-${i}`} className="sub-feature sub-feature-locked">
                  <span className="sub-feature-icon sub-lock">✕</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <button
              className={`sub-cta sub-cta-${tier.ctaStyle}`}
              onClick={(e) => {
                e.stopPropagation();
                handleSubscribe(tier);
              }}
              disabled={tier.id === 'free' || (!tier.link && tier.id !== 'free')}
            >
              {tier.cta}
            </button>
          </div>
        ))}
      </div>

      {awaitingPayment && (
        <div className="sub-setup-notice" style={{ borderColor: '#22c55e40', background: '#22c55e10' }}>
          <span className="sub-setup-icon">⏳</span>
          <div>
            <strong style={{ color: '#4ade80' }}>Waiting for payment confirmation...</strong>
            <p style={{ color: '#a1a1aa' }}>Complete checkout in the Stripe tab. Your access will unlock automatically.</p>
          </div>
        </div>
      )}

      {tier && tier !== 'free' && (
        <div className="sub-active-section">
          <div className="sub-setup-notice" style={{ borderColor: '#22c55e40', background: '#22c55e10' }}>
            <span className="sub-setup-icon">✅</span>
            <div>
              <strong style={{ color: '#4ade80' }}>You have {TIER_LABELS[tier] || tier} access!</strong>
              <p style={{ color: '#a1a1aa' }}>{
                (TIER_LABELS[tier] === 'All Access')
                  ? 'All features are unlocked across ⚾ KBO and 🏀 WNBA. Enjoy the full toolkit.'
                  : `Your ${TIER_LABELS[tier] || tier} tools are fully unlocked. Add All Access anytime to include the other sport.`
              }</p>
            </div>
          </div>

          {cancelResult && (
            <div className="sub-setup-notice" style={{
              borderColor: cancelResult.ok ? '#22c55e40' : '#ef444440',
              background: cancelResult.ok ? '#22c55e10' : '#ef444410',
              marginTop: '0.75rem',
            }}>
              <span className="sub-setup-icon">{cancelResult.ok ? '✓' : '✕'}</span>
              <div>
                <p style={{ color: cancelResult.ok ? '#4ade80' : '#f87171', margin: 0 }}>{cancelResult.message}</p>
              </div>
            </div>
          )}

          {CANCELLABLE_TIERS.has(tier) && !cancelResult?.ok && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              {!showCancelConfirm ? (
                <button
                  className="sub-cancel-btn"
                  onClick={() => setShowCancelConfirm(true)}
                >
                  Cancel Subscription
                </button>
              ) : (
                <div className="sub-cancel-confirm">
                  <p style={{ color: '#a1a1aa', marginBottom: '0.75rem' }}>
                    Are you sure? You'll keep access until the end of your current billing period.
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <button
                      className="sub-cancel-btn sub-cancel-btn-danger"
                      onClick={handleCancel}
                      disabled={cancelling}
                    >
                      {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
                    </button>
                    <button
                      className="sub-cancel-btn sub-cancel-btn-back"
                      onClick={() => setShowCancelConfirm(false)}
                      disabled={cancelling}
                    >
                      Keep Subscription
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="sub-faq">
        <h2 className="sub-faq-title">Frequently Asked Questions</h2>
        <div className="sub-faq-grid">
          <FaqItem
            q="What's included in the free tier?"
            a="You get the landing page, today's KBO & WNBA schedules, a preview of the top 3 KBO projections, and the WNBA dashboard and team pages. Upgrade to unlock full projections, prop cards, and the PrizePicks edge board for both sports."
          />
          <FaqItem
            q="Does one subscription cover both sports?"
            a="The All Access plan ($29.99/mo) unlocks every KBO and WNBA tool under one login. Single-sport plans (KBO or WNBA) unlock just that sport — you can upgrade to All Access anytime to add the other."
          />
          <FaqItem
            q="Can I cancel anytime?"
            a="Yes. Monthly subscriptions can be cancelled at any time. Your access continues until the end of your current billing period."
          />
          <FaqItem
            q="How often is the data updated?"
            a="KBO projections and props refresh multiple times daily before games. WNBA projections, edge, and lineups refresh on their own schedule ahead of tip-off, so you always have the latest numbers."
          />
        </div>
      </div>
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`sub-faq-item ${open ? 'sub-faq-open' : ''}`} onClick={() => setOpen(!open)}>
      <div className="sub-faq-q">
        <span>{q}</span>
        <span className="sub-faq-toggle">{open ? '−' : '+'}</span>
      </div>
      {open && <div className="sub-faq-a">{a}</div>}
    </div>
  );
}

export default SubscriptionPage;
