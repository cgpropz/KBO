import { useState, useEffect } from 'react';
import './StrikeoutProjections.css';
import { dataUrl } from './dataUrl';

// KBO Team text colors (visible on dark backgrounds)
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

function StrikeoutProjections() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('edge');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    fetch(dataUrl('strikeout_projections.json'))
      .then(res => {
        if (!res.ok) throw new Error('Failed to load projection data');
        return res.json();
      })
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
      <div className="so-container">
        <div className="so-loading">
          <div className="so-spinner" /><p>Loading projections...</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="so-container">
        <div className="so-loading"><p className="so-error">Error: {error}</p></div>
      </div>
    );
  }

  const projections = [...data.projections].sort((a, b) => {
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
    if (rec === 'NO LINE') return 'val-noline';
    return 'val-push';
  };

  return (
    <div className="so-container">
      <header className="so-header">
        <h1 className="so-title">🇰🇷 ⚾ KBO Pitcher Projections Chart ⚾ 🇰🇷</h1>
      </header>

      <main className="so-main">

        {/* Projection table */}
        <div className="so-table-wrap">
          <table className="so-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')}>Player {sortIcon('name')}</th>
                <th onClick={() => handleSort('team')}>Team {sortIcon('team')}</th>
                <th onClick={() => handleSort('opponent')}>Matchup {sortIcon('opponent')}</th>
                <th>Prop</th>
                <th onClick={() => handleSort('line')} className="col-num"><span className="pp-icon">P</span> {sortIcon('line')}</th>
                <th onClick={() => handleSort('projection')} className="col-num">Projection {sortIcon('projection')}</th>
                <th onClick={() => handleSort('rating')} className="col-num">Rating {sortIcon('rating')}</th>
                <th onClick={() => handleSort('edge')} className="col-num">Variance {sortIcon('edge')}</th>
                <th onClick={() => handleSort('recommendation')} className="col-center">VALUE {sortIcon('recommendation')}</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p, i) => (
                <tr key={i} className="so-row">
                  <td className="col-player">{p.name}</td>
                  <td><span className="team-text" style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span></td>
                  <td><span className="team-text" style={{ color: TEAMS[p.opponent] || '#999' }}>{p.opponent}</span></td>
                  <td className="col-prop">Strikeouts</td>
                  <td className="col-num col-pp">
                    <span className="pp-cell"><span className="pp-icon-sm">P</span><span className="mono">{p.line != null ? p.line.toFixed(1) : '—'}</span></span>
                  </td>
                  <td className={`col-num mono ${p.projection == null ? 'cell-na' : 'col-projection'}`}>
                    {p.projection != null ? p.projection.toFixed(1) : '#N/A'}
                  </td>
                  <td className={`col-num mono ${p.rating != null ? (p.rating >= 55 ? 'rate-high' : p.rating < 45 ? 'rate-low' : '') : ''}`}>
                    {p.rating != null ? p.rating.toFixed(1) : ''}
                  </td>
                  <td className={`col-num mono ${p.edge != null ? (p.edge > 0 ? 'var-pos' : p.edge < -0.5 ? 'var-neg' : '') : 'cell-na'}`}>
                    {p.edge != null ? p.edge.toFixed(1) : '#N/A'}
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
        <div className="so-bottom-panels">
          <div className="so-panel so-legend">
            <h3 className="so-panel-title">Legend</h3>
            <div className="so-legend-items">
              <div className="so-legend-item"><span className="val-badge val-over">OVER</span><span>Proj &gt; Line + 0.5</span></div>
              <div className="so-legend-item"><span className="val-badge val-under">UNDER</span><span>Proj &lt; Line - 0.5</span></div>
              <div className="so-legend-item"><span className="val-badge val-push">PUSH</span><span>Within ±0.5</span></div>
              <div className="so-legend-item"><span className="val-badge val-nodata">NO DATA</span><span>No logs</span></div>
            </div>
          </div>

          <div className="so-panel so-team-rates">
            <h3 className="so-panel-title">Team K Rates <span className="so-panel-subtitle">(SO/G)</span></h3>
            <div className="so-team-grid">
              {Object.entries(data.team_so_per_g)
                .sort((a, b) => b[1] - a[1])
                .map(([team, rate]) => (
                  <div key={team} className="so-team-card">
                    <span className="so-team-name" style={{ color: TEAMS[team] || '#999' }}>{team}</span>
                    <span className="so-team-rate">{rate.toFixed(2)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="so-formula-bar">
          <span className="so-formula-icon">ƒ</span>
          <code>(SO/IP × IP/G) × Opp K/G ÷ Lg Avg K/G</code>
        </div>
      </main>
    </div>
  );
}

export default StrikeoutProjections;
