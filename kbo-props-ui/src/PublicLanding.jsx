import { useState } from 'react';
import { SPORTS } from './sportsMeta';
import './PublicLanding.css';

/*
 * cgpropz — public marketing landing page.
 * Shown to brand-new/anonymous visitors before they log in or sign up.
 * Props:
 *   onGetStarted() → reveal AuthPage in 'signup' mode
 *   onLogin()      → reveal AuthPage in 'login' mode
 */

const FEATURES = [
  { icon: '📊', title: 'Model Projections', text: 'Data-driven projections built from recent form, matchups, and historical trends.' },
  { icon: '🎯', title: 'Prop Analysis & Hit Rates', text: 'See L10 hit rates and game logs behind every prop before you build a slip.' },
  { icon: '🛡️', title: 'Matchup Insights', text: 'Defense vs. position breakdowns to spot the softest matchups on the board.' },
  { icon: '🔑', title: 'One Login, Every Sport', text: 'KBO, WNBA, and NFL projections and edge boards under a single subscription.' },
];

const SHOWCASE = [
  {
    sport: 'WNBA',
    image: '/landing-screenshots/wnba-edge-board.png',
    caption: 'PrizePicks edge board with L10 hit-rate charts for every player prop.',
  },
  {
    sport: 'NFL',
    image: '/landing-screenshots/nfl-player-detail.png',
    caption: 'Player detail pages with hit rate and recent-form breakdowns.',
  },
  {
    sport: 'KBO',
    image: '/landing-screenshots/kbo-projections.png',
    caption: 'Batter projection tables with matchup and hit-rate context.',
  },
];

const TESTIMONIALS = [
  { quote: 'I can compare the line, projection, and recent form without jumping between five tabs.', label: 'The daily scan' },
  { quote: 'The CG Projection gives every prop a clear strength signal, so I know where to spend my attention.', label: 'The edge finder', featured: true },
  { quote: 'I use the matchup context and game-log view to build a smaller, more deliberate slip.', label: 'The disciplined build' },
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

export default function PublicLanding({ onGetStarted, onLogin }) {
  return (
    <div className="pl-landing">
      <div className="pl-bg" />

      <header className="pl-header">
        <div className="pl-wordmark">
          cg<span className="pl-wordmark-accent">propz</span>
        </div>
        <nav className="pl-nav">
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
              <a className="pl-cta-ghost" href="#pricing">View Plans</a>
            </div>
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

        <section className="pl-features" id="features">
          <div className="pl-section-heading">
            <span className="pl-section-kicker">What you get</span>
            <h2>Everything you need in one place.</h2>
          </div>
          <div className="pl-feature-grid">
            {FEATURES.map((f) => (
              <div className="pl-feature-card" key={f.title}>
                <div className="pl-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
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
                onClick={onGetStarted}
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

        <section className="pl-showcase">
          <div className="pl-section-heading">
            <span className="pl-section-kicker">See it in action</span>
            <h2>The platform, at a glance.</h2>
          </div>
          <div className="pl-showcase-grid">
            {SHOWCASE.map((item) => (
              <figure className="pl-showcase-card" key={item.sport}>
                <img src={item.image} alt={`${item.sport} screenshot`} />
                <figcaption>
                  <span className="pl-showcase-sport">{item.sport}</span>
                  <p>{item.caption}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="pl-pricing" id="pricing">
          <div className="pl-pricing-card">
            <span className="pl-pricing-badge">MOST POPULAR</span>
            <h3>Monthly All-Access</h3>
            <div className="pl-pricing-price">$29.99<span>/ month</span></div>
            <ul className="pl-pricing-features">
              <li>⚾🏀🏈 Full KBO, WNBA & NFL projections</li>
              <li>PrizePicks edge board for every sport</li>
              <li>Player prop cards & hit rates</li>
              <li>Slip builder, optimizer & prop tracker</li>
              <li>Defense vs position & daily lineups</li>
              <li>Full game log history</li>
            </ul>
            <button className="pl-cta-primary pl-pricing-cta" onClick={onGetStarted}>Get Started</button>
            <p className="pl-pricing-alt">Also available: Weekly $9.99/wk or Lifetime $99.99 one-time.</p>
          </div>
        </section>

        <section className="pl-testimonials">
          <div className="pl-section-heading">
            <span className="pl-section-kicker">Subscriber perspective</span>
            <h2>Built for a calmer way to play the board.</h2>
          </div>
          <div className="pl-testimonial-grid">
            {TESTIMONIALS.map((t) => (
              <article className={`pl-testimonial-card ${t.featured ? 'pl-testimonial-card-featured' : ''}`} key={t.label}>
                <span className="pl-quote-mark" aria-hidden="true">&ldquo;</span>
                <p>&ldquo;{t.quote}&rdquo;</p>
                <span className="pl-testimonial-label">{t.label}</span>
              </article>
            ))}
          </div>
        </section>

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
          <button className="pl-cta-primary" onClick={onGetStarted}>Get Started Free</button>
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
