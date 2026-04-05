import { useState, useEffect, useCallback } from 'react';
import './PropTracker.css';
import { fetchData } from './dataUrl';

const TEAMS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
};

const STORAGE_KEY = 'kbo_prop_tracker';
const BANKROLL_KEY = 'kbo_bankroll';
const DEFAULT_WAGER = 10;
const DEFAULT_ODDS = -110;

function loadTracked() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}
function saveTracked(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
function loadBankroll() {
  try {
    return JSON.parse(localStorage.getItem(BANKROLL_KEY)) || { starting: 100, current: 100 };
  } catch { return { starting: 100, current: 100 }; }
}
function saveBankroll(br) {
  localStorage.setItem(BANKROLL_KEY, JSON.stringify(br));
}

function calcPayout(wager, odds) {
  if (!wager || !odds) return 0;
  if (odds > 0) return wager * (odds / 100);
  return wager * (100 / Math.abs(odds));
}

function PropTracker() {
  const [tracked, setTracked] = useState(loadTracked);
  const [projections, setProjections] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [bankroll, setBankroll] = useState(loadBankroll);
  const [editBankroll, setEditBankroll] = useState(false);
  const [brInput, setBrInput] = useState('');
  const [defaultWager, setDefaultWager] = useState(() => {
    try { return parseFloat(localStorage.getItem('kbo_default_wager')) || DEFAULT_WAGER; }
    catch { return DEFAULT_WAGER; }
  });
  const [tab, setTab] = useState('picks'); // 'picks' | 'daily'
  const [gradeResults, setGradeResults] = useState(null);
  const [grading, setGrading] = useState(false);
  const [gradeMsg, setGradeMsg] = useState('');

  useEffect(() => {
    Promise.all([
      fetchData('strikeout_projections.json').catch(() => null),
      fetchData('batter_projections.json').catch(() => null),
      fetchData('prop_results.json').catch(() => null),
    ]).then(([k, b, results]) => {
      const all = [
        ...(k?.projections || []).map(p => ({ ...p, source: 'K' })),
        ...(b?.projections || []).map(p => ({ ...p, source: 'Batter' })),
      ].filter(p => p.projection != null);
      setProjections(all);
      if (results?.stats) setGradeResults(results);
    });
  }, []);

  const persist = useCallback((next) => {
    setTracked(next);
    saveTracked(next);
  }, []);

  const updateBankroll = useCallback((br) => {
    setBankroll(br);
    saveBankroll(br);
  }, []);

  const addPick = (proj, side) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry = {
      id,
      name: proj.name,
      team: proj.team,
      opponent: proj.opponent,
      prop: proj.prop,
      line: proj.line,
      projection: proj.projection,
      edge: proj.edge,
      side,
      result: null,
      date: new Date().toISOString().slice(0, 10),
      wager: defaultWager,
      odds: DEFAULT_ODDS,
    };
    persist([entry, ...tracked]);
    setShowAdd(false);
  };

  const setResult = (id, result) => {
    const prev = tracked.find(t => t.id === id);
    const prevResult = prev?.result;
    const wager = prev?.wager || 0;
    const odds = prev?.odds || DEFAULT_ODDS;
    const payout = calcPayout(wager, odds);

    let brDelta = 0;
    // Undo previous result
    if (prevResult === 'won') brDelta -= payout;
    if (prevResult === 'lost') brDelta += wager;
    // Apply new result
    if (result === 'won') brDelta += payout;
    if (result === 'lost') brDelta -= wager;

    updateBankroll({ ...bankroll, current: Math.round((bankroll.current + brDelta) * 100) / 100 });
    persist(tracked.map(t => t.id === id ? { ...t, result } : t));
  };

  const updatePick = (id, field, value) => {
    persist(tracked.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const removePick = (id) => {
    const pick = tracked.find(t => t.id === id);
    if (pick?.result === 'won') {
      const payout = calcPayout(pick.wager || 0, pick.odds || DEFAULT_ODDS);
      updateBankroll({ ...bankroll, current: Math.round((bankroll.current - payout) * 100) / 100 });
    }
    if (pick?.result === 'lost') {
      updateBankroll({ ...bankroll, current: Math.round((bankroll.current + (pick.wager || 0)) * 100) / 100 });
    }
    persist(tracked.filter(t => t.id !== id));
  };

  const clearAll = () => {
    if (window.confirm('Clear all tracked props? This cannot be undone.')) {
      persist([]);
      updateBankroll({ ...bankroll, current: bankroll.starting });
    }
  };

  const handleSetBankroll = () => {
    const val = parseFloat(brInput);
    if (!isNaN(val) && val > 0) {
      updateBankroll({ starting: val, current: val });
      setEditBankroll(false);
    }
  };

  const handleDefaultWager = (val) => {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) {
      setDefaultWager(n);
      localStorage.setItem('kbo_default_wager', String(n));
    }
  };

  const normParts = (name) => {
    const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/-/g, ' ');
    return new Set(n.split(/\s+/).filter(Boolean));
  };

  const setsEqual = (a, b) => {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  };

  const autoGrade = () => {
    if (!gradeResults?.stats?.length) {
      setGradeMsg('No stats data available. Run the grading script first.');
      return;
    }
    const pendingPicks = tracked.filter(t => !t.result);
    if (pendingPicks.length === 0) {
      setGradeMsg('No pending picks to grade.');
      return;
    }

    let graded = 0;
    let newBankroll = { ...bankroll };
    const updated = tracked.map(t => {
      if (t.result) return t;

      const pickParts = normParts(t.name);

      // Find matching stat by date + name + type
      const match = gradeResults.stats.find(s => {
        if (s.date !== t.date) return false;
        const sParts = normParts(s.name);
        if (!setsEqual(pickParts, sParts)) return false;
        // Match prop type to stat type
        if (t.prop === 'Strikeouts' && s.type === 'pitcher') return true;
        if ((t.prop === 'Hits+Runs+RBIs' || t.prop === 'Total Bases') && s.type === 'batter') return true;
        return false;
      });

      if (!match) return t;

      // Get the actual stat based on prop type
      let actual;
      let detail;
      if (t.prop === 'Strikeouts') {
        actual = match.so;
        detail = `IP: ${match.ip} SO: ${match.so}`;
      } else if (t.prop === 'Hits+Runs+RBIs') {
        actual = match.hrr;
        detail = `H:${match.h} R:${match.r} RBI:${match.rbi}`;
      } else if (t.prop === 'Total Bases') {
        actual = match.tb;
        detail = `TB: ${match.tb}`;
      } else {
        return t;
      }

      // Grade: compare actual vs line
      let gradeResult;
      if (actual > t.line) gradeResult = 'OVER';
      else if (actual < t.line) gradeResult = 'UNDER';
      else gradeResult = 'PUSH';

      // Determine win/loss
      let result;
      if (gradeResult === 'PUSH') {
        result = 'push';
      } else if (
        (t.side === 'OVER' && gradeResult === 'OVER') ||
        (t.side === 'UNDER' && gradeResult === 'UNDER')
      ) {
        result = 'won';
      } else {
        result = 'lost';
      }

      const wager = t.wager || 0;
      const payout = calcPayout(wager, t.odds || DEFAULT_ODDS);
      if (result === 'won') newBankroll.current += payout;
      if (result === 'lost') newBankroll.current -= wager;
      newBankroll.current = Math.round(newBankroll.current * 100) / 100;

      graded++;
      return { ...t, result, actual, detail };
    });

    persist(updated);
    updateBankroll(newBankroll);
    setGradeMsg(`Auto-graded ${graded} pick${graded !== 1 ? 's' : ''}. ${pendingPicks.length - graded > 0 ? (pendingPicks.length - graded) + ' unmatched.' : ''}`);
  };

  // Stats
  const won = tracked.filter(t => t.result === 'won').length;
  const lost = tracked.filter(t => t.result === 'lost').length;
  const pushes = tracked.filter(t => t.result === 'push').length;
  const pending = tracked.filter(t => !t.result).length;
  const total = won + lost + pushes;
  const winRate = total > 0 ? ((won / total) * 100).toFixed(1) : '—';

  // Money stats
  const totalWagered = tracked.filter(t => t.result && t.result !== 'push').reduce((s, t) => s + (t.wager || 0), 0);
  const totalProfit = bankroll.current - bankroll.starting;
  const roi = totalWagered > 0 ? ((totalProfit / totalWagered) * 100).toFixed(1) : '—';
  const totalWon = tracked.filter(t => t.result === 'won').reduce((s, t) => s + calcPayout(t.wager || 0, t.odds || DEFAULT_ODDS), 0);
  const totalLost = tracked.filter(t => t.result === 'lost').reduce((s, t) => s + (t.wager || 0), 0);

  // Current streak
  const resolved = tracked.filter(t => t.result && t.result !== 'push');
  let streak = 0;
  let streakType = '';
  for (const t of resolved) {
    if (!streakType) { streakType = t.result; streak = 1; }
    else if (t.result === streakType) streak++;
    else break;
  }
  const streakStr = streak > 0 ? `${streak}${streakType === 'won' ? 'W' : 'L'}` : '—';

  // Daily P&L
  const dailyMap = {};
  for (const t of tracked) {
    if (!t.result || t.result === 'push') continue;
    const d = t.date;
    if (!dailyMap[d]) dailyMap[d] = { date: d, bets: 0, won: 0, lost: 0, wagered: 0, profit: 0 };
    dailyMap[d].bets++;
    const wager = t.wager || 0;
    const payout = calcPayout(wager, t.odds || DEFAULT_ODDS);
    dailyMap[d].wagered += wager;
    if (t.result === 'won') { dailyMap[d].won++; dailyMap[d].profit += payout; }
    if (t.result === 'lost') { dailyMap[d].lost++; dailyMap[d].profit -= wager; }
  }
  const dailyRows = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

  // Filter
  const filtered = tracked.filter(t => {
    if (filter === 'pending') return !t.result;
    if (filter === 'won') return t.result === 'won';
    if (filter === 'lost') return t.result === 'lost';
    if (filter === 'push') return t.result === 'push';
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortField], bv = b[sortField];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return <span className="sort-icon dim">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const propLabel = (prop) => {
    if (prop === 'Strikeouts') return 'K';
    if (prop === 'Hits Allowed') return 'HA';
    if (prop === 'Pitching Outs') return 'OUTS';
    if (prop === 'Hits+Runs+RBIs') return 'HRR';
    if (prop === 'Total Bases') return 'TB';
    return prop;
  };

  // Filter projections not already tracked today
  const trackedKeys = new Set(tracked.map(t => `${t.name}|${t.prop}|${t.side}`));
  const available = projections.filter(p => {
    return !trackedKeys.has(`${p.name}|${p.prop}|OVER`) && !trackedKeys.has(`${p.name}|${p.prop}|UNDER`);
  });

  return (
    <div className="pt-container">
      <header className="pt-header">
        <h1 className="pt-title">📋 Prop Tracker</h1>
      </header>

      {/* Bankroll bar */}
      <div className="pt-bankroll-bar">
        <div className="pt-br-section">
          <span className="pt-br-label">Bankroll</span>
          {editBankroll ? (
            <div className="pt-br-edit">
              <span className="pt-br-dollar">$</span>
              <input
                type="number"
                className="pt-br-input"
                value={brInput}
                onChange={e => setBrInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSetBankroll()}
                autoFocus
                placeholder="100"
                min="1"
              />
              <button className="pt-br-save" onClick={handleSetBankroll}>Set</button>
              <button className="pt-br-cancel" onClick={() => setEditBankroll(false)}>✕</button>
            </div>
          ) : (
            <div className="pt-br-display" onClick={() => { setEditBankroll(true); setBrInput(String(bankroll.starting)); }}>
              <span className={`pt-br-amount ${bankroll.current >= bankroll.starting ? 'pt-green' : 'pt-red'}`}>
                ${bankroll.current.toFixed(2)}
              </span>
              <span className="pt-br-start">/ ${bankroll.starting.toFixed(0)} start</span>
            </div>
          )}
        </div>
        <div className="pt-br-section">
          <span className="pt-br-label">P&L</span>
          <span className={`pt-br-amount ${totalProfit >= 0 ? 'pt-green' : 'pt-red'}`}>
            {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
          </span>
        </div>
        <div className="pt-br-section">
          <span className="pt-br-label">ROI</span>
          <span className={`pt-br-amount ${parseFloat(roi) > 0 ? 'pt-green' : parseFloat(roi) < 0 ? 'pt-red' : ''}`}>
            {roi}%
          </span>
        </div>
        <div className="pt-br-section">
          <span className="pt-br-label">Default Bet</span>
          <div className="pt-br-edit-inline">
            <span className="pt-br-dollar">$</span>
            <input
              type="number"
              className="pt-br-input pt-br-input-sm"
              value={defaultWager}
              onChange={e => handleDefaultWager(e.target.value)}
              min="1"
            />
          </div>
        </div>
      </div>

      {/* Dashboard stats */}
      <div className="pt-dashboard">
        <div className="pt-dash-card">
          <span className="pt-dash-num pt-green">{won}</span>
          <span className="pt-dash-label">Wins</span>
        </div>
        <div className="pt-dash-card">
          <span className="pt-dash-num pt-red">{lost}</span>
          <span className="pt-dash-label">Losses</span>
        </div>
        <div className="pt-dash-card">
          <span className="pt-dash-num pt-yellow">{pushes}</span>
          <span className="pt-dash-label">Pushes</span>
        </div>
        <div className="pt-dash-card">
          <span className="pt-dash-num">{pending}</span>
          <span className="pt-dash-label">Pending</span>
        </div>
        <div className="pt-dash-card">
          <span className="pt-dash-num">{winRate}%</span>
          <span className="pt-dash-label">Win Rate</span>
        </div>
        <div className="pt-dash-card">
          <span className="pt-dash-num pt-green">${totalWon.toFixed(0)}</span>
          <span className="pt-dash-label">Won</span>
        </div>
        <div className="pt-dash-card">
          <span className="pt-dash-num pt-red">${totalLost.toFixed(0)}</span>
          <span className="pt-dash-label">Lost</span>
        </div>
        <div className="pt-dash-card">
          <span className={`pt-dash-num ${streakType === 'won' ? 'pt-green' : streakType === 'lost' ? 'pt-red' : ''}`}>{streakStr}</span>
          <span className="pt-dash-label">Streak</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="pt-tab-bar">
        <button className={`pt-tab-btn ${tab === 'picks' ? 'active' : ''}`} onClick={() => setTab('picks')}>
          My Picks
        </button>
        <button className={`pt-tab-btn ${tab === 'daily' ? 'active' : ''}`} onClick={() => setTab('daily')}>
          Daily P&L
        </button>
      </div>

      {/* Picks tab */}
      {tab === 'picks' && (
        <>
          {/* Controls */}
          <div className="pt-controls">
            <div className="pt-filter-bar">
              {['all', 'pending', 'won', 'lost', 'push'].map(f => (
                <button
                  key={f}
                  className={`pt-filter-btn ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? `All (${tracked.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${tracked.filter(t => f === 'pending' ? !t.result : t.result === f).length})`}
                </button>
              ))}
            </div>
            <div className="pt-actions">
              <button className="pt-btn pt-btn-add" onClick={() => setShowAdd(!showAdd)}>
                {showAdd ? '✕ Close' : '+ Add Pick'}
              </button>
              {gradeResults?.results?.length > 0 && tracked.some(t => !t.result) && (
                <button className="pt-btn pt-btn-grade" onClick={autoGrade} disabled={grading}>
                  ⚡ Auto-Grade
                </button>
              )}
              {tracked.length > 0 && (
                <button className="pt-btn pt-btn-clear" onClick={clearAll}>Clear All</button>
              )}
            </div>
            {gradeMsg && (
              <div className="pt-grade-msg" onClick={() => setGradeMsg('')}>{gradeMsg}</div>
            )}
          </div>

          {/* Add pick picker */}
          {showAdd && (
            <div className="pt-add-panel">
              <h3 className="pt-add-title">Add from today's projections</h3>
              {available.length === 0 && <p className="pt-add-empty">All projections already tracked</p>}
              <div className="pt-add-grid">
                {available.map((p, i) => (
                  <div key={i} className="pt-add-card">
                    <div className="pt-add-info">
                      <span className="pt-add-name">{p.name}</span>
                      <span className="pt-add-meta">
                        <span style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span>{' vs '}
                        <span style={{ color: TEAMS[p.opponent] || '#999' }}>{p.opponent}</span>
                        {' · '}{propLabel(p.prop)}{' · '}<span className="pp-mini">P</span>{p.line}
                        {' · Proj: '}{p.projection.toFixed(2)}
                        {' · '}<span className={p.edge > 0 ? 'pt-green' : 'pt-red'}>{p.edge > 0 ? '+' : ''}{p.edge.toFixed(2)}</span>
                      </span>
                    </div>
                    <div className="pt-add-btns">
                      <button className="pt-side-btn pt-side-over" onClick={() => addPick(p, 'OVER')}>OVER</button>
                      <button className="pt-side-btn pt-side-under" onClick={() => addPick(p, 'UNDER')}>UNDER</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tracked table */}
          <div className="pt-table-wrap">
            <table className="pt-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('date')}>Date {sortIcon('date')}</th>
                  <th onClick={() => handleSort('name')}>Player {sortIcon('name')}</th>
                  <th>Matchup</th>
                  <th onClick={() => handleSort('prop')}>Prop {sortIcon('prop')}</th>
                  <th className="col-num" onClick={() => handleSort('line')}>Line {sortIcon('line')}</th>
                  <th>Pick</th>
                  <th className="col-num" onClick={() => handleSort('projection')}>Proj {sortIcon('projection')}</th>
                  <th className="col-num" onClick={() => handleSort('edge')}>Edge {sortIcon('edge')}</th>
                  <th className="col-num">Actual</th>
                  <th className="col-num">Wager</th>
                  <th className="col-num">Odds</th>
                  <th className="col-num">Payout</th>
                  <th>Result</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td colSpan="14" className="pt-empty">
                    No props tracked yet. Click "+ Add Pick" to get started.
                  </td></tr>
                )}
                {sorted.map(t => {
                  const payout = calcPayout(t.wager || 0, t.odds || DEFAULT_ODDS);
                  return (
                    <tr key={t.id} className={`pt-row ${t.result ? `pt-row-${t.result}` : ''}`}>
                      <td className="pt-date">{t.date}</td>
                      <td className="pt-player">{t.name}</td>
                      <td>
                        <span style={{ color: TEAMS[t.team] || '#999' }}>{t.team}</span>
                        <span className="pt-vs">vs</span>
                        <span style={{ color: TEAMS[t.opponent] || '#999' }}>{t.opponent}</span>
                      </td>
                      <td><span className="pt-prop-tag">{propLabel(t.prop)}</span></td>
                      <td className="col-num mono">{t.line}</td>
                      <td><span className={`pt-side-tag ${t.side === 'OVER' ? 'side-over' : 'side-under'}`}>{t.side}</span></td>
                      <td className="col-num mono">{t.projection?.toFixed(2)}</td>
                      <td className={`col-num mono ${t.edge > 0 ? 'pt-green' : t.edge < 0 ? 'pt-red' : ''}`}>
                        {t.edge != null ? (t.edge > 0 ? '+' : '') + t.edge.toFixed(2) : '—'}
                      </td>
                      <td className="col-num mono">
                        {t.actual != null ? (
                          <span className={`pt-actual ${t.actual > t.line ? 'pt-green' : t.actual < t.line ? 'pt-red' : 'pt-yellow'}`} title={t.detail || ''}>
                            {t.actual}
                          </span>
                        ) : (
                          (() => {
                            if (!gradeResults?.stats) return '—';
                            const pickParts = normParts(t.name);
                            const match = gradeResults.stats.find(s => {
                              if (s.date !== t.date) return false;
                              if (!setsEqual(normParts(s.name), pickParts)) return false;
                              if (t.prop === 'Strikeouts' && s.type === 'pitcher') return true;
                              if ((t.prop === 'Hits+Runs+RBIs' || t.prop === 'Total Bases') && s.type === 'batter') return true;
                              return false;
                            });
                            if (!match) return '—';
                            const val = t.prop === 'Strikeouts' ? match.so : t.prop === 'Hits+Runs+RBIs' ? match.hrr : match.tb;
                            return (
                              <span className={`pt-actual ${val > t.line ? 'pt-green' : val < t.line ? 'pt-red' : 'pt-yellow'}`}>
                                {val}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="col-num">
                        <div className="pt-wager-cell">
                          <span className="pt-wager-dollar">$</span>
                          <input
                            type="number"
                            className="pt-wager-input"
                            value={t.wager ?? defaultWager}
                            onChange={e => updatePick(t.id, 'wager', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="1"
                          />
                        </div>
                      </td>
                      <td className="col-num">
                        <input
                          type="number"
                          className="pt-odds-input"
                          value={t.odds ?? DEFAULT_ODDS}
                          onChange={e => updatePick(t.id, 'odds', parseInt(e.target.value) || DEFAULT_ODDS)}
                        />
                      </td>
                      <td className="col-num mono pt-payout">${payout.toFixed(2)}</td>
                      <td>
                        {!t.result ? (
                          <div className="pt-result-btns">
                            <button className="pt-res-btn pt-res-won" onClick={() => setResult(t.id, 'won')} title="Won">W</button>
                            <button className="pt-res-btn pt-res-lost" onClick={() => setResult(t.id, 'lost')} title="Lost">L</button>
                            <button className="pt-res-btn pt-res-push" onClick={() => setResult(t.id, 'push')} title="Push">P</button>
                          </div>
                        ) : (
                          <span className={`pt-result-badge pt-result-${t.result}`} onClick={() => setResult(t.id, null)} title="Click to reset">
                            {t.result === 'won' ? '✓ WIN' : t.result === 'lost' ? '✕ LOSS' : '— PUSH'}
                          </span>
                        )}
                      </td>
                      <td>
                        <button className="pt-remove-btn" onClick={() => removePick(t.id)} title="Remove">×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Daily P&L tab */}
      {tab === 'daily' && (
        <div className="pt-daily-wrap">
          {dailyRows.length === 0 ? (
            <div className="pt-empty" style={{ padding: '3rem', textAlign: 'center' }}>
              No resolved bets yet. Mark picks as won or lost to see daily P&L.
            </div>
          ) : (
            <table className="pt-table pt-daily-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="col-num">Bets</th>
                  <th className="col-num">W</th>
                  <th className="col-num">L</th>
                  <th className="col-num">Win %</th>
                  <th className="col-num">Wagered</th>
                  <th className="col-num">P&L</th>
                  <th className="col-num">ROI</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map(d => {
                  const wp = d.won + d.lost > 0 ? ((d.won / (d.won + d.lost)) * 100).toFixed(0) : '—';
                  const dayRoi = d.wagered > 0 ? ((d.profit / d.wagered) * 100).toFixed(1) : '—';
                  return (
                    <tr key={d.date} className="pt-row">
                      <td className="pt-date">{d.date}</td>
                      <td className="col-num">{d.bets}</td>
                      <td className="col-num pt-green">{d.won}</td>
                      <td className="col-num pt-red">{d.lost}</td>
                      <td className="col-num">{wp}%</td>
                      <td className="col-num mono">${d.wagered.toFixed(0)}</td>
                      <td className={`col-num mono ${d.profit >= 0 ? 'pt-green' : 'pt-red'}`}>
                        {d.profit >= 0 ? '+' : ''}${d.profit.toFixed(2)}
                      </td>
                      <td className={`col-num mono ${parseFloat(dayRoi) > 0 ? 'pt-green' : parseFloat(dayRoi) < 0 ? 'pt-red' : ''}`}>
                        {dayRoi}%
                      </td>
                    </tr>
                  );
                })}
                <tr className="pt-daily-total">
                  <td><strong>Total</strong></td>
                  <td className="col-num"><strong>{dailyRows.reduce((s, d) => s + d.bets, 0)}</strong></td>
                  <td className="col-num pt-green"><strong>{dailyRows.reduce((s, d) => s + d.won, 0)}</strong></td>
                  <td className="col-num pt-red"><strong>{dailyRows.reduce((s, d) => s + d.lost, 0)}</strong></td>
                  <td className="col-num"><strong>{winRate}%</strong></td>
                  <td className="col-num mono"><strong>${totalWagered.toFixed(0)}</strong></td>
                  <td className={`col-num mono ${totalProfit >= 0 ? 'pt-green' : 'pt-red'}`}>
                    <strong>{totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}</strong>
                  </td>
                  <td className={`col-num mono ${parseFloat(roi) > 0 ? 'pt-green' : parseFloat(roi) < 0 ? 'pt-red' : ''}`}>
                    <strong>{roi}%</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="pt-footer-note">
        Data saved to your browser. Bankroll &amp; wagers update live when results are set. Click a result badge to reset it.
      </div>
    </div>
  );
}

export default PropTracker;
