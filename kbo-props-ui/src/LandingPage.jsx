import { useState, useEffect } from 'react';
import './LandingPage.css';
import { fetchDataSnapshot } from './dataUrl';

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

const SHOWCASE_SHOTS = [
  {
    image: '/showcase/power-play-slip.svg',
    eyebrow: 'Winning Receipts',
    title: 'Show new users what a settled slip looks like',
    quote: 'The win screen gives people immediate context on how the picks translate into real payout screens and final results.',
    route: 'tracker',
    cta: 'Open Prop Tracker',
  },
  {
    image: '/showcase/batter-prop-card.svg',
    eyebrow: 'Card Breakdown',
    title: 'Let them preview the exact prop card experience',
    quote: 'Projection, score, edge, hit rates, and recent bars all sit in one view so the sell is visual before it is verbal.',
    route: 'props',
    cta: 'Open Player Props',
  },
  {
    image: '/showcase/hit-rate-table.svg',
    eyebrow: 'Scan Fast',
    title: 'Surface the sortable model board up front',
    quote: 'A clean heat-mapped table makes it obvious that users can sort by hit rate, rating, and value in seconds.',
    route: 'batters',
    cta: 'Open Batter Props',
  },
  {
    image: '/showcase/pitcher-board.svg',
    eyebrow: 'Pitcher Model',
    title: 'Preview the strikeout board before signup',
    quote: 'The pitcher screen immediately communicates that this is a model-driven board, not a thin picks page.',
    route: 'projections',
    cta: 'Open Pitchers',
  },
];

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatSigned(v, digits = 2) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function enrichPick(pick) {
  if (!pick) return null;

  const line = toNum(pick.line);
  const projection = toNum(pick.projection);
  const edge = toNum(pick.edge);
  const rec = String(pick.recommendation || '').toUpperCase();

  if (!Number.isFinite(line) || !Number.isFinite(projection) || !Number.isFinite(edge)) return null;
  if (rec !== 'OVER' && rec !== 'UNDER') return null;

  // Directional value: positive means model has an actionable edge in the recommended direction.
  const directionalValue = rec === 'UNDER' ? -edge : edge;
  if (!Number.isFinite(directionalValue) || directionalValue <= 0) return null;

  const rating = toNum(pick.rating, 50);
  const gamesUsed = Math.max(0, toNum(pick.games_used, 0));
  const confidence = Math.max(0, Math.min(100, Math.abs(rating - 50) * 2));
  const valuePct = line > 0 ? (directionalValue / line) * 100 : 0;
  const stability = Math.min(gamesUsed / 20, 1);
  const valueScore = directionalValue * (1 + confidence / 140 + stability / 8);

  return {
    ...pick,
    line,
    projection,
    edge,
    recommendation: rec,
    directionalValue,
    valuePct,
    confidence,
    gamesUsed,
    valueScore,
  };
}

function selectBestValuePick(picks, filterFn = () => true) {
  const candidates = picks
    .filter(filterFn)
    .map(enrichPick)
    .filter(Boolean)
    .sort((a, b) => b.valueScore - a.valueScore);
  return candidates[0] || null;
}

function LandingPage({ onNavigate }) {
  const [kData, setKData] = useState(null);
  const [batterData, setBatterData] = useState(null);
  const [rankings, setRankings] = useState(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchDataSnapshot('strikeout_projections.json').catch(() => null),
      fetchDataSnapshot('batter_projections.json').catch(() => null),
      fetchDataSnapshot('pitcher_rankings.json').catch(() => null),
    ]).then(([kSnap, bSnap, rSnap]) => {
      setKData(kSnap?.data || null);
      setBatterData(bSnap?.data || null);
      setRankings(rSnap?.data || null);
    });
    setTimeout(() => setAnimate(true), 50);
  }, []);

  const kProjections = kData?.projections || [];
  const batterProjections = batterData?.projections || [];
  const topPitchers = (rankings || []).slice(0, 5);
  const todaysGames = [];
  const seenGamePairs = new Set();
  for (const p of kProjections) {
    if (!p?.team || !p?.opponent) continue;
    const pairKey = [p.team, p.opponent].sort().join('|');
    if (seenGamePairs.has(pairKey)) continue;
    seenGamePairs.add(pairKey);
    todaysGames.push({ away: p.team, home: p.opponent });
  }

  // Compute stats
  const totalProps = kProjections.length + batterProjections.length;
  const overPicks = [...kProjections, ...batterProjections].filter(p => p.recommendation === 'OVER');
  const topKPick = selectBestValuePick(kProjections, p => p.prop === 'Strikeouts');
  const topBatterPick = selectBestValuePick(batterProjections, p => p.prop === 'Hits+Runs+RBIs');
  const topTBPick = selectBestValuePick(batterProjections, p => p.prop === 'Total Bases');

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
              ⚡ Pitchers
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
            {todaysGames.map((g, i) => (
              <div key={i} className="lp-game-chip">
                <span style={{ color: TEAMS[g.away]?.color || '#999' }}>{g.away}</span>
                <span className="lp-at">@</span>
                <span style={{ color: TEAMS[g.home]?.color || '#999' }}>{g.home}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Picks */}
      <section className="lp-section">
        <h2 className="lp-section-title">
          <span className="lp-section-icon">🔥</span> Top Value Picks
        </h2>
        <p className="lp-section-subtitle">Sorted by directional edge, confidence, and sample stability.</p>
        <div className="lp-picks-grid">
          {topKPick && (
            <ValuePickCard
              pick={topKPick}
              typeLabel="STRIKEOUTS"
              cardClass="lp-pick-k"
              onClick={() => onNavigate('projections')}
            />
          )}
          {topBatterPick && (
            <ValuePickCard
              pick={topBatterPick}
              typeLabel="H+R+RBI"
              cardClass="lp-pick-hrr"
              onClick={() => onNavigate('batters')}
            />
          )}
          {topTBPick && (
            <ValuePickCard
              pick={topTBPick}
              typeLabel="TOTAL BASES"
              cardClass="lp-pick-tb"
              onClick={() => onNavigate('batters')}
            />
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
              <h3>Pitchers</h3>
              <p>Strikeouts, hits allowed, and pitching outs projections in one board</p>
              <span className="lp-nav-count">{kProjections.length} props</span>
            </div>
          </button>
          <button className="lp-nav-card" onClick={() => onNavigate('batters')}>
            <div className="lp-nav-icon">⚾️</div>
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

      <section className="lp-section lp-showcase-section">
        <div className="lp-showcase-heading">
          <div>
            <h2 className="lp-section-title">
              <span className="lp-section-icon">🖼️</span> See The Product Before You Buy
            </h2>
            <p className="lp-section-subtitle">
              These preview panels give new users a quick read on the UI, the visual language, and how the model presents edges.
            </p>
          </div>
          <button className="lp-showcase-cta" onClick={() => onNavigate('pricing')}>
            Unlock Full Access
          </button>
        </div>

        <div className="lp-showcase-grid">
          {SHOWCASE_SHOTS.map((shot) => (
            <article key={shot.title} className="lp-showcase-card">
              <div className="lp-showcase-frame">
                <img src={shot.image} alt={shot.title} loading="lazy" />
              </div>
              <div className="lp-showcase-copy">
                <span className="lp-showcase-eyebrow">{shot.eyebrow}</span>
                <h3>{shot.title}</h3>
                <p>{shot.quote}</p>
                <button className="lp-showcase-link" onClick={() => onNavigate(shot.route)}>
                  {shot.cta}
                </button>
              </div>
            </article>
          ))}
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

function ValuePickCard({ pick, typeLabel, cardClass, onClick }) {
  const meterWidth = Math.max(8, Math.min(100, pick.valuePct * 4.2));
  return (
    <div className={`lp-pick-card ${cardClass}`} onClick={onClick}>
      <div className="lp-pick-type">{typeLabel}</div>
      <div className="lp-pick-player">{pick.name}</div>
      <div className="lp-pick-matchup">
        <span style={{ color: TEAMS[pick.team]?.color }}>{pick.team}</span>
        {' vs '}
        <span style={{ color: TEAMS[pick.opponent]?.color }}>{pick.opponent}</span>
      </div>

      <div className="lp-pick-nums">
        <div className="lp-pick-line">
          <span className="lp-pp-icon">P</span> {pick.line.toFixed(1)}
        </div>
        <div className="lp-pick-proj">Proj: {pick.projection.toFixed(1)}</div>
      </div>

      <div className="lp-pick-metrics">
        <div className="lp-pick-metric">
          <span className="lp-pick-metric-label">VALUE</span>
          <span className="lp-pick-metric-value edge-pos">{formatSigned(pick.directionalValue)}</span>
        </div>
        <div className="lp-pick-metric">
          <span className="lp-pick-metric-label">VALUE %</span>
          <span className="lp-pick-metric-value">{formatSigned(pick.valuePct, 1)}%</span>
        </div>
        <div className="lp-pick-metric">
          <span className="lp-pick-metric-label">CONF</span>
          <span className="lp-pick-metric-value">{pick.confidence.toFixed(0)}%</span>
        </div>
        <div className="lp-pick-metric">
          <span className="lp-pick-metric-label">GAMES</span>
          <span className="lp-pick-metric-value">{pick.gamesUsed}</span>
        </div>
      </div>

      <div className="lp-value-meter" aria-hidden="true">
        <span style={{ width: `${meterWidth}%` }} />
      </div>

      <div className={`lp-pick-badge ${pick.recommendation === 'OVER' ? 'badge-over' : pick.recommendation === 'UNDER' ? 'badge-under' : 'badge-push'}`}>
        {pick.recommendation} · Raw Edge {formatSigned(pick.edge)}
      </div>
    </div>
  );
}

export default LandingPage;
