import { useState, useEffect } from 'react';
import './PitcherRankings.css';
import { dataUrl } from './dataUrl';

const TEAMS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
};

function PitcherRankings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('rk');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    fetch(dataUrl('pitcher_rankings.json'))
      .then(res => { if (!res.ok) throw new Error('Failed to load'); return res.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Lower is better for ERA, WHIP, BAA, HA/G; higher is better for rest
      const lowerBetter = ['era', 'whip', 'baa', 'ha_per_g', 'rk'];
      setSortDir(lowerBetter.includes(field) ? 'asc' : 'desc');
    }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return <span className="sort-icon dim">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  if (loading) {
    return <div className="rk-container"><div className="rk-loading"><div className="rk-spinner" /><p>Loading rankings...</p></div></div>;
  }
  if (error) {
    return <div className="rk-container"><div className="rk-loading"><p className="rk-error">Error: {error}</p></div></div>;
  }

  const sorted = [...data].sort((a, b) => {
    let aV = a[sortField], bV = b[sortField];
    if (aV == null) return 1;
    if (bV == null) return -1;
    if (typeof aV === 'string') return sortDir === 'asc' ? aV.localeCompare(bV) : bV.localeCompare(aV);
    return sortDir === 'asc' ? aV - bV : bV - aV;
  });

  // Compute min/max for color scaling
  const vals = (key) => data.map(p => p[key]).filter(v => v != null);
  const soRange = { min: Math.min(...vals('so_per_g')), max: Math.max(...vals('so_per_g')) };
  const haRange = { min: Math.min(...vals('ha_per_g')), max: Math.max(...vals('ha_per_g')) };
  const wlRange = { min: Math.min(...vals('wl_ratio')), max: Math.max(...vals('wl_ratio')) };
  const eraRange = { min: Math.min(...vals('era')), max: Math.max(...vals('era')) };

  const cellBg = (val, range, invert = false) => {
    if (val == null) return {};
    const t = (val - range.min) / (range.max - range.min || 1);
    const intensity = invert ? (1 - t) : t;
    return { backgroundColor: `rgba(34, 197, 94, ${(intensity * 0.35).toFixed(2)})` };
  };

  const eraBg = (val) => cellBg(val, eraRange, true); // lower ERA = greener

  return (
    <div className="rk-container">
      <header className="rk-header">
        <h1 className="rk-title">KBO Pitcher Rankings</h1>
      </header>
      <main className="rk-main">
        <div className="rk-table-wrap">
          <table className="rk-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('gs')} className="col-num">GS {sortIcon('gs')}</th>
                <th onClick={() => handleSort('rk')} className="col-num">RK {sortIcon('rk')}</th>
                <th onClick={() => handleSort('name')}>Player {sortIcon('name')}</th>
                <th onClick={() => handleSort('team')}>Team {sortIcon('team')}</th>
                <th onClick={() => handleSort('whip')} className="col-num">WHIP {sortIcon('whip')}</th>
                <th onClick={() => handleSort('era')} className="col-num">ERA {sortIcon('era')}</th>
                <th onClick={() => handleSort('k_pct')} className="col-num">K% {sortIcon('k_pct')}</th>
                <th onClick={() => handleSort('ip_per_g')} className="col-num">IP/G {sortIcon('ip_per_g')}</th>
                <th onClick={() => handleSort('baa')} className="col-num">BAA {sortIcon('baa')}</th>
                <th onClick={() => handleSort('so_per_g')} className="col-num">SO/G {sortIcon('so_per_g')}</th>
                <th onClick={() => handleSort('ha_per_g')} className="col-num">HA/G {sortIcon('ha_per_g')}</th>
                <th onClick={() => handleSort('wl_ratio')} className="col-num">W/L Ratio {sortIcon('wl_ratio')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={p.name} className={`rk-row ${i % 2 === 0 ? 'rk-row-even' : 'rk-row-odd'}`}>
                  <td className="col-num mono">{p.gs}</td>
                  <td className="col-num mono rk-rank">{p.rk}</td>
                  <td className="col-player">{p.name}</td>
                  <td><span className="team-text" style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span></td>
                  <td className="col-num mono">{p.whip.toFixed(2)}</td>
                  <td className="col-num mono" style={eraBg(p.era)}>{p.era.toFixed(2)}</td>
                  <td className="col-num mono">{p.k_pct.toFixed(1)}%</td>
                  <td className="col-num mono">{p.ip_per_g.toFixed(1)}</td>
                  <td className="col-num mono">{p.baa.toFixed(3)}</td>
                  <td className="col-num mono" style={cellBg(p.so_per_g, soRange)}>{p.so_per_g.toFixed(1)}</td>
                  <td className="col-num mono" style={cellBg(p.ha_per_g, haRange)}>{p.ha_per_g.toFixed(1)}</td>
                  <td className="col-num mono" style={cellBg(p.wl_ratio, wlRange)}>{p.wl_ratio.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

export default PitcherRankings;
