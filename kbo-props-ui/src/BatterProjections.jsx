import { useState, useEffect } from 'react';
import './BatterProjections.css';
import { fetchData } from './dataUrl';

const TEAMS = {
  Doosan:  '#9595d3',
  Hanwha:  '#ff8c00',
  Kia:     '#ff4444',
  Kiwoom:  '#d4a76a',
  KT:      '#e0e0e0',
  LG:      '#e8557a',
  Lotte:   '#ff6666',
  NC:      '#5b9bd5',
  Samsung: '#60a5fa',
  SSG:     '#ff5555',
};

function BatterProjections() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('edge');
  const [sortDir, setSortDir] = useState('desc');
  const [propFilter, setPropFilter] = useState('all');
  const [hitRateFilter, setHitRateFilter] = useState('all');

  useEffect(() => {
    fetchData('batter_projections.json')
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return <span className="sort-icon dim">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  if (loading) {
    return (
      <div className="bp-container">
        <div className="bp-loading">
          <div className="bp-spinner" /><p>Loading batter projections...</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bp-container">
        <div className="bp-loading"><p className="bp-error">Error: {error}</p></div>
      </div>
    );
  }

  const getRateByFilter = (p) => {
    if (hitRateFilter === 'l5') return p.hit_rate_l5;
    if (hitRateFilter === 'l10') return p.hit_rate_l10;
    if (hitRateFilter === 'full') return p.hit_rate_full;
    return null;
  };

  const filtered = data.projections.filter((p) => {
    if (propFilter !== 'all' && p.prop !== propFilter) return false;
    const selectedRate = getRateByFilter(p);
    if (selectedRate == null) return true;
    return selectedRate >= 50;
  });

  const projections = [...filtered].sort((a, b) => {
    let aVal = a[sortField], bVal = b[sortField];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const getValClass = (rec) => {
    if (rec === 'OVER') return 'val-over';
    if (rec === 'UNDER') return 'val-under';
    if (rec === 'NO DATA') return 'val-nodata';
    return 'val-push';
  };

  return (
    <div className="bp-container">
      <header className="bp-header">
        <h1 className="bp-title">🇰🇷 🏏 KBO Batter Projections 🏏 🇰🇷</h1>
        <div className="bp-filter-bar">
          {['all', 'Hits+Runs+RBIs', 'Total Bases'].map(f => (
            <button
              key={f}
              className={`bp-filter-btn ${propFilter === f ? 'active' : ''}`}
              onClick={() => setPropFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'Hits+Runs+RBIs' ? 'H+R+RBI' : 'Total Bases'}
            </button>
          ))}

          <select
            className="bp-hitrate-select"
            value={hitRateFilter}
            onChange={(e) => setHitRateFilter(e.target.value)}
            title="Filter by hit-rate window"
          >
            <option value="all">Hit Rate: All</option>
            <option value="l5">Hit Rate: L5 ≥ 50%</option>
            <option value="l10">Hit Rate: L10 ≥ 50%</option>
            <option value="full">Hit Rate: FULL ≥ 50%</option>
          </select>
        </div>
      </header>

      <main className="bp-main">
        <div className="bp-table-wrap">
          <table className="bp-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')}>Player {sortIcon('name')}</th>
                <th onClick={() => handleSort('team')}>Team {sortIcon('team')}</th>
                <th onClick={() => handleSort('opponent')}>Matchup {sortIcon('opponent')}</th>
                <th onClick={() => handleSort('opp_pitcher')}>Opp Pitcher {sortIcon('opp_pitcher')}</th>
                <th onClick={() => handleSort('opp_pitcher_whip')} className="col-num">WHIP {sortIcon('opp_pitcher_whip')}</th>
                <th onClick={() => handleSort('prop')}>Prop {sortIcon('prop')}</th>
                <th onClick={() => handleSort('line')} className="col-num"><span className="pp-icon">P</span> {sortIcon('line')}</th>
                <th onClick={() => handleSort('avg_per_g')} className="col-num">Avg/G {sortIcon('avg_per_g')}</th>
                <th onClick={() => handleSort('hit_rate_l5')} className="col-num">L5 {sortIcon('hit_rate_l5')}</th>
                <th onClick={() => handleSort('hit_rate_l10')} className="col-num">L10 {sortIcon('hit_rate_l10')}</th>
                <th onClick={() => handleSort('hit_rate_full')} className="col-num">FULL {sortIcon('hit_rate_full')}</th>
                <th onClick={() => handleSort('projection')} className="col-num">Projection {sortIcon('projection')}</th>
                <th onClick={() => handleSort('rating')} className="col-num">Rating {sortIcon('rating')}</th>
                <th onClick={() => handleSort('edge')} className="col-num">Variance {sortIcon('edge')}</th>
                <th onClick={() => handleSort('recommendation')} className="col-center">VALUE {sortIcon('recommendation')}</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p, i) => (
                <tr key={i} className="bp-row">
                  <td className="col-player">{p.name}</td>
                  <td><span className="team-text" style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span></td>
                  <td><span className="team-text" style={{ color: TEAMS[p.opponent] || '#999' }}>{p.opponent}</span></td>
                  <td className="col-player">{p.opp_pitcher || '—'}</td>
                  <td className={`col-num mono ${p.opp_pitcher_whip == null ? 'cell-na' : ''}`}>
                    {p.opp_pitcher_whip != null ? Number(p.opp_pitcher_whip).toFixed(3) : '#N/A'}
                  </td>
                  <td className="col-prop">{p.prop === 'Hits+Runs+RBIs' ? 'H+R+RBI' : 'TB'}</td>
                  <td className="col-num col-pp">
                    <span className="pp-cell"><span className="pp-icon-sm">P</span><span className="mono">{p.line != null ? p.line.toFixed(1) : '—'}</span></span>
                  </td>
                  <td className={`col-num mono ${p.avg_per_g == null ? 'cell-na' : ''}`}>
                    {p.avg_per_g != null ? p.avg_per_g.toFixed(2) : '#N/A'}
                  </td>
                  <td className={`col-num mono ${p.hit_rate_l5 == null ? 'cell-na' : ''}`}>
                    {p.hit_rate_l5 != null ? `${p.hit_rate_l5.toFixed(1)}%` : '#N/A'}
                  </td>
                  <td className={`col-num mono ${p.hit_rate_l10 == null ? 'cell-na' : ''}`}>
                    {p.hit_rate_l10 != null ? `${p.hit_rate_l10.toFixed(1)}%` : '#N/A'}
                  </td>
                  <td className={`col-num mono ${p.hit_rate_full == null ? 'cell-na' : ''}`}>
                    {p.hit_rate_full != null ? `${p.hit_rate_full.toFixed(1)}%` : '#N/A'}
                  </td>
                  <td className={`col-num mono ${p.projection == null ? 'cell-na' : 'col-projection'}`}>
                    {p.projection != null ? p.projection.toFixed(2) : '#N/A'}
                  </td>
                  <td className={`col-num mono ${p.rating != null ? (p.rating >= 55 ? 'rate-high' : p.rating < 45 ? 'rate-low' : '') : ''}`}>
                    {p.rating != null ? p.rating.toFixed(1) : ''}
                  </td>
                  <td className={`col-num mono ${p.edge != null ? (p.edge > 0 ? 'var-pos' : p.edge < -0.3 ? 'var-neg' : '') : 'cell-na'}`}>
                    {p.edge != null ? p.edge.toFixed(2) : '#N/A'}
                  </td>
                  <td className="col-center">
                    <span className={`val-badge ${getValClass(p.recommendation)}`}>{p.recommendation}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom panels */}
        <div className="bp-bottom-panels">
          <div className="bp-panel bp-legend">
            <h3 className="bp-panel-title">LEGEND</h3>
            <div className="bp-legend-items">
              <div className="bp-legend-item"><span className="val-badge val-over">OVER</span><span>Proj &gt; Line + 0.3</span></div>
              <div className="bp-legend-item"><span className="val-badge val-under">UNDER</span><span>Proj &lt; Line - 0.3</span></div>
              <div className="bp-legend-item"><span className="val-badge val-push">PUSH</span><span>Within ±0.3</span></div>
              <div className="bp-legend-item"><span className="val-badge val-nodata">NO DATA</span><span>No game logs</span></div>
            </div>
          </div>

          <div className="bp-panel bp-team-rates">
            <h3 className="bp-panel-title">TEAM RATES <span className="bp-panel-subtitle">(per game)</span></h3>
            <div className="bp-team-grid">
              {data.team_batting && Object.entries(data.team_batting)
                .sort((a, b) => {
                  const key = propFilter === 'Total Bases' ? 'tb_per_g' : 'hrr_per_g';
                  return b[1][key] - a[1][key];
                })
                .map(([team, rates]) => {
                  const rate = propFilter === 'Total Bases' ? rates.tb_per_g : rates.hrr_per_g;
                  const label = propFilter === 'Total Bases' ? 'TB/G' : 'HRR/G';
                  return (
                    <div key={team} className="bp-team-card">
                      <span className="bp-team-name" style={{ color: TEAMS[team] || '#999' }}>{team}</span>
                      <span className="bp-team-rate">{rate.toFixed(1)} <small style={{opacity:0.5}}>{label}</small></span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <div className="bp-formula-bar">
          <span className="bp-formula-icon">ƒ</span>
          {propFilter === 'Total Bases'
            ? <code>TB/G × (Opp Team TB/G ÷ League Avg TB/G)</code>
            : <code>HRR/G × (Opp Team HRR/G ÷ League Avg HRR/G)</code>
          }
        </div>
      </main>
    </div>
  );
}

export default BatterProjections;
