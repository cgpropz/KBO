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

/* ============== Main Component ============== */
const PlayerPropsUI = () => {
  const [data, setData] = useState(null);
  const [photos, setPhotos] = useState({});
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
    ])
      .then(([propsSnapshot, photoSnapshot]) => {
        setData(propsSnapshot.data);
        setPhotos(photoSnapshot.data || {});
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
      if (sortBy === 'hit_rate') return (b.prop.hit_rate_all || 0) - (a.prop.hit_rate_all || 0);
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
          <option value="hit_rate">Sort: Hit Rate</option>
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
          />
        ))}
        {propCards.length === 0 && <div className="pp-empty">No props match your filters.</div>}
      </div>
    </div>
  );
};

/* ============== Individual Prop Card (NBA style) ============== */
function PropCard({ card, photoUrl }) {
  const { prop, name, team, opponent, type, games, venue, park_factor } = card;
  const teamColor = TEAM_COLORS[team] || '#888';
  const oppColor = TEAM_COLORS[opponent] || '#888';
  const edge = (prop.avg || 0) - prop.line;
  const rec = prop.recommendation || (edge > 0.3 ? 'OVER' : edge < -0.3 ? 'UNDER' : 'PUSH');
  const score = prop.hit_rate_all || 0;
  const [imageFailed, setImageFailed] = useState(false);

  const recentVals = prop.recent_values || [];
  const gameDates = (games || []).slice(0, recentVals.length).map(g => fmtDate(g.date));
  const chartValues = [...recentVals].reverse();
  const chartDates = [...gameDates].reverse();

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl, name]);

  return (
    <div className="pc-card">
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
        <HitCircle label="L5" value={prop.hit_rate_l5} />
        <HitCircle label="L10" value={prop.hit_rate_l10} highlight />
        <HitCircle label="FULL" value={prop.hit_rate_all} count={`${prop.over}/${prop.total_games}`} />
      </div>

      {chartValues.length > 0 && (
        <GameChart values={chartValues} dates={chartDates} line={prop.line} />
      )}
    </div>
  );
}

/* ============== Hit Rate Circle ============== */
function HitCircle({ label, value, highlight, count }) {
  const level = hitLevel(value);
  return (
    <div className={`pc-circle-wrap ${highlight ? 'highlight' : ''}`}>
      <div className="pc-circle" data-level={level}>
        <span className="pc-circle-value">{value != null ? `${Math.round(value)}%` : '—'}</span>
      </div>
      <div className="pc-circle-label">{label}</div>
      {count && <div className="pc-circle-count">{count}</div>}
    </div>
  );
}

/* ============== Highcharts Game Log Bar Chart ============== */
function GameChart({ values, dates, line }) {
  const colors = values.map(v =>
    v > line ? '#22c55e' : v === line ? '#64748b' : '#ef4444'
  );

  const options = {
    chart: {
      type: 'column', backgroundColor: 'transparent', height: 160,
      spacing: [5, 0, 0, 0], style: { fontFamily: 'inherit' },
    },
    title: { text: null },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      categories: dates,
      labels: { style: { color: '#64748b', fontSize: '9px' }, rotation: -45 },
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
  if (v >= 70) return 'hot';
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
