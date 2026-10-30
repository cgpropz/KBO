import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { sessionAccessToken } from './supabaseClient';
import { freeTierFaqAnswer } from './freePreviewCopy';
import { STRIPE_LINKS, TIERS } from './pricingTiers';
import { buildCheckoutUrl, openWeeklyCheckoutUrl, requestOfferCheckoutUrl } from './tracking';
import { trackCheckoutClick } from './analytics';
import { useAgeGate } from './ageGateContext';
import AutoRenewalNote from './AutoRenewalNote';
import { PAUSE_WEEK_ENABLED, PAUSE_WEEK_MS, pauseTokenFromSearch } from './pauseWindow';
import { noActivePlanNotice } from './manageSubscriptionCopy';
import FoundersOffer from './FoundersOffer';
import DiscordAccount from './DiscordAccount';
import DiscordOnlyPlans from './DiscordOnlyPlans';
import './SubscriptionPage.css';
import './FreeFunnel.css';

// Human-readable label for the user's current tier (used in the active banner).
const TIER_LABELS = {
  combined: 'All Access', all: 'All Access', monthly: 'All Access', season: 'All Access',
  weekly: 'All Access', pro: 'All Access', owner: 'All Access',
  kbo: 'KBO', wnba: 'WNBA', discord: 'Discord Only',
};

// Tiers that represent an active, cancellable subscription (excludes one-time
// lifetime and free). Grandfathered all-access tiers remain cancellable.
const CANCELLABLE_TIERS = new Set(['combined', 'kbo', 'wnba', 'monthly', 'season', 'weekly', 'pro', 'all', 'discord']);

function formatMemberDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'the scheduled date';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

async function membershipAuthToken(user) {
  const token = await sessionAccessToken();
  if (token) return token;
  // Local screenshots only. Production builds set DEV to false.
  if (import.meta.env.DEV && user?.id === 'dev-tier-preview') return 'dev-preview';
  return null;
}

function SubscriptionPage() {
  const [selectedTier, setSelectedTier] = useState(null);
  const { user, tier, refreshTier } = useAuth();
  const { requireAge } = useAgeGate();
  const pollRef = useRef(null);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelResult, setCancelResult] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [pauseResult, setPauseResult] = useState(null);
  const [paused, setPaused] = useState(null);
  const [portalFlow, setPortalFlow] = useState('');
  const [portalMessage, setPortalMessage] = useState(null);

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

  useEffect(() => {
    const onCheckout = () => setAwaitingPayment(true);
    window.addEventListener('cg-stripe-checkout', onCheckout);
    return () => window.removeEventListener('cg-stripe-checkout', onCheckout);
  }, []);

  // Weekly Checkout Sessions are created from this click, not when /pricing
  // renders. The session applies XWEEK when the code is valid and otherwise
  // charges the full weekly price. A second click reuses that URL.
  const [weeklyBusy, setWeeklyBusy] = useState(false);

  const [offerBusy, setOfferBusy] = useState(false);
  const openOfferCheckout = async (plan) => {
    if (offerBusy) return;
    if (!(await requireAge())) return;
    trackCheckoutClick(plan);
    setOfferBusy(true);
    try {
      let token = '';
      if (user) {
        try { token = await sessionAccessToken() || ''; } catch { /* guest checkout still works */ }
      }
      const result = await requestOfferCheckoutUrl(token ? { plan, token } : { plan });
      if (!user) {
        window.location.assign(result.url);
        return;
      }
      window.open(result.url, '_blank', 'noopener');
      setAwaitingPayment(true);
    } catch (err) {
      if (err?.reason === 'sold_out' || err?.reason === 'expired') throw err;
    } finally {
      setOfferBusy(false);
    }
  };

  const handleSubscribe = async (plan) => {
    if (plan.id === 'weekly') {
      if (weeklyBusy) return;
      if (!(await requireAge())) return;
      trackCheckoutClick('weekly');
      setWeeklyBusy(true);
      try {
        let token = '';
        if (user) {
          try { token = await sessionAccessToken() || ''; } catch { /* guest checkout still works */ }
        }
        const url = await openWeeklyCheckoutUrl(token ? { token } : {});
        if (!user) {
          window.location.assign(url);
          return;
        }
        const opened = window.open(url, '_blank', 'noopener');
        if (!opened) window.location.assign(url);
        else setAwaitingPayment(true);
      } catch {
        // Same weekly plan, full price, no promo param. Payment Links reject XWEEK.
        const url = buildCheckoutUrl(STRIPE_LINKS.weekly, user);
        if (!user) {
          window.location.assign(url);
          return;
        }
        const opened = window.open(url, '_blank', 'noopener');
        if (!opened) window.location.assign(url);
        else setAwaitingPayment(true);
      } finally {
        setWeeklyBusy(false);
      }
      return;
    }
    if (!(await requireAge())) return;
    if (plan.checkout === 'session') {
      openOfferCheckout('lifetime');
      return;
    }
    if (!plan.link) return;
    trackCheckoutClick(plan.id);
    // Logged in: pass Supabase user ID + prefill email so the webhook links the
    // payment instantly. Logged out: Stripe collects the email and access is
    // matched to it when they sign up (webhook + /api/sync-subscription).
    // Monthly and yearly stay on their Payment Links. No Checkout Session.
    const url = buildCheckoutUrl(plan.link, user);
    if (!user) {
      window.location.assign(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
    setAwaitingPayment(true);
  };

  const requestMembership = useCallback(async (payload) => {
    const token = await membershipAuthToken(user);
    if (!token) return { ok: false, data: { error: 'Please sign in again.' } };
    const resp = await fetch('/api/cancel-subscription', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, data };
  }, [user]);

  const applyPauseResult = useCallback((result) => {
    if (result.ok && result.data?.paused && result.data.resumes_at) {
      const resumeDate = formatMemberDate(result.data.resumes_at);
      setPaused({ resumes_at: result.data.resumes_at });
      setPauseResult({
        ok: true,
        message: `Billing is paused. It resumes automatically on ${resumeDate}. You keep full access while it is paused.`,
      });
      setShowPauseConfirm(false);
      setShowCancelConfirm(false);
      return;
    }
    setPauseResult({ ok: false, message: result.data?.error || 'Failed to pause subscription.' });
  }, []);

  useEffect(() => {
    if (!PAUSE_WEEK_ENABLED || !user || !CANCELLABLE_TIERS.has(tier)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const result = await requestMembership({ action: 'status' });
        if (cancelled || !result.ok || !result.data?.paused || !result.data.resumes_at) return;
        setPaused({ resumes_at: result.data.resumes_at });
      } catch { /* status is optional; cancel still works */ }
    })();
    return () => { cancelled = true; };
  }, [user, tier, requestMembership]);

  useEffect(() => {
    if (!PAUSE_WEEK_ENABLED || !user || typeof window === 'undefined') return undefined;
    const fromUrl = pauseTokenFromSearch(window.location.search);
    let linkToken = fromUrl;
    try {
      linkToken = fromUrl || sessionStorage.getItem('cg_pause_link') || '';
      if (fromUrl) sessionStorage.setItem('cg_pause_link', fromUrl);
    } catch { /* private mode still pauses from the URL once */ }
    if (!linkToken) return undefined;
    if (fromUrl) {
      const url = new URL(window.location.href);
      url.searchParams.delete('pause');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    let cancelled = false;
    (async () => {
      setPausing(true);
      setPauseResult(null);
      try {
        const result = await requestMembership({ action: 'pause', token: linkToken });
        if (cancelled) return;
        try { sessionStorage.removeItem('cg_pause_link'); } catch { /* ignore */ }
        applyPauseResult(result);
      } catch {
        if (!cancelled) setPauseResult({ ok: false, message: 'Network error — please try again.' });
      } finally {
        if (!cancelled) setPausing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, requestMembership, applyPauseResult]);

  const handleCancel = async () => {
    setCancelling(true);
    setCancelResult(null);
    try {
      const token = await membershipAuthToken(user);
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

  const openBillingPortal = async (flow) => {
    if (portalFlow) return;
    setPortalFlow(flow || 'manage');
    setPortalMessage(null);
    try {
      const token = await membershipAuthToken(user);
      if (!token) {
        setPortalMessage('Please sign in again.');
        return;
      }
      // The server reads the email from this session and creates a one-time
      // billing portal session. Do not send an email, a Stripe customer id,
      // or a portal URL. payment_method_update opens on the card form.
      const resp = await fetch('/api/billing-portal', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: flow === 'payment_method_update'
          ? JSON.stringify({ flow: 'payment_method_update' })
          : '{}',
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 404) {
        setPortalMessage(noActivePlanNotice(user?.email));
        return;
      }
      if (!resp.ok || !data.url) {
        setPortalMessage(data.error || 'Could not open billing.');
        return;
      }
      let destination;
      try { destination = new URL(data.url); } catch { destination = null; }
      if (!destination || destination.protocol !== 'https:') {
        setPortalMessage('Could not open billing.');
        return;
      }
      window.location.assign(destination.toString());
    } catch {
      setPortalMessage('Network error — please try again.');
    } finally {
      setPortalFlow('');
    }
  };

  const handlePause = async () => {
    setPausing(true);
    setPauseResult(null);
    try {
      applyPauseResult(await requestMembership({ action: 'pause' }));
    } catch {
      setPauseResult({ ok: false, message: 'Network error — please try again.' });
    } finally {
      setPausing(false);
    }
  };

  const previewResumeDate = formatMemberDate(new Date(Date.now() + PAUSE_WEEK_MS));

  const noLinksConfigured = !STRIPE_LINKS.monthly;

  return (
    <div className="sub-page">
      <div className="sub-header">
        <div className="sub-badge">SUBSCRIPTION PLANS</div>
        <h1 className="sub-title">
          Unlock <span className="sub-highlight">All Access</span>
        </h1>
        <p className="sub-subtitle">
          All-Access plans cover ⚾ KBO, 🏀 WNBA, and 🏈 NFL — full projections, hit rates,
          prop cards, and edge boards. Pick the billing cadence that fits you. Discord Only
          is a separate, cheaper option and does not unlock the site.
        </p>
      </div>

      <section className="sub-manage" aria-label="Manage billing">
        <h2 className="sub-manage-title">Billing</h2>
        {user ? (
          <>
            <p className="sub-manage-copy">Update the card on file or manage the subscription. This opens a one-time Stripe billing page for the signed-in account.</p>
            <div className="sub-manage-actions">
              <button
                type="button"
                className="sub-manage-btn"
                data-testid="update-payment-method"
                onClick={() => openBillingPortal('payment_method_update')}
                disabled={Boolean(portalFlow)}
              >
                {portalFlow === 'payment_method_update' ? 'Opening billing…' : 'Update payment method'}
              </button>
              <button
                type="button"
                className="sub-manage-btn sub-manage-btn-secondary"
                data-testid="manage-subscription"
                onClick={() => openBillingPortal()}
                disabled={Boolean(portalFlow)}
              >
                {portalFlow === 'manage' ? 'Opening billing…' : 'Manage subscription'}
              </button>
            </div>
          </>
        ) : (
          <p className="sub-manage-copy">Sign in to update your payment method or manage billing.</p>
        )}
        {portalMessage && (
          <p className="sub-manage-msg" role="status" data-testid="manage-subscription-message">{portalMessage}</p>
        )}
      </section>

      <div className="sub-combine-banner">
        <span className="sub-combine-icon">⚾🏀🏈🏒</span>
        <span>Every All-Access plan unlocks <strong>KBO, WNBA, NFL, NBA, and NHL</strong> — weekly, monthly, yearly, or lifetime.</span>
      </div>

      {user && <DiscordAccount />}

      {noLinksConfigured && (
        <div className="sub-setup-notice">
          <span className="sub-setup-icon">⚙️</span>
          <div>
            <strong>Setup Required</strong>
            <p>Configure your Stripe Payment Links in <code>SubscriptionPage.jsx</code> to enable checkout.</p>
          </div>
        </div>
      )}

      <AutoRenewalNote />

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
                <span className="sub-price-amount">{tier.leadPrice || tier.price}</span>
                {(tier.leadPeriod || tier.period) && <span className="sub-price-period">{tier.leadPeriod || tier.period}</span>}
              </div>
              <p className="sub-card-desc">{tier.description}</p>
              {tier.leadNote ? <p className="sub-card-desc">{tier.leadNote}</p> : null}
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

            {tier.id === 'lifetime' && (
              <FoundersOffer compact busy={offerBusy} onClaim={() => openOfferCheckout('founders')} />
            )}

            <button
              className={`sub-cta sub-cta-${tier.ctaStyle}`}
              onClick={(e) => {
                e.stopPropagation();
                handleSubscribe(tier);
              }}
              disabled={tier.id === 'free' || (!tier.link && tier.checkout !== 'session') || (tier.id === 'weekly' && weeklyBusy)}
            >
              {tier.id === 'weekly' && weeklyBusy
                ? 'Opening checkout…'
                : (tier.id === 'free' && !user ? 'Free with an account' : tier.cta)}
            </button>
          </div>
        ))}
      </div>

      <DiscordOnlyPlans variant="page" user={user} onCheckoutStart={() => setAwaitingPayment(true)} />

      <p className="ff-checkout-note" style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 1.5rem' }}>
        <a href="/policies">Plans & Policies</a> covers refunds, how to cancel, pausing, and price changes.
      </p>

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
                tier === 'discord'
                  ? 'Props are posted in Discord. Upgrade to All-Access for the full site boards.'
                  : (TIER_LABELS[tier] === 'All Access')
                  ? 'All features are unlocked across ⚾ KBO, 🏀 WNBA, 🏈 NFL, 🏀 NBA, and 🏒 NHL. Enjoy the full toolkit.'
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

          {pauseResult && (
            <div className="sub-setup-notice" style={{
              borderColor: pauseResult.ok ? '#22c55e40' : '#ef444440',
              background: pauseResult.ok ? '#22c55e10' : '#ef444410',
              marginTop: '0.75rem',
            }}>
              <span className="sub-setup-icon">{pauseResult.ok ? '✓' : '✕'}</span>
              <div>
                <p style={{ color: pauseResult.ok ? '#4ade80' : '#f87171', margin: 0 }}>{pauseResult.message}</p>
              </div>
            </div>
          )}

          {CANCELLABLE_TIERS.has(tier) && !cancelResult?.ok && (
            <div className="sub-cancel-wrap">
              {paused?.resumes_at && (
                <div className="sub-paused-note" data-testid="membership-paused">
                  <strong>Billing is paused</strong>
                  <span>It resumes automatically on {formatMemberDate(paused.resumes_at)}. You keep full access while billing is paused. Cancel anytime still ends the plan at the close of the current period.</span>
                </div>
              )}
              {!showCancelConfirm && !showPauseConfirm ? (
                <button
                  className="sub-cancel-btn"
                  onClick={() => { setShowCancelConfirm(true); setShowPauseConfirm(false); }}
                >
                  Cancel Subscription
                </button>
              ) : showPauseConfirm ? (
                <div className="sub-pause-confirm" data-testid="pause-confirm">
                  <p>
                    Pause billing for 1 week? Stripe will skip collection for this week and resume automatically on {previewResumeDate}. You keep full access, and this does not cancel your plan.
                  </p>
                  <div className="sub-cancel-actions">
                    <button
                      className="sub-pause-btn"
                      onClick={handlePause}
                      disabled={pausing}
                    >
                      {pausing ? 'Pausing...' : 'Confirm pause'}
                    </button>
                    <button
                      className="sub-cancel-btn sub-cancel-btn-back"
                      onClick={() => setShowPauseConfirm(false)}
                      disabled={pausing}
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div className="sub-cancel-confirm" data-testid="cancel-choices">
                  {PAUSE_WEEK_ENABLED && !paused && (
                    <div className="sub-pause-offer">
                      <p>Need a break instead? Pause billing for 1 week. You keep access, and billing resumes automatically.</p>
                      <button
                        className="sub-pause-btn"
                        data-testid="pause-week"
                        onClick={() => setShowPauseConfirm(true)}
                        disabled={pausing}
                      >
                        Pause 1 week
                      </button>
                    </div>
                  )}
                  <p className="sub-cancel-warning">
                    Are you sure? You'll keep access until the end of your current billing period.
                  </p>
                  <div className="sub-cancel-actions">
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
            a={freeTierFaqAnswer()}
          />
          <FaqItem
            q="Does one subscription cover every sport?"
            a="Yes — every All-Access plan (Weekly, Monthly, Yearly, or Lifetime) unlocks KBO, WNBA, NFL, NBA, and NHL under one login. Discord Only posts props in Discord and does not unlock the site. Upgrade anytime."
          />
          <FaqItem
            q="Can I cancel anytime?"
            a="Yes. Weekly, Monthly, and Yearly subscriptions can be cancelled at any time, and your access continues until the end of your current billing period. Lifetime is a one-time purchase with nothing to cancel. There is no free trial."
          />
          {PAUSE_WEEK_ENABLED && (
            <FaqItem
            q="Can I pause for a week instead?"
            a="Yes. Cancel Subscription offers Pause 1 week first. That pauses Stripe payment collection for 7 days and voids invoices created in that window. Billing resumes automatically, and this page shows the resume date. You keep access while paused. Cancel anytime is unchanged."
          />
          )}
          <FaqItem
            q="What is Discord Only?"
            a="A cheaper plan that puts the props in the CGPropz Discord and gives you the Discord props role. It does not unlock the KBO, WNBA, NFL, or NHL boards on the site. Discord Only doesn't include the site boards, NBA included. All-Access includes the site and the site-subscriber Discord role. Connect Discord on this page after you pay."
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
