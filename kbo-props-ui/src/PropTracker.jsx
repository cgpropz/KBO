import { useState, useEffect, useMemo } from 'react';
import './PropTracker.css';

const TEAMS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
};

const STAT_OPTIONS = ['All', 'HRR', 'TB', 'K', 'HA', 'OUTS'];
const TYPE_OPTIONS = ['All', 'OVER', 'UNDER', 'SLIGHT OV', 'SLIGHT UN'];
const RESULT_OPTIONS = ['All', 'HIT', 'MISS'];
const ROLE_OPTIONS = ['All', 'pitcher', 'batter'];
const DATE_RANGES = ['1D', '7D', '30D', '90D', 'All'];

const debugLog = (...args) => { if (typeof window !== 'undefined') console.log('[PropTracker]', ...args); };

function PropTracker() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('graded');
  const [playerSearch, setPlayerSearch] = useState('');
  const [statFilter, setStatFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [resultFilter, setResultFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [dateRange, setDateRange] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minHitPct, setMinHitPct] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    debugLog('Fetching graded props history...');
    fetch('/data/graded_props_history.json')
      .then(r => r.json())
      .then(d => {
        debugLog('Data loaded:', { pending: d?.pending?.length || 0, graded: d?.graded?.length || 0, generatedAt: d?.generated_at });
        setData(d); setLoading(false);
      })
      .catch((err) => {
        debugLog('Error loading data:', err.message);
        setLoading(false);
      });
  }, []);

  const filteredGraded = useMemo(() => {
    if (!data?.graded) return [];
    let items = [...data.graded];
    if (dateRange !== 'All') {
      const now = new Date();
      const days = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 }[dateRange] || 9999;
      const cutoff = new Date(now - days * 86400000).toISOString().slice(0, 10);
      items = items.filter(g => g.date >= cutoff);
    }
    if (dateFrom) items = items.filter(g => g.date >= dateFrom);
    if (dateTo) items = items.filter(g => g.date <= dateTo);
    if (playerSearch) {
      const q = playerSearch.toLowerCase();
      items = items.filter(g => g.player.toLowerCase().includes(q));
    }
    if (statFilter !== 'All') items = items.filter(g => g.stat === statFilter);
    if (typeFilter !== 'All') items = items.filter(g => g.type === typeFilter);
    if (resultFilter !== 'All') items = items.filter(g => g.result === resultFilter);
    if (roleFilter !== 'All') items = items.filter(g => g.role === roleFilter);
    if (minHitPct) {
      const min = parseFloat(minHitPct);
      if (!isNaN(min)) items = items.filter(g => g.hit_pct >= min);
    }
    items.sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return items;
  }, [data, dateRange, dateFrom, dateTo, playerSearch, statFilter, typeFilter, resultFilter, roleFilter, minHitPct, sortField, sortDir]);

  const filteredPending = useMemo(() => {
    if (!data?.pending) return [];
    let items = [...data.pending];
    if (playerSearch) {
      const q = playerSearch.toLowerCase();
      items = items.filter(g => g.player.toLowerCase().includes(q));
    }
    if (statFilter !== 'All') items = items.filter(g => g.stat === statFilter);
    if (typeFilter !== 'All') items = items.filter(g => g.type === typeFilter);
    if (roleFilter !== 'All') items = items.filter(g => g.role === roleFilter);
    return items;
  }, [data, playerSearch, statFilter, typeFilter, roleFilter]);

  const summary = useMemo(() => {
    const resolved = filteredGraded.filter(g => g.result === 'HIT' || g.result === 'MISS');
    const hits = resolved.filter(g => g.result === 'HIT').length;
    const misses = resolved.length - hits;
    const total = resolved.length;
    const overE = resolved.filter(g => g.type === 'OVER' || g.type === 'SLIGHT OV');
    const underE = resolved.filter(g => g.type === 'UNDER' || g.type === 'SLIGHT UN');
    const overHits = overE.filter(g => g.result === 'HIT').length;
    const underHits = underE.filter(g => g.result === 'HIT').length;
    const edges = filteredGraded.filter(g => g.edge != null).map(g => g.edge);
    const byStat = {};
    for (const g of resolved) {
      if (!byStat[g.stat]) byStat[g.stat] = { hits: 0, misses: 0 };
      if (g.result === 'HIT') byStat[g.stat].hits++; else byStat[g.stat].misses++;
    }
    for (const s in byStat) {
      const t = byStat[s].hits + byStat[s].misses;
      byStat[s].total = t;
      byStat[s].hit_rate = t > 0 ? (byStat[s].hits / t * 100).toFixed(1) : '0.0';
    }
    const byRole = {};
    for (const g of resolved) {
      if (!byRole[g.role]) byRole[g.role] = { hits: 0, misses: 0 };
      if (g.result === 'HIT') byRole[g.role].hits++; else byRole[g.role].misses++;
    }
    for (const r in byRole) {
      const t = byRole[r].hits + byRole[r].misses;
      byRole[r].total = t;
      byRole[r].hit_rate = t > 0 ? (byRole[r].hits / t * 100).toFixed(1) : '0.0';
    }
    return {
      hits, misses, total,
      overall: total > 0 ? (hits / total * 100).toFixed(1) : '0.0',
      overRate: overE.length > 0 ? (overHits / overE.length * 100).toFixed(1) : '0.0',
      underRate: underE.length > 0 ? (underHits / underE.length * 100).toFixed(1) : '0.0',
      overVol: overE.length, underVol: underE.length,
      avgEdge: edges.length > 0 ? (edges.reduce((s, e) => s + e, 0) / edges.length).toFixed(1) : '0.0',
      byStat, byRole,
    };
  }, [filteredGraded]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };
  const sortIcon = (field) => {
    if (sortField !== field) return <span className="gt-sort dim">&#8693;</span>;
    return <span className="gt-sort active">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  };
  const resetFilters = () => {
    setPlayerSearch(''); setStatFilter('All'); setTypeFilter('All');
    setResultFilter('All'); setRoleFilter('All'); setDateRange('All');
    setDateFrom(''); setDateTo(''); setMinHitPct('');
  };

  if (loading) return <div className="gt-container"><div className="gt-loading">Loading tracker data...</div></div>;
  if (!data) return <div className="gt-container"><div className="gt-loading">No grading data available.</div></div>;

  const pendingCount = data.pending?.length || 0;
  const gradedCount = filteredGraded.length;

  return (
    <div className="gt-container">
      <header className="gt-header">
        <h1 className="gt-title">Model Results</h1>
        <span className="gt-subtitle">Automated prop grading &amp; analytics</span>
      </header>
      <div className="gt-tabs">
        <button className={'gt-tab ' + (tab === 'pending' ? 'active' : '')} onClick={() => setTab('pending')}>
          Pending <span className="gt-tab-count">{pendingCount}</span>
        </button>
        <button className={'gt-tab ' + (tab === 'graded' ? 'active' : '')} onClick={() => setTab('graded')}>
          Graded <span className="gt-tab-count">{gradedCount}</span>
        </button>
        <button className={'gt-tab ' + (tab === 'analytics' ? 'active' : '')} onClick={() => setTab('analytics')}>
          Analytics
        </button>
      </div>
      <div className="gt-date-bar">
        {DATE_RANGES.map(r => (
          <button key={r} className={'gt-date-btn ' + (dateRange === r ? 'active' : '')}
            onClick={() => { setDateRange(r); setDateFrom(''); setDateTo(''); }}>{r}</button>
        ))}
      </div>
      <div className="gt-filter-bar">
        <input className="gt-filter-input gt-player-search" type="text" placeholder="Player"
          value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} />
        <select className="gt-filter-select" value={statFilter} onChange={e => setStatFilter(e.target.value)}>
          {STAT_OPTIONS.map(o => <option key={o} value={o}>{o === 'All' ? 'Stat: All' : o}</option>)}
        </select>
        <select className="gt-filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          {TYPE_OPTIONS.map(o => <option key={o} value={o}>{o === 'All' ? 'Type: All' : o}</option>)}
        </select>
        <select className="gt-filter-select" value={resultFilter} onChange={e => setResultFilter(e.target.value)}>
          {RESULT_OPTIONS.map(o => <option key={o} value={o}>{o === 'All' ? 'Result: All' : o}</option>)}
        </select>
        <select className="gt-filter-select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          {ROLE_OPTIONS.map(o => <option key={o} value={o}>{o === 'All' ? 'Role: All' : o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
        <input className="gt-filter-input gt-min-pct" type="number" placeholder="Min%"
          value={minHitPct} onChange={e => setMinHitPct(e.target.value)} min="0" max="100" />
        <div className="gt-date-inputs">
          <span className="gt-date-label">From:</span>
          <input type="date" className="gt-filter-date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setDateRange('All'); }} />
          <span className="gt-date-label">To:</span>
          <input type="date" className="gt-filter-date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setDateRange('All'); }} />
        </div>
        <button className="gt-reset-btn" onClick={resetFilters}>Reset</button>
      </div>

      {tab === 'pending' && (
        <div className="gt-section">
          <div className="gt-section-header"><span className="gt-section-count">{filteredPending.length} Pending Props</span></div>
          <div className="gt-table-wrap">
            <table className="gt-table">
              <thead><tr>
                <th>Player</th><th>Role</th><th>Stat</th><th className="col-num">Line</th>
                <th>Type</th><th className="col-num">Hit%</th><th className="col-num">Proj</th>
                <th className="col-num">Edge</th><th>Opponent</th><th>Venue</th>
              </tr></thead>
              <tbody>
                {filteredPending.length === 0 && <tr><td colSpan="10" className="gt-empty">No pending props match your filters.</td></tr>}
                {filteredPending.map((p, i) => (
                  <tr key={i} className="gt-row">
                    <td className="gt-player">{p.player}</td>
                    <td><span className={'gt-role-tag ' + p.role}>{p.role === 'pitcher' ? 'Pitcher' : 'Batter'}</span></td>
                    <td><span className="gt-stat-tag">{p.stat}</span></td>
                    <td className="col-num mono">{p.line}</td>
                    <td><TypeBadge type={p.type} /></td>
                    <td className="col-num mono">{p.hit_pct != null ? Number(p.hit_pct).toFixed(1) + '%' : '\u2014'}</td>
                    <td className="col-num mono">{p.projection != null ? Number(p.projection).toFixed(1) : '\u2014'}</td>
                    <td className={'col-num mono ' + (p.edge > 0 ? 'gt-green' : p.edge < 0 ? 'gt-red' : '')}>
                      {p.edge != null ? (p.edge > 0 ? '+' : '') + Number(p.edge).toFixed(2) : '\u2014'}
                    </td>
                    <td><span style={{ color: TEAMS[p.opponent] || '#999' }}>{p.opponent}</span></td>
                    <td className="gt-venue">{p.venue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'graded' && (
        <div className="gt-section">
          <div className="gt-section-header">
            <span className="gt-section-count">{gradedCount} Graded Props</span>
            <span className="gt-section-rate">
              Hit Rate: <strong className="gt-green">{summary.overall}%</strong>
              <span className="gt-section-detail"> ({summary.hits} HIT / {summary.misses} MISS)</span>
            </span>
          </div>
          <div className="gt-table-wrap">
            <table className="gt-table">
              <thead><tr>
                <th onClick={() => handleSort('player')}>Player {sortIcon('player')}</th>
                <th onClick={() => handleSort('role')}>Role {sortIcon('role')}</th>
                <th onClick={() => handleSort('stat')}>Stat {sortIcon('stat')}</th>
                <th className="col-num" onClick={() => handleSort('line')}>Line {sortIcon('line')}</th>
                <th onClick={() => handleSort('type')}>Type {sortIcon('type')}</th>
                <th className="col-num" onClick={() => handleSort('hit_pct')}>Hit% {sortIcon('hit_pct')}</th>
                <th className="col-num" onClick={() => handleSort('projection')}>Proj {sortIcon('projection')}</th>
                <th className="col-num" onClick={() => handleSort('actual')}>Actual {sortIcon('actual')}</th>
                <th onClick={() => handleSort('result')}>Result {sortIcon('result')}</th>
                <th onClick={() => handleSort('date')}>Game Date {sortIcon('date')}</th>
                <th>Opponent</th>
              </tr></thead>
              <tbody>
                {filteredGraded.length === 0 && <tr><td colSpan="11" className="gt-empty">No graded props match your filters.</td></tr>}
                {filteredGraded.map((g, i) => (
                  <tr key={i} className={'gt-row gt-row-' + g.result.toLowerCase()}>
                    <td className="gt-player">{g.player}</td>
                    <td><span className={'gt-role-tag ' + g.role}>{g.role === 'pitcher' ? 'Pitcher' : 'Batter'}</span></td>
                    <td><span className="gt-stat-tag">{g.stat}</span></td>
                    <td className="col-num mono">{g.line}</td>
                    <td><TypeBadge type={g.type} /></td>
                    <td className="col-num mono">{g.hit_pct != null ? Number(g.hit_pct).toFixed(1) + '%' : '\u2014'}</td>
                    <td className="col-num mono">{g.projection != null ? Number(g.projection).toFixed(1) : '\u2014'}</td>
                    <td className={'col-num mono ' + (g.actual > g.line ? 'gt-green' : g.actual < g.line ? 'gt-red' : 'gt-yellow')}>
                      {g.actual}
                    </td>
                    <td><ResultBadge result={g.result} /></td>
                    <td className="gt-date">{g.date}</td>
                    <td><span style={{ color: TEAMS[g.opponent] || '#999' }}>{g.opponent}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="gt-section">
          <div className="gt-summary-grid">
            <div className="gt-summary-card gt-card-overall">
              <span className="gt-card-label">OVERALL HIT RATE</span>
              <span className="gt-card-value gt-green">{summary.overall}%</span>
              <span className="gt-card-detail">{summary.hits} HIT / {summary.misses} MISS</span>
            </div>
            <div className="gt-summary-card gt-card-under">
              <span className="gt-card-label">UNDER HIT RATE</span>
              <span className="gt-card-value gt-blue">{summary.underRate}%</span>
              <span className="gt-card-detail">{summary.underVol} props ({summary.total > 0 ? (summary.underVol / summary.total * 100).toFixed(0) : 0}% of volume)</span>
            </div>
            <div className="gt-summary-card gt-card-over">
              <span className="gt-card-label">OVER HIT RATE</span>
              <span className="gt-card-value gt-gold">{summary.overRate}%</span>
              <span className="gt-card-detail">{summary.overVol} props</span>
            </div>
            <div className="gt-summary-card gt-card-edge">
              <span className="gt-card-label">AVG EDGE SIZE</span>
              <span className="gt-card-value gt-cyan">{summary.avgEdge}</span>
              <span className="gt-card-detail">projected \u2212 line average</span>
            </div>
          </div>
          <div className="gt-breakdown">
            <h3 className="gt-breakdown-title">By Prop Type</h3>
            <div className="gt-breakdown-grid">
              {Object.entries(summary.byStat).sort((a, b) => b[1].total - a[1].total).map(([stat, d]) => (
                <div key={stat} className="gt-breakdown-card">
                  <div className="gt-breakdown-header">
                    <span className="gt-stat-tag">{stat}</span>
                    <span className="gt-breakdown-count">{d.total} props</span>
                  </div>
                  <div className="gt-breakdown-bar-wrap"><div className="gt-breakdown-bar" style={{ width: d.hit_rate + '%' }} /></div>
                  <div className="gt-breakdown-stats">
                    <span className={'gt-breakdown-rate ' + (parseFloat(d.hit_rate) >= 55 ? 'gt-green' : parseFloat(d.hit_rate) < 45 ? 'gt-red' : '')}>{d.hit_rate}%</span>
                    <span className="gt-breakdown-detail">{d.hits} HIT / {d.misses} MISS</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="gt-breakdown">
            <h3 className="gt-breakdown-title">By Role</h3>
            <div className="gt-breakdown-grid">
              {Object.entries(summary.byRole).map(([role, d]) => (
                <div key={role} className="gt-breakdown-card">
                  <div className="gt-breakdown-header">
                    <span className={'gt-role-tag ' + role}>{role === 'pitcher' ? 'Pitcher' : 'Batter'}</span>
                    <span className="gt-breakdown-count">{d.total} props</span>
                  </div>
                  <div className="gt-breakdown-bar-wrap"><div className="gt-breakdown-bar" style={{ width: d.hit_rate + '%' }} /></div>
                  <div className="gt-breakdown-stats">
                    <span className={'gt-breakdown-rate ' + (parseFloat(d.hit_rate) >= 55 ? 'gt-green' : parseFloat(d.hit_rate) < 45 ? 'gt-red' : '')}>{d.hit_rate}%</span>
                    <span className="gt-breakdown-detail">{d.hits} HIT / {d.misses} MISS</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="gt-breakdown">
            <h3 className="gt-breakdown-title">By Recommendation Type</h3>
            <div className="gt-breakdown-grid">
              {(() => {
                const byType = {};
                for (const g of filteredGraded.filter(g => g.result === 'HIT' || g.result === 'MISS')) {
                  if (!byType[g.type]) byType[g.type] = { hits: 0, misses: 0 };
                  if (g.result === 'HIT') byType[g.type].hits++; else byType[g.type].misses++;
                }
                return Object.entries(byType).sort((a, b) => (b[1].hits + b[1].misses) - (a[1].hits + a[1].misses)).map(([type, d]) => {
                  const t = d.hits + d.misses;
                  const rate = t > 0 ? (d.hits / t * 100).toFixed(1) : '0.0';
                  return (
                    <div key={type} className="gt-breakdown-card">
                      <div className="gt-breakdown-header">
                        <TypeBadge type={type} />
                        <span className="gt-breakdown-count">{t} props</span>
                      </div>
                      <div className="gt-breakdown-bar-wrap"><div className="gt-breakdown-bar" style={{ width: rate + '%' }} /></div>
                      <div className="gt-breakdown-stats">
                        <span className={'gt-breakdown-rate ' + (parseFloat(rate) >= 55 ? 'gt-green' : parseFloat(rate) < 45 ? 'gt-red' : '')}>{rate}%</span>
                        <span className="gt-breakdown-detail">{d.hits} HIT / {d.misses} MISS</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }) {
  const cls = type === 'OVER' ? 'type-over' : type === 'UNDER' ? 'type-under' :
    type === 'SLIGHT OV' ? 'type-slight-ov' : 'type-slight-un';
  return <span className={'gt-type-badge ' + cls}>{type}</span>;
}

function ResultBadge({ result }) {
  if (result === 'HIT') return <span className="gt-result-badge gt-result-hit">{'\u2713'} HIT</span>;
  if (result === 'MISS') return <span className="gt-result-badge gt-result-miss">{'\u2715'} MISS</span>;
  return <span className="gt-result-badge gt-result-hit">{'\u2713'} HIT</span>;
}

export default PropTracker;
