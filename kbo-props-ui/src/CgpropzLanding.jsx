import { useAuth } from './AuthContext';
import './CgpropzLanding.css';

/*
 * cgpropz — unified brand hub / front door.
 * Sits above both sports (⚾ KBO and 🏀 WNBA). Users land here after login,
 * pick a sport to enter, or jump to the unified pricing page.
 *
 * Props:
 *   onEnterSport(sport)  → 'kbo' | 'wnba'
 *   onNavigate(view)     → e.g. 'pricing'
 */

const SPORTS = [
  {
    id: 'kbo',
    emoji: '⚾',
    name: 'KBO',
    full: 'Korea Baseball',
    tagline: 'Strikeout & batter projections, prop cards, slip builder, and matchup breakdowns.',
    accent: '#00a8e8',
    glow: 'rgba(0, 168, 232, 0.35)',
    features: ['Pitcher K projections', 'Batter props & hit rates', 'Slip builder + tracker'],
  },
  {
    id: 'wnba',
    emoji: '🏀',
    name: 'WNBA',
    full: 'Women\'s Basketball',
    tagline: 'PrizePicks edge board, player projections, defense vs position, and daily lineups.',
    accent: '#ff6900',
    glow: 'rgba(255, 105, 0, 0.35)',
    features: ['PrizePicks edge board', 'Points / reb / ast projections', 'DvP & daily lineups'],
  },
];

export default function CgpropzLanding({ onEnterSport, onNavigate }) {
  const { user, tier, signOut } = useAuth();
  const isPaid = tier && tier !== 'free';

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
            {isPaid ? '✓ ALL ACCESS ACTIVE' : 'AI-POWERED SPORTS PROPS'}
          </div>
          <h1 className="cg-hero-title">
            One edge. <span className="cg-hero-grad">Every sport.</span>
          </h1>
          <p className="cg-hero-sub">
            Data-driven projections, hit rates, and prop analysis across KBO baseball and
            WNBA basketball — all under one login, one subscription.
          </p>
          <div className="cg-hero-cta">
            <button className="cg-cta-primary" onClick={() => onEnterSport('kbo')}>Enter the app</button>
            {!isPaid && (
              <button className="cg-cta-ghost" onClick={() => onNavigate('pricing')}>View plans</button>
            )}
          </div>
        </section>

        <section className="cg-sports">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              className="cg-sport-card"
              style={{ '--accent': s.accent, '--glow': s.glow }}
              onClick={() => onEnterSport(s.id)}
            >
              <div className="cg-sport-emoji">{s.emoji}</div>
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
            </button>
          ))}
        </section>

        <section className="cg-pricing-strip">
          <div className="cg-pricing-copy">
            <h3>One subscription. Both sports.</h3>
            <p>All Access unlocks every KBO and WNBA tool — projections, prop cards, edge boards, and more.</p>
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
