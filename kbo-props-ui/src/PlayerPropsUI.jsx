import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import './PlayerPropsUI.css';
import { fetchDataSnapshot } from './dataUrl';

const TEAM_COLORS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Lotte: '#ff6666',
  Kia: '#ff4444', Kiwoom: '#d4a76a', LG: '#e8557a',
  KT: '#e0e0e0', NC: '#5b9bd5', Samsung: '#60a5fa', SSG: '#ff5555',
};

const TEAM_LOGOS = {
  Doosan: 'team-logos/doosan.svg', Hanwha: 'team-logos/hanwha.svg',
  Lotte: 'team-logos/lotte.svg', Kia: 'team-logos/kia.png',
  Kiwoom: 'team-logos/kiwoom.png', LG: 'team-logos/lg.svg',
  KT: 'team-logos/kt.svg', NC: 'team-logos/nc.svg',
  Samsung: 'team-logos/samsung.svg', SSG: 'team-logos/ssg.png',
};

/* ============== Main Component ============== */
const PlayerPropsUI = () => {
  const [data, setData] = useState(null);
  const [photos, setPhotos] = useState({});
  const [matchups, setMatchups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('hit_rate');

  const loadProps = useCallback((background = false) => {
    if (!background) setLoading(true);
    return Promise.all([
      fetchDataSnapshot('prizepicks_props.json'),
      fetchDataSnapshot('player_photos.json'),
      fetchDataSnapshot('matchup_data.json').catch(() => ({ data: { matchups: [] } })),
    ])
      .then(([propsSnapshot, photoSnapshot, matchupSnapshot]) => {
        setData(propsSnapshot.data);
        setPhotos(photoSnapshot.data || {});
        setMatchups(matchupSnapshot.data?.matchups || []);
        setLastUpdated(propsSnapshot.updatedAt || new Date().toISOString());
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    loadProps(false);
    const interval = setInterval(() => loadProps(true), 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadProps]);

  const photoLookup = useMemo(() => {
    const lookup = {};
    for (const [name, url] of Object.entries(photos || {})) {
      lookup[normalizePlayerName(name)] = url;
    }
    return lookup;
  }, [photos]);

  /* Build matchup lookup: "Team:Opponent" -> matchup object */
  const matchupLookup = useMemo(() => {
    const lookup = {};
    for (const m of matchups) {
      lookup[`${m.away}:${m.home}`] = m;
      lookup[`${m.home}:${m.away}`] = m;
    }
    return lookup;
  }, [matchups]);

  /* Flatten cards: one card per prop line */
  const propCards = useMemo(() => {
    if (!data?.cards) return [];
    let items = [];
    for (const card of data.cards) {
      for (const prop of card.props) {
        items.push({ ...card, prop, props: undefined });
      }
    }
    if (filterType !== 'all') items = items.filter(c => c.type === filterType);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      items = items.filter(c =>
        c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q) || c.opponent.toLowerCase().includes(q)
      );
    }
    items.sort((a, b) => {
      if (sortBy === 'hit_rate') {
        const scoreA = a.prop.line > 0 ? (a.prop.avg / a.prop.line) * 50 : 0;
        const scoreB = b.prop.line > 0 ? (b.prop.avg / b.prop.line) * 50 : 0;
        return scoreB - scoreA;
      }
      if (sortBy === 'edge') return ((b.prop.avg || 0) - b.prop.line) - ((a.prop.avg || 0) - a.prop.line);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });
    return items;
  }, [data, filterType, searchTerm, sortBy]);

  // DEBUG: Add global logging utility
  const debugLog = (...args) => { if (typeof window !== 'undefined') { console.log('[PlayerPropsUI]', ...args); } };

  if (loading) {
    debugLog('Loading state active');
    return (
      <div className="pp-container">
        <div className="pp-loading"><div className="pp-spinner" /><p>Loading props...</p></div>
      </div>
    );
  }
  if (error) {
    debugLog('Error state:', error);
    return (
      <div className="pp-container">
        <div className="pp-loading"><p style={{ color: '#ef476f' }}>Error: {error}</p></div>
      </div>
    );
  }
  if (!data || !Array.isArray(data.cards) || data.cards.length === 0) {
    debugLog('No props available for today:', data);
    return (
      <div className="pp-container">
        <div className="pp-loading"><p style={{ color: '#ef476f' }}>No props available for today.</p></div>
      </div>
    );
  }

  return (
    <div className="pp-container">
      <div className="pp-header">
        <h1 className="pp-title">Player Props</h1>
        <p className="pp-subtitle">{data.total_props} PrizePicks lines with game log hit rates</p>
        {lastUpdated && (
          <p className="pp-updated">Updated {formatUpdatedAt(lastUpdated)}</p>
        )}
      </div>

      <div className="pp-controls">
        <input type="text" placeholder="Search player, team..." value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)} className="pp-search" />
        <div className="pp-filters">
          {['all', 'pitcher', 'batter'].map(t => (
            <button key={t} className={`pp-filter-btn ${filterType === t ? 'active' : ''}`}
              onClick={() => setFilterType(t)}>
              {t === 'all' ? 'All' : t === 'pitcher' ? 'Pitchers' : 'Batters'}
            </button>
          ))}
        </div>
        <select className="pp-sort" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="hit_rate">Sort: Score</option>
          <option value="edge">Sort: Edge</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      <div className="pp-grid">
        {propCards.map((card, i) => (
          <PropCard
            key={`${card.name}-${card.prop.stat}-${card.prop.line}-${i}`}
            card={card}
            photoUrl={photoLookup[normalizePlayerName(card.name)]}
            matchup={matchupLookup[`${card.team}:${card.opponent}`]}
          />
        ))}
        {propCards.length === 0 && <div className="pp-empty">No props match your filters.</div>}
      </div>
    </div>
  );
};

/* ============== Individual Prop Card (NBA style) ============== */
function PropCard({ card, photoUrl, matchup }) {
  const { prop, name, team, opponent, type, games, venue, park_factor } = card;
  const teamColor = TEAM_COLORS[team] || '#888';
  const oppColor = TEAM_COLORS[opponent] || '#888';
  const oddsType = prop.odds_type || 'standard';
  const isPromo = oddsType === 'demon' || oddsType === 'goblin';
  const edge = (prop.avg || 0) - prop.line;
  let rec = prop.recommendation || (edge > 0.3 ? 'OVER' : edge < -0.3 ? 'UNDER' : 'PUSH');
  if (isPromo && rec === 'UNDER') rec = 'PUSH';
  const score = prop.line > 0 ? (prop.avg / prop.line) * 50 : 0;
  const [imageFailed, setImageFailed] = useState(false);
  const [chartPeriod, setChartPeriod] = useState(null);
  const [flipped, setFlipped] = useState(false);

  const recentVals = prop.recent_values || [];
  const slicedGames = (games || []).slice(0, recentVals.length);
  const gameDates = slicedGames.map(g => fmtDate(g.date));
  const gameOpps = slicedGames.map(g => g.opp || '');
  const limit = chartPeriod === 'l5' ? 5 : chartPeriod === 'l10' ? 10 : recentVals.length;
  const chartValues = [...recentVals.slice(0, limit)].reverse();
  const chartDates = [...gameDates.slice(0, limit)].reverse();
  const chartOpps = [...gameOpps.slice(0, limit)].reverse();

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl, name]);

  /* Matchup detail lookups */
  const pitcherInfo = (() => {
    if (!matchup) return null;
    if (type === 'pitcher') {
      const hp = matchup.home_pitcher;
      const ap = matchup.away_pitcher;
      if (hp?.name && normalizePlayerName(hp.name) === normalizePlayerName(name)) return hp;
      if (ap?.name && normalizePlayerName(ap.name) === normalizePlayerName(name)) return ap;
    } else {
      if (matchup.home === team) return matchup.away_pitcher;
      if (matchup.away === team) return matchup.home_pitcher;
    }
    return null;
  })();

  const teamBatting = (() => {
    if (!matchup) return null;
    if (type === 'pitcher') {
      if (matchup.home === team) return matchup.away_batting;
      if (matchup.away === team) return matchup.home_batting;
    } else {
      if (matchup.home === team) return matchup.home_batting;
      if (matchup.away === team) return matchup.away_batting;
    }
    return null;
  })();

  const weather = matchup?.weather;
  const parkDetail = matchup?.park_factor;
  const hasBackData = !!(pitcherInfo || teamBatting || weather);

  return (
    <div className={`pc-card ${flipped ? 'flipped' : ''}`}>
      <div className="pc-card-inner">
        {/* ===== FRONT FACE ===== */}
        <div className="pc-card-front">
          <div className="pc-header">
            <div className="pc-player-info">
              {photoUrl && !imageFailed ? (
                <img
                  className="pc-avatar"
                  src={photoUrl}
                  alt={name}
                  loading="lazy"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div className="pc-avatar-fallback" data-type={type}>
                  <span className="pc-avatar-initials">{playerInitials(name)}</span>
                </div>
              )}
              <div>
                <h3 className="pc-name">{name}</h3>
                <div className="pc-meta">
                  <span className="pc-team-tag" style={{ background: teamColor }}>{team}</span>
                  <span className="pc-vs">vs</span>
                  <span className="pc-team-tag" style={{ background: oppColor }}>{opponent}</span>
                  {venue && (
                    <span className={`pc-park ${park_factor >= 1.05 ? 'hitter' : park_factor <= 0.95 ? 'pitcher' : 'neutral'}`}>
                      {venue} ({park_factor >= 1 ? '+' : ''}{((park_factor - 1) * 100).toFixed(0)}%)
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className={`pc-rec ${rec.toLowerCase()}`}>{rec}</div>
          </div>

          <div className={`pc-stat-banner ${rec.toLowerCase()}`}>
            {shortStat(prop.stat)}
            {isPromo && <span className={`pc-odds-badge ${oddsType}`}>{oddsType.toUpperCase()}</span>}
          </div>

          <div className="pc-stats-row">
            <div className="pc-stat-box">
              <div className="pc-stat-label">LINE</div>
              <div className="pc-stat-value">{prop.line}</div>
            </div>
            <div className="pc-stat-box">
              <div className="pc-stat-label">PROJECTION</div>
              <div className="pc-stat-value">{prop.avg}</div>
            </div>
            <div className="pc-stat-box">
              <div className="pc-stat-label">SCORE</div>
              <div className="pc-stat-value" data-level={hitLevel(score)}>{score.toFixed(1)}</div>
            </div>
            <div className="pc-stat-box">
              <div className="pc-stat-label">EDGE</div>
              <div className={`pc-stat-value ${edge > 0 ? 'pos' : edge < 0 ? 'neg' : ''}`}>
                {edge > 0 ? '+' : ''}{edge.toFixed(1)}
              </div>
            </div>
          </div>

          <div className="pc-hitrates">
            <HitCircle label="L5" value={prop.hit_rate_l5}
              active={chartPeriod === 'l5'}
              onClick={() => setChartPeriod(chartPeriod === 'l5' ? null : 'l5')} />
            <HitCircle label="L10" value={prop.hit_rate_l10} highlight
              active={chartPeriod === 'l10'}
              onClick={() => setChartPeriod(chartPeriod === 'l10' ? null : 'l10')} />
            <HitCircle label="FULL" value={prop.hit_rate_all} count={`${prop.over}/${prop.total_games}`}
              active={!chartPeriod}
              onClick={() => setChartPeriod(null)} />
          </div>

          {chartValues.length > 0 && (
            <GameChart values={chartValues} dates={chartDates} opps={chartOpps} line={prop.line} />
          )}

          {hasBackData && (
            <button className="pc-flip-btn" onClick={() => setFlipped(true)}>
              Matchup Detail ↻
            </button>
          )}
        </div>

        {/* ===== BACK FACE ===== */}
        <div className="pc-card-back" onClick={() => setFlipped(false)}>
          <div className="pc-back-header">
            <span className="pc-back-name">{name}</span>
            <span className="pc-back-close">✕</span>
          </div>

          {/* Pitcher Profile */}
          {pitcherInfo && (
            <div className="pc-back-section">
              <div className="pc-back-label">
                {type === 'pitcher' ? 'Season Profile' : `vs ${pitcherInfo.name || 'Starter'}`}
              </div>
              {pitcherInfo.profile ? (
                <>
                  <div className="pc-back-stats">
                    <div className="pc-back-stat"><span className="pc-back-stat-val">{pitcherInfo.profile.era}</span><span className="pc-back-stat-key">ERA</span></div>
                    <div className="pc-back-stat"><span className="pc-back-stat-val">{pitcherInfo.profile.whip}</span><span className="pc-back-stat-key">WHIP</span></div>
                    <div className="pc-back-stat"><span className="pc-back-stat-val">{pitcherInfo.profile.k_per_9}</span><span className="pc-back-stat-key">K/9</span></div>
                    <div className="pc-back-stat"><span className="pc-back-stat-val">{pitcherInfo.profile.ip_per_g}</span><span className="pc-back-stat-key">IP/G</span></div>
                    <div className="pc-back-stat"><span className="pc-back-stat-val">{pitcherInfo.profile.starts}</span><span className="pc-back-stat-key">GS</span></div>
                  </div>

                  {pitcherInfo.profile.recent?.length > 0 && (
                    <table className="pc-back-table">
                      <thead>
                        <tr><th>Date</th><th>Opp</th><th>IP</th><th>K</th><th>ER</th><th>ERA</th></tr>
                      </thead>
                      <tbody>
                        {pitcherInfo.profile.recent.slice(0, 4).map((g, i) => (
                          <tr key={i}>
                            <td>{fmtDate(g.date)}</td><td>{g.opp}</td><td>{g.ip}</td>
                            <td className="pc-back-k">{g.so}</td><td>{g.er}</td><td>{g.era}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              ) : (
                <div className="pc-back-muted">Profile unavailable</div>
              )}
            </div>
          )}

          {/* Team Batting Context */}
          {teamBatting && (
            <div className="pc-back-section">
              <div className="pc-back-label">
                {type === 'pitcher' ? 'Opponent Batting' : 'Team Batting'}
              </div>
              <div className="pc-back-stats">
                <div className="pc-back-stat"><span className="pc-back-stat-val">{teamBatting.ba}</span><span className="pc-back-stat-key">BA</span></div>
                <div className="pc-back-stat"><span className="pc-back-stat-val">{teamBatting.ops}</span><span className="pc-back-stat-key">OPS</span></div>
                <div className="pc-back-stat"><span className="pc-back-stat-val">{teamBatting.so_per_g}</span><span className="pc-back-stat-key">K/G</span></div>
                <div className="pc-back-stat"><span className="pc-back-stat-val">{teamBatting.r_per_g}</span><span className="pc-back-stat-key">R/G</span></div>
                <div className="pc-back-stat"><span className="pc-back-stat-val">{teamBatting.hr_per_g}</span><span className="pc-back-stat-key">HR/G</span></div>
              </div>
            </div>
          )}

          {/* Weather & Park */}
          <div className="pc-back-context">
            {weather && (
              <div className="pc-back-pill">
                {weather.condition} · {Math.round(weather.temp_f)}°F
                {weather.precip_pct > 0 && ` · 🌧 ${weather.precip_pct}%`}
              </div>
            )}
            {parkDetail && (
              <div className="pc-back-pill">
                {parkDetail.stadium} · R×{parkDetail.r_factor} · HR×{parkDetail.hr_factor}
              </div>
            )}
          </div>

          <div className="pc-back-hint">tap to flip back</div>
        </div>
      </div>
    </div>
  );
}

/* ============== Hit Rate Circle ============== */
function HitCircle({ label, value, highlight, count, active, onClick }) {
  const level = hitLevel(value);
  return (
    <div className={`pc-circle-wrap ${highlight ? 'highlight' : ''} ${active ? 'active' : ''}`}
      onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="pc-circle" data-level={level}>
        <span className="pc-circle-value">{value != null ? `${Math.round(value)}%` : '—'}</span>
      </div>
      <div className="pc-circle-label">{label}</div>
      {count && <div className="pc-circle-count">{count}</div>}
    </div>
  );
}

/* ============== Highcharts Game Log Bar Chart ============== */
function GameChart({ values, dates, opps, line }) {
  const basePath = import.meta.env.BASE_URL || '/';
  const colors = values.map(v =>
    v > line ? '#22c55e' : v === line ? '#64748b' : '#ef4444'
  );

  const options = {
    chart: {
      type: 'column', backgroundColor: 'transparent', height: 180,
      spacing: [5, 0, 0, 0], style: { fontFamily: 'inherit' },
    },
    title: { text: null },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      categories: dates,
      labels: {
        useHTML: true,
        rotation: 0,
        style: { color: '#64748b', fontSize: '9px', textAlign: 'center' },
        formatter: function () {
          const idx = this.pos;
          const opp = (opps || [])[idx] || '';
          const logo = TEAM_LOGOS[opp];
          const logoHtml = logo
            ? `<img src="${basePath}${logo}" style="width:14px;height:14px;display:block;margin:0 auto 1px;" />`
            : '';
          return `<div style="text-align:center;line-height:1.1">${logoHtml}<span>${this.value}</span></div>`;
        },
      },
      lineColor: '#1e293b', tickLength: 0,
    },
    yAxis: {
      title: { text: null }, gridLineColor: '#1e293b', labels: { enabled: false },
      plotLines: [{
        value: line, color: '#a78bfa', width: 2, dashStyle: 'Dash', zIndex: 5,
        label: { text: `Line: ${line}`, align: 'right', style: { color: '#a78bfa', fontSize: '9px', fontWeight: '700' }, y: -2 },
      }],
    },
    plotOptions: {
      column: {
        borderWidth: 0, borderRadius: 3, colorByPoint: true, colors,
        dataLabels: { enabled: true, style: { color: '#e2e8f0', fontSize: '10px', fontWeight: '700', textOutline: 'none' }, format: '{y}' },
      },
    },
    tooltip: {
      backgroundColor: '#1a1a2e', borderColor: '#334155',
      style: { color: '#e2e8f0', fontSize: '11px' },
      formatter: function () {
        const v = this.y;
        const st = v > line ? 'OVER ✅' : v === line ? 'PUSH' : 'UNDER ❌';
        return `<b>${this.x}</b><br/>Value: <b>${v}</b><br/>${st}`;
      },
    },
    series: [{ data: values }],
  };

  return (
    <div className="pc-chart">
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  );
}

/* ============== Helpers ============== */
function formatUpdatedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  return `${diffH}h ago`;
}

function hitLevel(v) {
  if (v >= 75) return 'hot';
  if (v >= 50) return 'warm';
  if (v >= 30) return 'cool';
  return 'cold';
}

function shortStat(s) {
  return ({
    'Pitcher Strikeouts': 'STRIKEOUTS', 'Pitching Outs': 'PITCHING OUTS',
    'Hits+Runs+RBIs': 'HITS+RUNS+RBIS', 'Total Bases': 'TOTAL BASES',
    'Hitter Strikeouts': 'HITTER STRIKEOUTS',
  })[s] || s.toUpperCase();
}

function fmtDate(d) {
  if (!d) return '';
  if (d.includes('/')) { const [m, day] = d.split('/'); return `${m}/${day}`; }
  const p = d.split('-'); return `${p[1]}/${p[2]}`;
}

function normalizePlayerName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bse woong\b/g, 'se woong')
    .replace(/\bseong han\b/g, 'seong han')
    .trim();
}

function playerInitials(name) {
  const parts = String(name || '').split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?';
}

export default PlayerPropsUI;
