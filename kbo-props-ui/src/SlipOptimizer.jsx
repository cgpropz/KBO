import { useState, useEffect, useMemo } from 'react';
import './SlipOptimizer.css';
import { fetchData } from './dataUrl';

const TEAMS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
};

function SlipOptimizer() {
  const [allProps, setAllProps] = useState([]);
  const [selected, setSelected] = useState(new Set()); // Set of indices
  const [legs, setLegs] = useState(3); // target legs for auto-optimizer
  const [mode, setMode] = useState('build'); // 'build' | 'auto'
  const [filter, setFilter] = useState('all'); // all | K | HRR | TB
  const [sideOverrides, setSideOverrides] = useState({}); // idx -> 'OVER' | 'UNDER'

  useEffect(() => {
    Promise.all([
      fetchData('strikeout_projections.json').catch(() => null),
      fetchData('batter_projections.json').catch(() => null),
    ]).then(([k, b]) => {
      const props = [];
      (k?.projections || []).forEach(p => {
        if (p.projection != null && p.edge != null) {
          const propShort = p.prop === 'Strikeouts' ? 'K' : p.prop === 'Hits Allowed' ? 'HA' : p.prop === 'Pitching Outs' ? 'OUTS' : 'P';
          props.push({ ...p, propShort });
        }
      });
      (b?.projections || []).forEach(p => {
        if (p.projection != null && p.edge != null) {
          props.push({ ...p, propShort: p.prop === 'Hits+Runs+RBIs' ? 'HRR' : 'TB' });
        }
      });
      // Sort by absolute edge descending
      props.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
      setAllProps(props);
    });
  }, []);

  // Determine the natural side for a prop
  const naturalSide = (p) => p.edge >= 0 ? 'OVER' : 'UNDER';
  const getSide = (idx) => sideOverrides[idx] || naturalSide(allProps[idx]);

  const toggleSide = (idx) => {
    setSideOverrides(prev => {
      const nat = naturalSide(allProps[idx]);
      const current = prev[idx] || nat;
      const flipped = current === 'OVER' ? 'UNDER' : 'OVER';
      if (flipped === nat) {
        const next = { ...prev };
        delete next[idx];
        return next;
      }
      return { ...prev, [idx]: flipped };
    });
  };

  const toggleSelect = (idx) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Compute slip confidence for a set of legs
  const computeSlipScore = (indices) => {
    if (indices.length === 0) return { confidence: 0, avgEdge: 0, totalEdge: 0, legs: 0 };
    let totalAbsEdge = 0;
    let totalRating = 0;
    let ratingCount = 0;
    const games = new Set();
    indices.forEach(idx => {
      const p = allProps[idx];
      const side = getSide(idx);
      // Edge relative to the chosen side
      const sideEdge = side === 'OVER' ? p.edge : -p.edge;
      totalAbsEdge += sideEdge;
      if (p.rating != null) { totalRating += p.rating; ratingCount++; }
      games.add(`${p.team}-${p.opponent}`);
    });
    const avgEdge = totalAbsEdge / indices.length;
    const avgRating = ratingCount > 0 ? totalRating / ratingCount : 50;
    // Game diversity bonus: more unique games = less correlated
    const diversityMultiplier = 1 + (games.size - 1) * 0.05;
    // Confidence: weighted combo of avg edge and avg rating, with diversity bonus
    const confidence = ((avgEdge * 20) + ((avgRating - 50) * 1.5)) * diversityMultiplier;
    return {
      confidence: Math.round(confidence * 10) / 10,
      avgEdge: Math.round(avgEdge * 100) / 100,
      totalEdge: Math.round(totalAbsEdge * 100) / 100,
      legs: indices.length,
      uniqueGames: games.size,
    };
  };

  // Auto-generate top combinations
  const autoSlips = useMemo(() => {
    if (mode !== 'auto' || allProps.length === 0) return [];

    // Only consider props with positive edge on their natural side
    const candidates = allProps
      .map((p, i) => ({ idx: i, edge: p.edge, absEdge: Math.abs(p.edge) }))
      .filter(c => c.absEdge > 0.1)
      .sort((a, b) => b.absEdge - a.absEdge);

    if (candidates.length < legs) return [];

    // Generate combinations using greedy approach with game diversity
    const slips = [];
    const n = Math.min(candidates.length, 12); // limit search space

    // Simple combination generator for small n
    function* combinations(arr, k) {
      if (k === 0) { yield []; return; }
      for (let i = 0; i <= arr.length - k; i++) {
        for (const rest of combinations(arr.slice(i + 1), k - 1)) {
          yield [arr[i], ...rest];
        }
      }
    }

    for (const combo of combinations(candidates.slice(0, n), legs)) {
      const indices = combo.map(c => c.idx);
      const score = computeSlipScore(indices);
      slips.push({ indices, score });
    }

    slips.sort((a, b) => b.score.confidence - a.score.confidence);
    return slips.slice(0, 10);
  }, [mode, legs, allProps, sideOverrides]);

  // Current manual slip stats
  const selectedArr = [...selected];
  const slipScore = computeSlipScore(selectedArr);

  // Filtered props
  const filteredProps = allProps.map((p, i) => ({ ...p, idx: i })).filter(p => {
    if (filter === 'K') return p.propShort === 'K';
    if (filter === 'HRR') return p.propShort === 'HRR';
    if (filter === 'TB') return p.propShort === 'TB';
    return true;
  });

  const getConfidenceClass = (c) => {
    if (c >= 15) return 'conf-elite';
    if (c >= 8) return 'conf-high';
    if (c >= 3) return 'conf-mid';
    return 'conf-low';
  };

  return (
    <div className="so-container">
      <header className="so-header">
        <h1 className="so-title">🎰 Slip Optimizer</h1>
      </header>

      {/* Mode toggle */}
      <div className="so-mode-bar">
        <button
          className={`so-mode-btn ${mode === 'build' ? 'active' : ''}`}
          onClick={() => setMode('build')}
        >
          🛠 Build Slip
        </button>
        <button
          className={`so-mode-btn ${mode === 'auto' ? 'active' : ''}`}
          onClick={() => setMode('auto')}
        >
          ⚡ Auto Optimizer
        </button>
      </div>

      {mode === 'build' && (
        <>
          {/* Current slip summary */}
          <div className="so-slip-summary">
            <div className="so-slip-header">
              <h2 className="so-slip-title">
                Your Slip
                {selectedArr.length > 0 && <span className="so-leg-count">{selectedArr.length} leg{selectedArr.length !== 1 ? 's' : ''}</span>}
              </h2>
              {selectedArr.length > 0 && (
                <button className="so-clear-btn" onClick={() => { setSelected(new Set()); setSideOverrides({}); }}>Clear</button>
              )}
            </div>
            {selectedArr.length === 0 ? (
              <p className="so-slip-empty">Select props below to build your slip</p>
            ) : (
              <>
                <div className="so-slip-legs">
                  {selectedArr.map(idx => {
                    const p = allProps[idx];
                    const side = getSide(idx);
                    return (
                      <div key={idx} className="so-slip-leg">
                        <span className="so-leg-name">{p.name}</span>
                        <span className="so-leg-prop">{p.propShort}</span>
                        <span className="so-leg-line">
                          <span className="pp-mini">P</span>{p.line}
                        </span>
                        <span
                          className={`so-leg-side ${side === 'OVER' ? 'side-over' : 'side-under'}`}
                          onClick={() => toggleSide(idx)}
                          title="Click to flip"
                        >
                          {side}
                        </span>
                        <span className={`so-leg-edge ${p.edge > 0 ? 'edge-pos' : 'edge-neg'}`}>
                          {(side === 'OVER' ? p.edge : -p.edge) > 0 ? '+' : ''}{(side === 'OVER' ? p.edge : -p.edge).toFixed(2)}
                        </span>
                        <button className="so-leg-remove" onClick={() => toggleSelect(idx)}>×</button>
                      </div>
                    );
                  })}
                </div>
                <div className="so-slip-stats">
                  <div className="so-slip-stat">
                    <span className="so-stat-label">Confidence</span>
                    <span className={`so-stat-val ${getConfidenceClass(slipScore.confidence)}`}>{slipScore.confidence}</span>
                  </div>
                  <div className="so-slip-stat">
                    <span className="so-stat-label">Avg Edge</span>
                    <span className={`so-stat-val ${slipScore.avgEdge > 0 ? 'edge-pos' : 'edge-neg'}`}>{slipScore.avgEdge > 0 ? '+' : ''}{slipScore.avgEdge}</span>
                  </div>
                  <div className="so-slip-stat">
                    <span className="so-stat-label">Total Edge</span>
                    <span className={`so-stat-val ${slipScore.totalEdge > 0 ? 'edge-pos' : 'edge-neg'}`}>{slipScore.totalEdge > 0 ? '+' : ''}{slipScore.totalEdge}</span>
                  </div>
                  <div className="so-slip-stat">
                    <span className="so-stat-label">Games</span>
                    <span className="so-stat-val">{slipScore.uniqueGames}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Prop picker */}
          <div className="so-picker">
            <div className="so-picker-header">
              <h3 className="so-picker-title">Available Props</h3>
              <div className="so-picker-filters">
                {['all', 'K', 'HRR', 'TB'].map(f => (
                  <button
                    key={f}
                    className={`so-filter-chip ${filter === f ? 'active' : ''}`}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'All' : f}
                  </button>
                ))}
              </div>
            </div>
            <div className="so-prop-list">
              {filteredProps.map(p => {
                const isSelected = selected.has(p.idx);
                const side = getSide(p.idx);
                const sideEdge = side === 'OVER' ? p.edge : -p.edge;
                return (
                  <div
                    key={p.idx}
                    className={`so-prop-row ${isSelected ? 'so-prop-selected' : ''}`}
                    onClick={() => toggleSelect(p.idx)}
                  >
                    <div className="so-prop-check">
                      <div className={`so-checkbox ${isSelected ? 'checked' : ''}`}>
                        {isSelected && '✓'}
                      </div>
                    </div>
                    <div className="so-prop-info">
                      <span className="so-prop-name">{p.name}</span>
                      <span className="so-prop-meta">
                        <span style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span>
                        <span className="so-vs">vs</span>
                        <span style={{ color: TEAMS[p.opponent] || '#999' }}>{p.opponent}</span>
                      </span>
                    </div>
                    <span className="so-prop-tag">{p.propShort}</span>
                    <span className="so-prop-line"><span className="pp-mini">P</span>{p.line}</span>
                    <span className="so-prop-proj">{p.projection.toFixed(2)}</span>
                    <span
                      className={`so-prop-side ${side === 'OVER' ? 'side-over' : 'side-under'}`}
                      onClick={(e) => { e.stopPropagation(); toggleSide(p.idx); }}
                      title="Click to flip side"
                    >
                      {side}
                    </span>
                    <span className={`so-prop-edge ${sideEdge > 0 ? 'edge-pos' : 'edge-neg'}`}>
                      {sideEdge > 0 ? '+' : ''}{sideEdge.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {mode === 'auto' && (
        <div className="so-auto">
          <div className="so-auto-controls">
            <label className="so-auto-label">Legs per slip:</label>
            <div className="so-legs-btns">
              {[2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  className={`so-legs-btn ${legs === n ? 'active' : ''}`}
                  onClick={() => setLegs(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {autoSlips.length === 0 ? (
            <p className="so-auto-empty">Not enough props with edge to build {legs}-leg slips</p>
          ) : (
            <div className="so-auto-results">
              <h3 className="so-auto-title">Top {autoSlips.length} Optimized Slips</h3>
              {autoSlips.map((slip, si) => (
                <div key={si} className="so-auto-card">
                  <div className="so-auto-rank">
                    <span className="so-auto-num">#{si + 1}</span>
                    <span className={`so-auto-conf ${getConfidenceClass(slip.score.confidence)}`}>
                      {slip.score.confidence}
                    </span>
                    <span className="so-auto-conf-label">confidence</span>
                  </div>
                  <div className="so-auto-legs">
                    {slip.indices.map(idx => {
                      const p = allProps[idx];
                      const side = getSide(idx);
                      const sideEdge = side === 'OVER' ? p.edge : -p.edge;
                      return (
                        <div key={idx} className="so-auto-leg">
                          <span className="so-auto-player">{p.name}</span>
                          <span className="so-auto-prop">{p.propShort}</span>
                          <span className="so-auto-line"><span className="pp-mini">P</span>{p.line}</span>
                          <span className={`so-auto-side ${side === 'OVER' ? 'side-over' : 'side-under'}`}>{side}</span>
                          <span className={`so-auto-edge ${sideEdge > 0 ? 'edge-pos' : 'edge-neg'}`}>
                            {sideEdge > 0 ? '+' : ''}{sideEdge.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="so-auto-stats">
                    <span>Avg Edge: <strong className={slip.score.avgEdge > 0 ? 'edge-pos' : ''}>{slip.score.avgEdge > 0 ? '+' : ''}{slip.score.avgEdge}</strong></span>
                    <span>Games: <strong>{slip.score.uniqueGames}</strong></span>
                  </div>
                  <button
                    className="so-auto-use"
                    onClick={() => {
                      setSelected(new Set(slip.indices));
                      setMode('build');
                    }}
                  >
                    Use This Slip →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="so-footer-note">
        Confidence score combines edge magnitude, rating, and game diversity. Higher = stronger slip.
        Click OVER/UNDER on any prop to flip the side.
      </div>
    </div>
  );
}

export default SlipOptimizer;
