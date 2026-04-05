import { useState, useEffect } from 'react';
import './PitcherRankings.css';
import { fetchData } from './dataUrl';

const TEAMS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
};

function PitcherRankings() {
  const [data, setData] = useState(null);
  const [ppProjections, setPpProjections] = useState([]);
  const [ppOnly, setPpOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('rk');
  const [sortDir, setSortDir] = useState('asc');

  const normalizeName = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const nameSignature = (value) => normalizeName(value)
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');

  useEffect(() => {
    Promise.all([
      fetchData('pitcher_rankings.json'),
      fetchData('strikeout_projections.json').catch(() => null),
    ])
      .then(([rankings, kData]) => {
        setData(rankings);
        setPpProjections((kData?.projections || []).filter((p) => p?.line != null));
        setLoading(false);
      })
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

  const rankings = data || [];
  const byNorm = new Map(rankings.map((p) => [normalizeName(p.name), p]));
  const bySig = new Map(rankings.map((p) => [nameSignature(p.name), p]));

  const ppRows = (() => {
    const out = [];
    const seen = new Set();
    for (const pp of ppProjections) {
      const norm = normalizeName(pp.name);
      const sig = nameSignature(pp.name);
      const match = byNorm.get(norm) || bySig.get(sig);
      const projectedSoPerG = (pp.so_per_ip != null && pp.ip_per_g != null)
        ? Number((pp.so_per_ip * pp.ip_per_g).toFixed(1))
        : null;

      const base = match || {
        name: pp.name,
        team: pp.team,
        gs: null,
        rk: null,
        whip: null,
        era: null,
        k_pct: null,
        ip_per_g: null,
        baa: null,
        so_per_g: null,
        ha_per_g: null,
        wl_ratio: null,
      };

      const row = {
        ...base,
        team: base.team || pp.team,
        gs: base.gs ?? pp.games_used ?? null,
        whip: base.whip ?? pp.whip ?? null,
        ip_per_g: base.ip_per_g ?? pp.ip_per_g ?? null,
        so_per_g: base.so_per_g ?? projectedSoPerG,
      };

      const key = `${normalizeName(row.name)}@@${row.team || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  })();

  const visibleRows = ppOnly ? ppRows : rankings;

  const sorted = [...visibleRows].sort((a, b) => {
    let aV = a[sortField], bV = b[sortField];
    if (aV == null) return 1;
    if (bV == null) return -1;
    if (typeof aV === 'string') return sortDir === 'asc' ? aV.localeCompare(bV) : bV.localeCompare(aV);
    return sortDir === 'asc' ? aV - bV : bV - aV;
  });

  // Compute min/max for color scaling
  const vals = (key) => visibleRows.map(p => p[key]).filter(v => v != null);
  const rangeFor = (key) => {
    const arr = vals(key);
    if (!arr.length) return { min: 0, max: 1 };
    return { min: Math.min(...arr), max: Math.max(...arr) };
  };
  const soRange = rangeFor('so_per_g');
  const haRange = rangeFor('ha_per_g');
  const wlRange = rangeFor('wl_ratio');
  const eraRange = rangeFor('era');
  const whipRange = rangeFor('whip');
  const kPctRange = rangeFor('k_pct');

  const divergingBg = (val, range, lowIsGreen = true) => {
    if (val == null) return {};
    const span = (range.max - range.min) || 1;
    const midpoint = range.min + span / 2;

    // Map to [-1, 1], where -1 is low end and +1 is high end.
    let t = ((val - midpoint) / (span / 2));
    t = Math.max(-1, Math.min(1, t));

    // If low should be green, flip direction so low -> green and high -> red.
    const score = lowIsGreen ? -t : t;

    // Keep midpoint visually neutral.
    if (Math.abs(score) < 0.12) {
      return { backgroundColor: 'rgba(148, 163, 184, 0.12)' };
    }

    if (score > 0) {
      return { backgroundColor: `rgba(34, 197, 94, ${Math.min(0.45, 0.12 + score * 0.28).toFixed(2)})` };
    }
    return { backgroundColor: `rgba(239, 68, 68, ${Math.min(0.45, 0.12 + Math.abs(score) * 0.28).toFixed(2)})` };
  };

  const eraBg = (val) => divergingBg(val, eraRange, true); // low ERA green, midpoint neutral, high ERA red
  const whipBg = (val) => divergingBg(val, whipRange, true); // low WHIP green, midpoint neutral, high WHIP red
  const kPctBg = (val) => divergingBg(val, kPctRange, false); // low K% red, midpoint neutral, high K% green

  const cellBg = (val, range) => {
    if (val == null) return {};
    const t = (val - range.min) / ((range.max - range.min) || 1);
    return { backgroundColor: `rgba(34, 197, 94, ${(Math.max(0, Math.min(1, t)) * 0.35).toFixed(2)})` };
  };

  const fmt = (val, digits) => (val == null ? '—' : Number(val).toFixed(digits));

  return (
    <div className="rk-container">
      <header className="rk-header">
        <h1 className="rk-title">KBO Pitcher Rankings</h1>
        <div className="rk-toolbar">
          <span className="rk-chip">Season 2026</span>
          <button
            className={`rk-chip rk-chip-btn ${ppOnly ? 'active' : ''}`}
            onClick={() => setPpOnly(v => !v)}
          >
            {ppOnly ? 'PrizePicks Pitchers: ON' : 'PrizePicks Pitchers: OFF'}
          </button>
          <span className="rk-chip rk-chip-muted">Rows: {sorted.length}</span>
        </div>
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
                <tr key={`${p.name}-${p.team}-${i}`} className={`rk-row ${i % 2 === 0 ? 'rk-row-even' : 'rk-row-odd'}`}>
                  <td className="col-num mono">{p.gs ?? '—'}</td>
                  <td className="col-num mono rk-rank">{p.rk ?? '—'}</td>
                  <td className="col-player">{p.name}</td>
                  <td><span className="team-text" style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span></td>
                  <td className="col-num mono" style={whipBg(p.whip)}>{fmt(p.whip, 2)}</td>
                  <td className="col-num mono" style={eraBg(p.era)}>{fmt(p.era, 2)}</td>
                  <td className="col-num mono" style={kPctBg(p.k_pct)}>{p.k_pct == null ? '—' : `${fmt(p.k_pct, 1)}%`}</td>
                  <td className="col-num mono">{fmt(p.ip_per_g, 1)}</td>
                  <td className="col-num mono">{fmt(p.baa, 3)}</td>
                  <td className="col-num mono" style={cellBg(p.so_per_g, soRange)}>{fmt(p.so_per_g, 1)}</td>
                  <td className="col-num mono" style={cellBg(p.ha_per_g, haRange)}>{fmt(p.ha_per_g, 1)}</td>
                  <td className="col-num mono" style={cellBg(p.wl_ratio, wlRange)}>{fmt(p.wl_ratio, 3)}</td>
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
