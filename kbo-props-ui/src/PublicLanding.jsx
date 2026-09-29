import { useState } from 'react';
import { SPORTS } from './sportsMeta';
import { TIERS } from './pricingTiers';
import TrustStrip from './TrustStrip';
import Testimonials from './Testimonials';
import FreePicksPreview from './FreePicksPreview';
import { buildCheckoutUrl } from './tracking';
import './PublicLanding.css';

/*
 * cgpropz — public marketing landing page.
 * Shown to brand-new/anonymous visitors before they log in or sign up.
 * Props:
 *   onGetStarted() → reveal AuthPage in 'signup' mode
 *   onLogin()      → reveal AuthPage in 'login' mode
 *   onOpenBoard(s) → browse sport s ('kbo' | 'wnba' | 'nfl') in free preview mode
 */

const TOOLS = [
  {
    id: 'projections',
    kicker: 'PROJECTIONS',
    title: 'Model projections for every board.',
    text: 'Data-driven projections built from recent form, matchups, and historical trends — refreshed automatically across KBO, WNBA, and NFL.',
    image: '/landing-screenshots/kbo-projections.png',
    alt: 'KBO batter projection table with matchup and hit-rate context',
  },
  {
    id: 'hitrates',
    kicker: 'HIT RATES & PROP CARDS',
    title: 'See how often it actually cashed.',
    text: 'Every player page pairs the line and projection with L10 hit rates and a full game log, so you know the history before you build a slip.',
    image: '/landing-screenshots/nfl-player-detail.png',
    alt: 'NFL player detail page with hit rate and recent-form breakdown',
  },
  {
    id: 'edge',
    kicker: 'MATCHUP EDGE',
    title: 'Spot the softest matchup on the board.',
    text: 'Defense vs. position breakdowns and a PrizePicks edge board surface the mismatches — all under one login, one subscription.',
    image: '/landing-screenshots/wnba-edge-board.png',
    alt: 'WNBA PrizePicks edge board with L10 hit-rate charts',
  },
];

const FAQS = [
  {
    q: 'What\'s included in the free tier?',
    a: 'You get the landing page, today\'s KBO & WNBA schedules, and a preview of the top 3 lines on the KBO, WNBA & NFL boards. Upgrade to unlock full projections, prop cards, and the PrizePicks edge board for every sport.',
  },
  {
    q: 'Does one subscription cover every sport?',
    a: 'Yes — every plan (Weekly, Monthly, or Lifetime) unlocks KBO, WNBA, and NFL under one login. There are no more single-sport plans.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Weekly and Monthly subscriptions can be cancelled at any time, and your access continues until the end of your current billing period. Lifetime is a one-time purchase with nothing to cancel.',
  },
  {
    q: 'How often is the data updated?',
    a: 'KBO projections and props refresh multiple times daily before games. WNBA and NFL projections, edge, and lineups refresh on their own schedule ahead of tip-off/kickoff, so you always have the latest numbers.',
  },
];

export default function PublicLanding({ onGetStarted, onLogin, onOpenBoard }) {
  const [planId, setPlanId] = useState('weekly');
  const paidTiers = TIERS.filter((t) => t.id !== 'free');
  const activeTier = paidTiers.find((t) => t.id === planId) || paidTiers[0];
  const scrollToPricing = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Logged-out checkout: Stripe collects the email; access is matched to it
  // when the buyer signs up with the same email (webhook + sync-subscription).
  const checkout = (tier) => { if (tier?.link) window.location.assign(buildCheckoutUrl(tier.link, null)); };

  return (
    <div className="pl-landing">
      <div className="pl-bg" />

      <header className="pl-header">
        <div className="pl-wordmark">
          cg<span className="pl-wordmark-accent">propz</span>
        </div>
        <nav className="pl-nav">
          <a href="#free-picks">Free Picks</a>
          <a href="#sports">Sports</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="pl-header-actions">
          <button className="pl-link-btn" onClick={onLogin}>Log In</button>
          <button className="pl-cta-primary pl-cta-small" onClick={onGetStarted}>Get Started</button>
        </div>
      </header>

      <main className="pl-main">
        <section className="pl-hero">
          <div className="pl-hero-copy">
            <div className="pl-hero-badge">HAND-CRAFTED PROPS</div>
            <h1 className="pl-hero-title">
              One edge. <span className="pl-hero-grad">Every sport.</span>
            </h1>
            <p className="pl-hero-sub">
              Data-driven projections, hit rates, and prop analysis across KBO baseball,
              WNBA basketball, and NFL football — all under one login, one subscription.
            </p>
            <div className="pl-sport-icons" aria-hidden="true">
              <span>⚾</span><span>🏀</span><span>🏈</span>
            </div>
            <div className="pl-hero-cta">
              <button className="pl-cta-primary" onClick={onGetStarted}>Get Started Free</button>
              <a className="pl-cta-ghost" href="#free-picks">See today's free picks</a>
            </div>
            <TrustStrip />
          </div>
          <div className="pl-hero-visual">
            <div className="pl-hero-visual-bg" />
            <div className="pl-mockup pl-mockup-1">
              <img src="/landing-screenshots/wnba-edge-board.png" alt="WNBA PrizePicks edge board" />
            </div>
            <div className="pl-mockup pl-mockup-2">
              <img src="/landing-screenshots/kbo-projections.png" alt="KBO batter projections" />
            </div>
          </div>
        </section>

        <FreePicksPreview
          onSignUp={onGetStarted}
          onOpenBoard={(sport) => onOpenBoard?.(sport)}
          onSeePlans={scrollToPricing}
        />

        <section className="pl-tools" id="features">
          <div className="pl-section-heading">
            <span className="pl-section-kicker">The tools</span>
            <h2>Everything you need in one place.</h2>
          </div>
          {TOOLS.map((tool, i) => (
            <div className={`pl-tool-row${i % 2 ? ' reverse' : ''}`} key={tool.id}>
              <div className="pl-tool-visual">
                <img src={tool.image} alt={tool.alt} loading="lazy" />
              </div>
              <div className="pl-tool-copy">
                <span className="pl-tool-kicker">{tool.kicker}</span>
                <h3>{tool.title}</h3>
                <p>{tool.text}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="pl-sports" id="sports">
          <div className="pl-section-heading">
            <span className="pl-section-kicker">All major sports</span>
            <h2>One subscription. Every sport.</h2>
          </div>
          <div className="pl-sports-grid">
            {SPORTS.map((s) => (
              <button
                key={s.id}
                className="pl-sport-card"
                style={{ '--accent': s.accent, '--glow': s.glow }}
                onClick={() => (onOpenBoard ? onOpenBoard(s.id) : onGetStarted())}
              >
                <div className="pl-sport-emoji">{s.emoji}</div>
                <div className="pl-sport-head">
                  <h3 className="pl-sport-name">{s.name}</h3>
                  <span className="pl-sport-full">{s.full}</span>
                </div>
                <p className="pl-sport-tagline">{s.tagline}</p>
                <ul className="pl-sport-features">
                  {s.features.map((f, i) => (
                    <li key={i}><span className="pl-dot" />{f}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        </section>

        <section className="pl-pricing" id="pricing">
          <div className="pl-section-heading">
            <span className="pl-section-kicker">Pricing</span>
            <h2>Upgrade when it pays for itself.</h2>
          </div>
          <div className="pl-pricing-toggle" role="tablist" aria-label="Billing plan">
            {paidTiers.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTier.id === t.id}
                className={`pl-pricing-tab${activeTier.id === t.id ? ' active' : ''}`}
                onClick={() => setPlanId(t.id)}
              >
                {t.name.replace(' All-Access', '')}
              </button>
            ))}
          </div>
          <div className="pl-pricing-card">
            {activeTier.badge && <span className="pl-pricing-badge">{activeTier.badge}</span>}
            <h3>{activeTier.name}</h3>
            <div className="pl-pricing-price">{activeTier.price}<span>{activeTier.period}</span></div>
            <ul className="pl-pricing-features">
              {activeTier.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <button className="pl-cta-primary pl-pricing-cta" onClick={() => checkout(activeTier)}>
              {activeTier.cta} · {activeTier.price}{activeTier.period && activeTier.period !== 'once' ? ` ${activeTier.period}` : ''}
            </button>
            <p className="pl-pricing-alt">{activeTier.description}</p>
            <p className="ff-checkout-note">
              No account needed to check out. Afterwards, sign up with the <strong>same email</strong> you
              used at checkout and your plan unlocks automatically. Not ready?{' '}
              <button type="button" onClick={onGetStarted}>Start free</button>
            </p>
          </div>
        </section>

        <Testimonials />

        <section className="pl-faq" id="faq">
          <div className="pl-section-heading">
            <span className="pl-section-kicker">Questions</span>
            <h2>Frequently asked questions.</h2>
          </div>
          <div className="pl-faq-grid">
            {FAQS.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </section>

        <section className="pl-final-cta">
          <h2>Ready to find your edge?</h2>
          <p className="pl-final-cta-sub">No credit card required for the free tier — upgrade anytime for full access.</p>
          <button className="pl-cta-primary" onClick={onGetStarted}>Get Started Free</button>
          <TrustStrip align="center" />
        </section>
      </main>

      <footer className="pl-footer">
        <span>© {new Date().getFullYear()} cgpropz</span>
        <span className="pl-footer-note">For entertainment purposes only. Bet responsibly.</span>
      </footer>
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pl-faq-item ${open ? 'pl-faq-open' : ''}`} onClick={() => setOpen(!open)}>
      <div className="pl-faq-q">
        <span>{q}</span>
        <span className="pl-faq-toggle">{open ? '−' : '+'}</span>
      </div>
      {open && <div className="pl-faq-a">{a}</div>}
    </div>
  );
}
