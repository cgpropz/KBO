import { useState, useEffect } from 'react';
import './LandingPage.css';
import { dataUrl } from './dataUrl';

const TEAMS = {
  Doosan:  { color: '#9595d3', full: 'Doosan Bears' },
  Hanwha:  { color: '#ff8c00', full: 'Hanwha Eagles' },
  Kia:     { color: '#ff4444', full: 'Kia Tigers' },
  Kiwoom:  { color: '#d4a76a', full: 'Kiwoom Heroes' },
  KT:      { color: '#e0e0e0', full: 'KT Wiz' },
  LG:      { color: '#e8557a', full: 'LG Twins' },
  Lotte:   { color: '#ff6666', full: 'Lotte Giants' },
  NC:      { color: '#5b9bd5', full: 'NC Dinos' },
  Samsung: { color: '#60a5fa', full: 'Samsung Lions' },
  SSG:     { color: '#ff5555', full: 'SSG Landers' },
};

function LandingPage({ onNavigate }) {
  const [kData, setKData] = useState(null);
  const [batterData, setBatterData] = useState(null);
  const [rankings, setRankings] = useState(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(dataUrl('strikeout_projections.json')).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(dataUrl('batter_projections.json')).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(dataUrl('pitcher_rankings.json')).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([k, b, r]) => {
      setKData(k);
      setBatterData(b);
      setRankings(r);
    });
    setTimeout(() => setAnimate(true), 50);
  }, []);

  const kProjections = kData?.projections || [];
  const batterProjections = batterData?.projections || [];
  const topPitchers = (rankings || []).slice(0, 5);
  const todaysGames = [...new Set(kProjections.map(p => `${p.team},${p.opponent}`))];

  // Compute stats
  const totalProps = kProjections.length + batterProjections.length;
  const overPicks = [...kProjections, ...batterProjections].filter(p => p.recommendation === 'OVER');
  const topKPick = kProjections.reduce((best, p) => (!best || (p.edge && p.edge > (best.edge || -999))) ? p : best, null);
  const topBatterPick = batterProjections.filter(p => p.prop === 'Hits+Runs+RBIs').reduce((best, p) => (!best || (p.edge && p.edge > (best.edge || -999))) ? p : best, null);
  const topTBPick = batterProjections.filter(p => p.prop === 'Total Bases').reduce((best, p) => (!best || (p.edge && p.edge > (best.edge || -999))) ? p : best, null);

  return (
    <div className={`lp ${animate ? 'lp-visible' : ''}`}>
      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-bg" />
        <div className="lp-hero-content">
          <div className="lp-badge">2026 SEASON</div>
          <h1 className="lp-logo-text">
            <span className="lp-logo-k">KBO</span>
            <span className="lp-logo-divider" />
            <span className="lp-logo-sub">PROPS</span>
          </h1>
          <p className="lp-tagline">Daily KBO PrizePicks edges built from live data</p>
          <div className="lp-hero-stats">
            <div className="lp-stat-pill">
              <span className="lp-stat-num">{totalProps}</span>
              <span className="lp-stat-label">Props Today</span>
            </div>
            <div className="lp-stat-pill">
              <span className="lp-stat-num">{overPicks.length}</span>
              <span className="lp-stat-label">OVER Picks</span>
            </div>
            <div className="lp-stat-pill">
              <span className="lp-stat-num">{todaysGames.length}</span>
              <span className="lp-stat-label">Games</span>
            </div>
            <div className="lp-stat-pill">
              <span className="lp-stat-num">{topPitchers.length > 0 ? (rankings || []).length : '—'}</span>
              <span className="lp-stat-label">Pitchers Ranked</span>
            </div>
          </div>
          <div className="lp-hero-actions">
            <button className="lp-cta lp-cta-primary" onClick={() => onNavigate('projections')}>
              ⚡ K Projections
            </button>
            <button className="lp-cta lp-cta-secondary" onClick={() => onNavigate('batters')}>
              🏏 Batter Props
            </button>
          </div>
        </div>
      </section>

      {/* Today's Games Ticker */}
      {todaysGames.length > 0 && (
        <section className="lp-ticker">
          <div className="lp-ticker-label">TODAY'S GAMES</div>
          <div className="lp-ticker-games">
            {todaysGames.map((g, i) => {
              const [away, home] = g.split(',');
              return (
                <div key={i} className="lp-game-chip">
                  <span style={{ color: TEAMS[away]?.color || '#999' }}>{away}</span>
                  <span className="lp-at">@</span>
                  <span style={{ color: TEAMS[home]?.color || '#999' }}>{home}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Top Picks */}
      <section className="lp-section">
        <h2 className="lp-section-title">
          <span className="lp-section-icon">🔥</span> Top Value Picks
        </h2>
        <div className="lp-picks-grid">
          {topKPick && topKPick.projection != null && (
            <div className="lp-pick-card lp-pick-k" onClick={() => onNavigate('projections')}>
              <div className="lp-pick-type">STRIKEOUTS</div>
              <div className="lp-pick-player">{topKPick.name}</div>
              <div className="lp-pick-matchup">
                <span style={{ color: TEAMS[topKPick.team]?.color }}>{topKPick.team}</span>
                {' vs '}
                <span style={{ color: TEAMS[topKPick.opponent]?.color }}>{topKPick.opponent}</span>
              </div>
              <div className="lp-pick-nums">
                <div className="lp-pick-line">
                  <span className="lp-pp-icon">P</span> {topKPick.line ?? '—'}
                </div>
                <div className="lp-pick-proj">Proj: {topKPick.projection.toFixed(1)}</div>
                {topKPick.edge != null && (
                  <div className={`lp-pick-edge ${topKPick.edge > 0 ? 'edge-pos' : 'edge-neg'}`}>
                    {topKPick.edge > 0 ? '+' : ''}{topKPick.edge.toFixed(2)}
                  </div>
                )}
              </div>
              <div className={`lp-pick-badge ${topKPick.recommendation === 'OVER' ? 'badge-over' : topKPick.recommendation === 'UNDER' ? 'badge-under' : 'badge-push'}`}>
                {topKPick.recommendation}
              </div>
            </div>
          )}
          {topBatterPick && topBatterPick.projection != null && (
            <div className="lp-pick-card lp-pick-hrr" onClick={() => onNavigate('batters')}>
              <div className="lp-pick-type">H+R+RBI</div>
              <div className="lp-pick-player">{topBatterPick.name}</div>
              <div className="lp-pick-matchup">
                <span style={{ color: TEAMS[topBatterPick.team]?.color }}>{topBatterPick.team}</span>
                {' vs '}
                <span style={{ color: TEAMS[topBatterPick.opponent]?.color }}>{topBatterPick.opponent}</span>
              </div>
              <div className="lp-pick-nums">
                <div className="lp-pick-line">
                  <span className="lp-pp-icon">P</span> {topBatterPick.line ?? '—'}
                </div>
                <div className="lp-pick-proj">Proj: {topBatterPick.projection.toFixed(1)}</div>
                {topBatterPick.edge != null && (
                  <div className={`lp-pick-edge ${topBatterPick.edge > 0 ? 'edge-pos' : 'edge-neg'}`}>
                    {topBatterPick.edge > 0 ? '+' : ''}{topBatterPick.edge.toFixed(2)}
                  </div>
                )}
              </div>
              <div className={`lp-pick-badge ${topBatterPick.recommendation === 'OVER' ? 'badge-over' : topBatterPick.recommendation === 'UNDER' ? 'badge-under' : 'badge-push'}`}>
                {topBatterPick.recommendation}
              </div>
            </div>
          )}
          {topTBPick && topTBPick.projection != null && (
            <div className="lp-pick-card lp-pick-tb" onClick={() => onNavigate('batters')}>
              <div className="lp-pick-type">TOTAL BASES</div>
              <div className="lp-pick-player">{topTBPick.name}</div>
              <div className="lp-pick-matchup">
                <span style={{ color: TEAMS[topTBPick.team]?.color }}>{topTBPick.team}</span>
                {' vs '}
                <span style={{ color: TEAMS[topTBPick.opponent]?.color }}>{topTBPick.opponent}</span>
              </div>
              <div className="lp-pick-nums">
                <div className="lp-pick-line">
                  <span className="lp-pp-icon">P</span> {topTBPick.line ?? '—'}
                </div>
                <div className="lp-pick-proj">Proj: {topTBPick.projection.toFixed(1)}</div>
                {topTBPick.edge != null && (
                  <div className={`lp-pick-edge ${topTBPick.edge > 0 ? 'edge-pos' : 'edge-neg'}`}>
                    {topTBPick.edge > 0 ? '+' : ''}{topTBPick.edge.toFixed(2)}
                  </div>
                )}
              </div>
              <div className={`lp-pick-badge ${topTBPick.recommendation === 'OVER' ? 'badge-over' : topTBPick.recommendation === 'UNDER' ? 'badge-under' : 'badge-push'}`}>
                {topTBPick.recommendation}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Navigation Cards */}
      <section className="lp-section">
        <h2 className="lp-section-title">
          <span className="lp-section-icon">📊</span> Explore Tools
        </h2>
        <div className="lp-nav-grid">
          <button className="lp-nav-card" onClick={() => onNavigate('projections')}>
            <div className="lp-nav-icon">⚡</div>
            <div className="lp-nav-info">
              <h3>K Projections</h3>
              <p>Pitcher strikeout projections with opponent-adjusted models</p>
              <span className="lp-nav-count">{kProjections.length} props</span>
            </div>
          </button>
          <button className="lp-nav-card" onClick={() => onNavigate('batters')}>
            <div className="lp-nav-icon">🏏</div>
            <div className="lp-nav-info">
              <h3>Batter Props</h3>
              <p>H+R+RBI and Total Bases projections with team matchup factors</p>
              <span className="lp-nav-count">{batterProjections.length} props</span>
            </div>
          </button>
          <button className="lp-nav-card" onClick={() => onNavigate('props')}>
            <div className="lp-nav-icon">🎯</div>
            <div className="lp-nav-info">
              <h3>Player Props</h3>
              <p>Full PrizePicks prop lines and player lookup tool</p>
            </div>
          </button>
          <button className="lp-nav-card" onClick={() => onNavigate('rankings')}>
            <div className="lp-nav-icon">🏆</div>
            <div className="lp-nav-info">
              <h3>Pitcher Rankings</h3>
              <p>Season-long pitcher performance rankings by ERA, WHIP, K%</p>
              <span className="lp-nav-count">{(rankings || []).length} pitchers</span>
            </div>
          </button>
          <button className="lp-nav-card" onClick={() => onNavigate('tracker')}>
            <div className="lp-nav-icon">📋</div>
            <div className="lp-nav-info">
              <h3>Prop Tracker</h3>
              <p>Log your picks, track results, and monitor your win rate &amp; units</p>
            </div>
          </button>
          <button className="lp-nav-card" onClick={() => onNavigate('optimizer')}>
            <div className="lp-nav-icon">🎰</div>
            <div className="lp-nav-info">
              <h3>Slip Builder</h3>
              <p>Build multi-leg slips or auto-generate the highest-confidence combos</p>
            </div>
          </button>
          <button className="lp-nav-card" onClick={() => onNavigate('matchups')}>
            <div className="lp-nav-icon">⚔️</div>
            <div className="lp-nav-info">
              <h3>Matchup Deep Dive</h3>
              <p>Pitcher vs pitcher, team batting, park factors &amp; all props per game</p>
            </div>
          </button>
        </div>
      </section>

      {/* Top Pitchers Preview */}
      {topPitchers.length > 0 && (
        <section className="lp-section">
          <h2 className="lp-section-title">
            <span className="lp-section-icon">🏆</span> Top 5 Pitchers
          </h2>
          <div className="lp-rankings-preview">
            {topPitchers.map((p, i) => (
              <div key={i} className="lp-rank-row" onClick={() => onNavigate('rankings')}>
                <span className="lp-rank-num">#{p.rk}</span>
                <span className="lp-rank-name" style={{ color: TEAMS[p.team]?.color || '#ccc' }}>{p.name}</span>
                <span className="lp-rank-team">{p.team}</span>
                <div className="lp-rank-stats">
                  <span className="lp-rank-stat">{p.era?.toFixed(2) ?? '—'} <small>ERA</small></span>
                  <span className="lp-rank-stat">{p.whip?.toFixed(2) ?? '—'} <small>WHIP</small></span>
                  <span className="lp-rank-stat">{p.k_pct?.toFixed(1) ?? '—'}% <small>K%</small></span>
                  <span className="lp-rank-stat">{p.w}-{p.l} <small>W-L</small></span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pricing CTA */}
      <section className="lp-section" style={{ textAlign: 'center' }}>
        <h2 className="lp-section-title">
          <span className="lp-section-icon">💎</span> Unlock Full Access
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '1.25rem', maxWidth: 500, marginLeft: 'auto', marginRight: 'auto' }}>
          Get unlimited projections, hit-rate analysis, slip builder, and more with a premium plan.
        </p>
        <button
          onClick={() => onNavigate('pricing')}
          style={{
            padding: '0.9rem 2.5rem',
            background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            fontSize: '1rem',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          View Plans & Pricing
        </button>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <p>KBO Props &middot; Data sourced from KBO &amp; PrizePicks &middot; Projections updated daily</p>
      </footer>
    </div>
  );
}

export default LandingPage;
