import { useState } from 'react';
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
  monthly: 'https://buy.stripe.com/28E28tc4nfmKfPI1eM5Ne01',
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
      'Top 3 K projections',
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

  const handleSubscribe = (tier) => {
    if (!tier.link) return;
    window.open(tier.link, '_blank', 'noopener');
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

      <div className="sub-faq">
        <h2 className="sub-faq-title">Frequently Asked Questions</h2>
        <div className="sub-faq-grid">
          <FaqItem
            q="What's included in the free tier?"
            a="You get access to the landing page, today's game schedule, and a preview of the top 3 strikeout projections. Upgrade to unlock full projections, player prop cards, and advanced tools."
          />
          <FaqItem
            q="Can I cancel anytime?"
            a="Yes. Weekly and monthly subscriptions can be cancelled at any time through Stripe's customer portal. Your access continues until the end of your billing period."
          />
          <FaqItem
            q="What is the Full Season plan?"
            a="A one-time payment that gives you complete access to every feature for the entire 2025 KBO season. No recurring charges — the best deal for committed bettors."
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
