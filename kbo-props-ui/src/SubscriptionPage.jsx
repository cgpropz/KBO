import { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import './SubscriptionPage.css';

/*
 * ─── STRIPE PAYMENT LINKS ──────────────────────────────────────────
 * Replace these with your actual Stripe Payment Links.
 * Create them at https://dashboard.stripe.com/payment-links
 *
 * 1. Create products in Stripe: Weekly, Monthly, Full Season
 * 2. Generate a Payment Link for each
 * 3. Paste the URLs below
 * ────────────────────────────────────────────────────────────────────
 */
const STRIPE_LINKS = {
  monthly: 'https://buy.stripe.com/28EfZj9Wf3E26f84qY5Ne05',
  season:  'https://buy.stripe.com/eVqcN75FZdeC6f8cXu5Ne02',
};

const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    badge: null,
    description: 'Get started with basic KBO projections',
    features: [
      'Today\'s game schedule',
      'Top 3 projections',
      'Basic batter stats',
      'Landing page overview',
    ],
    limited: [
      'Full projections list',
      'Player prop cards',
      'Slip builder',
      'Matchup deep dive',
    ],
    cta: 'Current Plan',
    ctaStyle: 'free',
    link: null,
  },
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$19.99',
    period: '/ month',
    badge: 'MOST POPULAR',
    description: 'Full access — everything unlocked',
    features: [
      'All K projections',
      'All batter projections',
      'Player prop cards + hit rates',
      'Pitcher rankings & tiers',
      'Matchup deep dive',
      'Slip builder & optimizer',
      'Prop tracker + bet grading',
      'Full game log history',
    ],
    limited: [],
    cta: 'Subscribe Monthly',
    ctaStyle: 'monthly',
    link: STRIPE_LINKS.monthly,
  },
  {
    id: 'season',
    name: 'Yearly',
    price: '$49.99',
    period: '/ year',
    badge: 'BEST DEAL',
    description: 'Lock in all features for the entire 2026 season',
    features: [
      'Everything in Monthly',
      'Full 2026 season access',
      'Early access to new features',
      'Priority data updates',
      'Season-long prop history',
      'No recurring charges',
    ],
    limited: [],
    cta: 'Get Yearly',

    ctaStyle: 'season',
    link: STRIPE_LINKS.season,
  },
];

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

  const noLinksConfigured = !STRIPE_LINKS.monthly && !STRIPE_LINKS.season;

  return (
    <div className="sub-page">
      <div className="sub-header">
        <div className="sub-badge">SUBSCRIPTION PLANS</div>
        <h1 className="sub-title">
          Unlock <span className="sub-highlight">Full Access</span>
        </h1>
        <p className="sub-subtitle">
          AI-powered KBO projections, hit rates, and prop analysis — pick the plan that fits your game.
        </p>
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
            className={`sub-card ${tier.id === 'monthly' ? 'sub-card-featured' : ''} ${selectedTier === tier.id ? 'sub-card-selected' : ''}`}
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
              <strong style={{ color: '#4ade80' }}>You have {tier} access!</strong>
              <p style={{ color: '#a1a1aa' }}>All features are unlocked. Enjoy full KBO projections and tools.</p>
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

          {tier === 'monthly' && !cancelResult?.ok && (
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
            a="You get access to the landing page, today's game schedule, and a preview of the top 3 strikeout projections. Upgrade to unlock full projections, player prop cards, and advanced tools."
          />
          <FaqItem
            q="Can I cancel anytime?"
            a="Yes. Monthly subscriptions can be cancelled at any time. Your access continues until the end of your current billing period."
          />
          <FaqItem
            q="What is the Full Season plan?"
            a="A one-time payment that gives you complete access to every feature for the entire 2026 KBO season. No recurring charges — the best deal for committed bettors."
          />
          <FaqItem
            q="How often is the data updated?"
            a="Projections, prop cards, and rankings are refreshed multiple times daily — at 12 PM, 2 PM, 5 PM, and 6:30 PM EST — so you always have the latest data before games start."
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
