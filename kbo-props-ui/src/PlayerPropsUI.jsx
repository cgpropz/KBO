import React, { useState, useEffect, useMemo } from 'react';
import './PlayerPropsUI.css';
import { dataUrl } from './dataUrl';

const TEAMS = {
  Doosan: '#131230', Hanwha: '#FF6600', Lotte: '#041E42',
  Kia: '#EA0029', Kiwoom: '#570514', LG: '#C30452',
  KT: '#000000', NC: '#315288', Samsung: '#074CA1', SSG: '#CE0E2D',
};

const PlayerPropsUI = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('hit_rate');
  const [expandedCard, setExpandedCard] = useState(null);

  useEffect(() => {
    fetch(dataUrl('prizepicks_props.json'))
      .then(res => { if (!res.ok) throw new Error('Failed to load'); return res.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const cards = useMemo(() => {
    if (!data?.cards) return [];
    let filtered = data.cards;

    if (filterType !== 'all') {
      filtered = filtered.filter(c => c.type === filterType);
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.team.toLowerCase().includes(q) ||
        c.opponent.toLowerCase().includes(q)
      );
    }

    filtered = [...filtered].sort((a, b) => {
      const bestHr = c => Math.max(...c.props.map(p => p.hit_rate_all), 0);
      const bestEdge = c => Math.max(...c.props.map(p => (p.avg || 0) - p.line), 0);
      if (sortBy === 'hit_rate') return bestHr(b) - bestHr(a);
      if (sortBy === 'edge') return bestEdge(b) - bestEdge(a);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });

    return filtered;
  }, [data, filterType, searchTerm, sortBy]);

  if (loading) {
    return (
      <div className="pp-container">
        <div className="pp-loading"><div className="pp-spinner" /><p>Loading props...</p></div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="pp-container">
        <div className="pp-loading"><p style={{ color: '#ef476f' }}>Error: {error}</p></div>
      </div>
    );
  }

  return (
    <div className="pp-container">
      {/* Header */}
      <div className="pp-header">
        <div>
          <h1 className="pp-title">Player Props</h1>
          <p className="pp-subtitle">{data.total_props} PrizePicks lines with game log hit rates</p>
        </div>
      </div>

      {/* Controls */}
      <div className="pp-controls">
        <input
          type="text"
          placeholder="Search player, team..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pp-search"
        />
        <div className="pp-filters">
          {['all', 'pitcher', 'batter'].map(t => (
            <button
              key={t}
              className={`pp-filter-btn ${filterType === t ? 'active' : ''}`}
              onClick={() => setFilterType(t)}
            >
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

      {/* Cards Grid */}
      <div className="pp-grid">
        {cards.map((card, i) => (
          <PlayerCard
            key={`${card.name}-${card.type}-${i}`}
            card={card}
            expanded={expandedCard === `${card.name}-${card.type}`}
            onToggle={() =>
              setExpandedCard(
                expandedCard === `${card.name}-${card.type}` ? null : `${card.name}-${card.type}`
              )
            }
          />
        ))}
        {cards.length === 0 && (
          <div className="pp-empty">No props match your filters.</div>
        )}
      </div>
    </div>
  );
};

/* --- Player Card ---------------------------------------- */
function PlayerCard({ card, expanded, onToggle }) {
  const teamColor = TEAMS[card.team] || '#555';
  const bestProp = card.props.reduce((a, b) => (a.hit_rate_all > b.hit_rate_all ? a : b), card.props[0]);

  return (
    <div className={`pp-card ${expanded ? 'expanded' : ''}`} onClick={onToggle}>
      {/* Card Header */}
      <div className="pp-card-top" style={{ borderLeftColor: teamColor }}>
        <div className="pp-card-identity">
          <span className={`pp-type-badge ${card.type}`}>
            {card.type === 'pitcher' ? 'P' : 'B'}
          </span>
          <div>
            <h3 className="pp-card-name">{card.name}</h3>
            <span className="pp-card-team">{card.team} vs {card.opponent}</span>
          </div>
        </div>
        <div className="pp-card-hit-badge" data-level={hitLevel(bestProp.hit_rate_all)}>
          {bestProp.hit_rate_all}%
        </div>
      </div>

      {/* Props */}
      {card.props.map((prop, pi) => (
        <PropRow key={pi} prop={prop} type={card.type} />
      ))}

      {/* Expanded: Game Log */}
      {expanded && <GameLog card={card} />}
    </div>
  );
}

/* --- Prop Row -------------------------------------------- */
function PropRow({ prop, type }) {
  const diff = prop.avg - prop.line;
  const diffSign = diff > 0 ? '+' : '';
  const rec = prop.recommendation || (diff > 0.3 ? 'OVER' : diff < -0.3 ? 'UNDER' : 'PUSH');
  const statLabel = shortStat(prop.stat);

  return (
    <div className="pp-prop-row">
      <div className="pp-prop-header">
        <span className="pp-prop-stat">{statLabel}</span>
        <span className="pp-prop-line">Line: {prop.line}</span>
        <span className="pp-prop-avg">Avg: {prop.avg}</span>
        <span className={`pp-prop-diff ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}`}>
          ({diffSign}{diff.toFixed(1)})
        </span>
        <span className={`pp-rec-badge ${rec.toLowerCase()}`}>{rec}</span>
      </div>

      {/* Hit Rate Bars */}
      <div className="pp-hr-bars">
        <HitRateBar label="Season" value={prop.hit_rate_all} count={`${prop.over}/${prop.total_games}`} />
        <HitRateBar label="L10" value={prop.hit_rate_l10} />
        <HitRateBar label="L5" value={prop.hit_rate_l5} />
      </div>

      {/* Mini Sparkline: last 10 games vs line */}
      <div className="pp-sparkline">
        {prop.recent_values.map((v, i) => (
          <div
            key={i}
            className={`pp-spark-dot ${v > prop.line ? 'over' : v === prop.line ? 'push' : 'under'}`}
            title={`Game ${i + 1}: ${v}`}
          >
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --- Hit Rate Bar ---------------------------------------- */
function HitRateBar({ label, value, count }) {
  return (
    <div className="pp-hr-bar-wrap">
      <span className="pp-hr-label">{label}</span>
      <div className="pp-hr-track">
        <div
          className="pp-hr-fill"
          style={{ width: `${value}%` }}
          data-level={hitLevel(value)}
        />
      </div>
      <span className="pp-hr-value" data-level={hitLevel(value)}>
        {value}%{count ? ` (${count})` : ''}
      </span>
    </div>
  );
}

/* --- Game Log (expanded) --------------------------------- */
function GameLog({ card }) {
  return (
    <div className="pp-gamelog" onClick={e => e.stopPropagation()}>
      <h4 className="pp-gamelog-title">Recent Game Log</h4>
      <div className="pp-gamelog-table-wrap">
        <table className="pp-gamelog-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opp</th>
              {card.type === 'pitcher' ? (
                <><th>IP</th><th>K</th><th>ER</th><th>H</th><th>BB</th><th>Outs</th></>
              ) : (
                <><th>H</th><th>R</th><th>RBI</th><th>HRR</th><th>TB</th></>
              )}
            </tr>
          </thead>
          <tbody>
            {card.games.slice(0, 10).map((g, i) => (
              <tr key={i}>
                <td className="pp-gl-date">{formatDate(g.date)}</td>
                <td>{g.opp}</td>
                {card.type === 'pitcher' ? (
                  <>
                    <td>{g.ip}</td>
                    <td className="pp-gl-highlight">{g.so}</td>
                    <td>{g.er}</td>
                    <td>{g.ha}</td>
                    <td>{g.bb}</td>
                    <td className="pp-gl-highlight">{g.outs}</td>
                  </>
                ) : (
                  <>
                    <td>{g.h}</td>
                    <td>{g.r}</td>
                    <td>{g.rbi}</td>
                    <td className="pp-gl-highlight">{g.hrr}</td>
                    <td className="pp-gl-highlight">{g.tb}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --- Helpers --------------------------------------------- */
function hitLevel(v) {
  if (v >= 70) return 'hot';
  if (v >= 50) return 'warm';
  if (v >= 30) return 'cool';
  return 'cold';
}

function shortStat(s) {
  const map = {
    'Pitcher Strikeouts': 'Strikeouts',
    'Pitching Outs': 'Outs',
    'Hits+Runs+RBIs': 'H+R+RBI',
    'Total Bases': 'Total Bases',
  };
  return map[s] || s;
}

function formatDate(d) {
  if (!d) return '';
  if (d.includes('/')) {
    const [m, day] = d.split('/');
    return `${m}/${day}`;
  }
  const [, m, day] = d.split('-');
  return `${m}/${day}`;
}

export default PlayerPropsUI;
