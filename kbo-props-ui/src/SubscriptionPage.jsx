import { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import { STRIPE_LINKS, TIERS } from './pricingTiers';
import { buildCheckoutUrl, prefetchWeeklyCheckoutUrl } from './tracking';
import './SubscriptionPage.css';
import './FreeFunnel.css';

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

  // Stop polling once tier becomes paid.
  // The X purchase event is NOT fired here any more: it fires once, with the
  // real amount and conversion_id = Stripe session id, on the checkout-success
  // screen (CheckoutSuccess.jsx) and server-side from api/stripe-webhook.js.
  useEffect(() => {
    if (tier && tier !== 'free' && awaitingPayment) {
      clearInterval(pollRef.current);
      setAwaitingPayment(false);
    }
  }, [tier, awaitingPayment]);

  // Weekly href is the Payment Link until the Checkout Session is ready, so the
  // click always navigates in this gesture. The session applies XWEEK when the
  // code is valid and otherwise charges the full weekly price.
  const [weeklyHref, setWeeklyHref] = useState(() => buildCheckoutUrl(STRIPE_LINKS.weekly, null));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token = '';
      if (user) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          token = session?.access_token || '';
        } catch { /* guest checkout still works */ }
      }
      if (!cancelled) setWeeklyHref(buildCheckoutUrl(STRIPE_LINKS.weekly, user));
      try {
        const url = await prefetchWeeklyCheckoutUrl(token ? { token } : {});
        if (!cancelled && url) setWeeklyHref(url);
      } catch { /* keep the payment link */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleSubscribe = (plan) => {
    if (!plan.link) return;
    // Logged in: pass Supabase user ID + prefill email so the webhook links the
    // payment instantly. Logged out: Stripe collects the email and access is
    // matched to it when they sign up (webhook + /api/sync-subscription).
    // Every plan navigates in this click. Weekly uses the prefetched session
    // when it is ready, otherwise the weekly Payment Link.
    const url = plan.id === 'weekly' ? weeklyHref : buildCheckoutUrl(plan.link, user);
    if (!user) {
      window.location.assign(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
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

  const noLinksConfigured = !STRIPE_LINKS.monthly;

  return (
    <div className="sub-page">
      <div className="sub-header">
        <div className="sub-badge">SUBSCRIPTION PLANS</div>
        <h1 className="sub-title">
          Unlock <span className="sub-highlight">All Access</span>
        </h1>
        <p className="sub-subtitle">
          Every plan is All-Access — ⚾ KBO, 🏀 WNBA, and 🏈 NFL, full projections, hit rates,
          prop cards, and edge boards included. Just pick the billing cadence that fits you.
        </p>
      </div>

      <div className="sub-combine-banner">
        <span className="sub-combine-icon">⚾🏀🏈</span>
        <span>Every plan unlocks <strong>all three sports</strong> — choose weekly, monthly, or lifetime billing.</span>
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
            className={`sub-card ${tier.featured ? 'sub-card-featured' : ''} ${selectedTier === tier.id ? 'sub-card-selected' : ''}`}
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
              {tier.id === 'free' && !user ? 'Free with an account' : tier.cta}
            </button>
          </div>
        ))}
      </div>

      {!user && (
        <p className="ff-checkout-note" style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 1.5rem' }}>
          No account yet? You can check out now. Afterwards, sign up (or log in) with the
          <strong> same email you used at checkout</strong> and your plan unlocks automatically.
        </p>
      )}

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
            a="You get the landing page, today's KBO & WNBA schedules, and a preview of the top 3 lines on the KBO, WNBA & NFL boards. Upgrade to unlock full projections, prop cards, and the PrizePicks edge board for every sport."
          />
          <FaqItem
            q="Does one subscription cover both sports?"
            a="Yes — every plan (Weekly, Monthly, or Lifetime) unlocks KBO, WNBA, and NFL under one login. There are no more single-sport plans."
          />
          <FaqItem
            q="Can I cancel anytime?"
            a="Yes. Weekly and Monthly subscriptions can be cancelled at any time, and your access continues until the end of your current billing period. Lifetime is a one-time purchase with nothing to cancel."
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
