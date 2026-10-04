import { useAuth } from './AuthContext';
import { sportAccess } from './entitlements';
import { SPORTS } from './sportsMeta';
import TrustStrip from './TrustStrip';
import Testimonials from './Testimonials';
import TestimonialForm from './TestimonialForm';
import Results from './Results';
import './CgpropzLanding.css';

/*
 * cgpropz — unified brand hub / front door.
 * Sits above all sports. Users land here after login,
 * pick a sport to enter, or jump to the unified pricing page.
 *
 * Props:
 *   onEnterSport(sport)  → 'kbo' | 'wnba' | 'nfl'
 *   onNavigate(view)     → e.g. 'pricing'
 */

export default function CgpropzLanding({ onEnterSport, onNavigate }) {
  const { user, tier, signOut } = useAuth();
  const access = sportAccess(tier);
  const isPaid = access.kbo || access.wnba || access.nfl;
  const isAllAccess = access.kbo && access.wnba && access.nfl;

  return (
    <div className="cg-landing">
      <div className="cg-bg" />

      <header className="cg-header">
        <div className="cg-wordmark">
          cg<span className="cg-wordmark-accent">propz</span>
        </div>
        <div className="cg-header-actions">
          <button className="cg-link-btn" onClick={() => onNavigate('pricing')}>
            {isPaid ? 'Manage Plan' : 'Pricing'}
          </button>
          {user && (
            <button className="cg-signout" onClick={signOut} title={user.email}>
              Sign Out
            </button>
          )}
        </div>
      </header>

      <main className="cg-main">
        <section className="cg-hero">
          <div className="cg-hero-badge">
            {isAllAccess ? '✓ ALL ACCESS ACTIVE' : isPaid ? '✓ MEMBER ACCESS ACTIVE' : 'HAND-CRAFTED PROPS'}
          </div>
          <h1 className="cg-hero-title">
            One edge. <span className="cg-hero-grad">Every sport.</span>
          </h1>
          <p className="cg-hero-sub">
            Data-driven projections, hit rates, and prop analysis across KBO baseball and
            WNBA basketball, and NFL football — all under one login, one subscription.
          </p>
          <div className="cg-hero-cta">
            <button className="cg-cta-primary" onClick={() => onEnterSport('kbo')}>Enter the app</button>
            {!isPaid && (
              <button className="cg-cta-ghost" onClick={() => onNavigate('pricing')}>View plans</button>
            )}
          </div>
          <TrustStrip align="center" />
        </section>

        <section className="cg-sports">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              className="cg-sport-card"
              style={{ '--accent': s.accent, '--glow': s.glow }}
              onClick={() => onEnterSport(s.id)}
            >
              <div className="cg-sport-art">
                <img
                  src={s.portrait}
                  alt={s.portraitAlt}
                  width="960"
                  height="720"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="cg-sport-body">
                <div className="cg-sport-head">
                  <h2 className="cg-sport-name">{s.name}</h2>
                  <span className="cg-sport-full">{s.full}</span>
                </div>
                <p className="cg-sport-tagline">{s.tagline}</p>
                <ul className="cg-sport-features">
                  {s.features.map((f, i) => (
                    <li key={i}><span className="cg-dot" />{f}</li>
                  ))}
                </ul>
                <span className="cg-sport-enter">Enter {s.name} →</span>
              </div>
            </button>
          ))}
        </section>

        <Results />

        <Testimonials />
        <TestimonialForm />

        <section className="cg-pricing-strip">
          <div className="cg-pricing-copy">
            <h3>One subscription. Every sport.</h3>
            <p>All Access unlocks KBO, WNBA, and NFL projections, prop cards, and edge boards.</p>
            <p className="cg-pricing-note">No credit card required to explore the free board first.</p>
          </div>
          <button className="cg-cta-primary" onClick={() => onNavigate('pricing')}>
            {isPaid ? 'Manage subscription' : 'See pricing'}
          </button>
        </section>
      </main>

      <footer className="cg-footer">
        <span>© {new Date().getFullYear()} cgpropz</span>
        <span className="cg-footer-note">For entertainment purposes only. Bet responsibly.</span>
      </footer>
    </div>
  );
}
