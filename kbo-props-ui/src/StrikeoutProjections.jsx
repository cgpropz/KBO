import { useState, useEffect, useMemo } from 'react';
import './StrikeoutProjections.css';
import { fetchData } from './dataUrl';

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
  const [matchupData, setMatchupData] = useState(null);
  const [opponentStatsData, setOpponentStatsData] = useState(null);
  const [prizepicksData, setPrizepicksData] = useState(null);
  const [photos, setPhotos] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProp, setSelectedProp] = useState('all');
  const [sortField, setSortField] = useState('edge');
  const [sortDir, setSortDir] = useState('desc');

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

  const propToPrizepicksStat = {
    Strikeouts: ['Pitcher Strikeouts'],
    'Hits Allowed': ['Hits Allowed', 'Pitcher Hits Allowed'],
    'Pitching Outs': ['Pitching Outs'],
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [kData, mData, oppData, ppData, photoData] = await Promise.all([
          fetchData('strikeout_projections.json'),
          fetchData('matchup_data.json').catch(() => null),
          fetchData('team_opponent_stats_2026.json').catch(() => null),
          fetchData('prizepicks_props.json').catch(() => null),
          fetchData('player_photos.json').catch(() => ({})),
        ]);
        if (cancelled) return;
        setData(kData);
        setMatchupData(mData);
        setOpponentStatsData(oppData);
        setPrizepicksData(ppData);
        setPhotos((photoData && typeof photoData === 'object') ? photoData : {});
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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

  // Must be declared before early returns to satisfy Rules of Hooks
  const photoLookup = useMemo(() => {
    const lookup = {};
    const raw = (photos && typeof photos === 'object') ? photos : {};
    for (const [name, url] of Object.entries(raw)) {
      lookup[normalizeName(name)] = url;
    }
    return lookup;
  }, [photos]);

  const playerInitials = (name) => String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';

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

  const slatePairs = new Set(
    (matchupData?.matchups || []).flatMap((m) => {
      const away = m?.away;
      const home = m?.home;
      if (!away || !home) return [];
      return [`${away}@@${home}`, `${home}@@${away}`];
    })
  );

  const scoped = (data.projections || []).filter((p) => {
    if (slatePairs.size === 0) return true;
    return slatePairs.has(`${p.team}@@${p.opponent}`);
  });

  const ppLineByKey = (() => {
    const map = new Map();
    const teamOppBuckets = new Map();
    const cards = prizepicksData?.cards || [];
    for (const card of cards) {
      if (card?.type !== 'pitcher') continue;
      const team = card?.team || '';
      const opp = card?.opponent || '';
      const norm = normalizeName(card?.name);
      const sig = nameSignature(card?.name);

      const buckets = new Map();
      for (const prop of card?.props || []) {
        const stat = prop?.stat;
        const line = Number(prop?.line);
        if (!Number.isFinite(line)) continue;
        if (!['Pitcher Strikeouts', 'Hits Allowed', 'Pitching Outs'].includes(stat)) continue;
        if (!buckets.has(stat)) buckets.set(stat, []);
        buckets.get(stat).push(line);
      }

      for (const [stat, lines] of buckets.entries()) {
        lines.sort((a, b) => a - b);
        const canonicalLine = lines[Math.floor(lines.length / 2)];
        const exactKey = `${stat}@@${team}@@${opp}@@${norm}`;
        const sigKey = `${stat}@@${team}@@${opp}@@sig:${sig}`;
        const teamOppKey = `${stat}@@${team}@@${opp}@@teamOpp`;
        map.set(exactKey, canonicalLine);
        map.set(sigKey, canonicalLine);
        if (!teamOppBuckets.has(teamOppKey)) teamOppBuckets.set(teamOppKey, []);
        teamOppBuckets.get(teamOppKey).push(canonicalLine);
      }
    }

    for (const [key, values] of teamOppBuckets.entries()) {
      const unique = [...new Set(values)];
      if (unique.length === 1) {
        map.set(key, unique[0]);
      }
    }
    return map;
  })();

  // Safely get opponent team stats
  const getOppStats = (opponent) => {
    if (!opponentStatsData || !opponent) return {};
    const stats = opponentStatsData[opponent];
    if (!stats) return {};
    return {
      k_pct: stats.k_pct ?? null,
      ba: stats.ba ?? null,
    };
  };

  const mergedScoped = scoped.map((p) => {
    // Get opponent team stats first (for all projections)
    const oppStats = getOppStats(p.opponent);
    
    const ppStats = propToPrizepicksStat[p.prop];
    if (!ppStats?.length) return {
      ...p,
      opp_k_pct: oppStats.k_pct,
      opp_ba: oppStats.ba,
    };
    
    const norm = normalizeName(p.name);
    const sig = nameSignature(p.name);
    let liveLine = null;
    for (const ppStat of ppStats) {
      const exactKey = `${ppStat}@@${p.team}@@${p.opponent}@@${norm}`;
      const sigKey = `${ppStat}@@${p.team}@@${p.opponent}@@sig:${sig}`;
      const teamOppKey = `${ppStat}@@${p.team}@@${p.opponent}@@teamOpp`;
      liveLine = ppLineByKey.get(exactKey) ?? ppLineByKey.get(sigKey) ?? ppLineByKey.get(teamOppKey);
      if (Number.isFinite(liveLine)) break;
    }
    
    const projection = Number(p.projection);
    const edge = Number.isFinite(projection) && liveLine ? projection - liveLine : null;

    return {
      ...p,
      line: liveLine ?? null,
      edge: edge != null ? Number(edge.toFixed(1)) : null,
      rating: Number.isFinite(projection) && liveLine ? Number(((projection / liveLine) * 50).toFixed(1)) : null,
      opp_k_pct: oppStats.k_pct,
      opp_ba: oppStats.ba,
    };
  });

  const filtered = mergedScoped.filter((p) => {
    // Keep selected tab strict so filters only show the chosen prop type
    if (selectedProp === 'all') return true;
    return p.prop === selectedProp;
  });

  const projections = [...filtered].sort((a, b) => {
    let aVal = a[sortField], bVal = b[sortField];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const propOptions = [
    { key: 'all', label: 'All' },
    { key: 'Strikeouts', label: 'Strikeouts' },
    { key: 'Hits Allowed', label: 'Hits Allowed' },
    { key: 'Pitching Outs', label: 'Pitching Outs' },
  ];

  const contextTitle = selectedProp === 'Hits Allowed'
    ? 'Opponent Hit Rates (H/IP)'
    : selectedProp === 'Pitching Outs'
      ? 'Top Projected Outs'
      : selectedProp === 'all'
        ? 'Pitcher Prop Mix'
        : 'Team K Rates (SO/G)';

  const contextCards = selectedProp === 'Hits Allowed'
    ? Object.entries(data.team_h_per_ip || {})
        .sort((a, b) => b[1] - a[1])
        .map(([team, rate]) => ({ label: team, value: rate.toFixed(3), color: TEAMS[team] || '#999' }))
    : selectedProp === 'Pitching Outs'
      ? [...projections]
          .filter((p) => p.prop === 'Pitching Outs' && p.projection != null)
          .sort((a, b) => b.projection - a.projection)
          .slice(0, 10)
          .map((p) => ({ label: p.name, value: p.projection.toFixed(1), color: TEAMS[p.team] || '#999' }))
      : selectedProp === 'all'
        ? propOptions
            .filter((opt) => opt.key !== 'all')
            .map((opt) => ({
              label: opt.label,
              value: scoped.filter((p) => p.prop === opt.key).length,
              color: '#fff',
            }))
        : Object.entries(data.team_so_per_g || {})
            .sort((a, b) => b[1] - a[1])
            .map(([team, rate]) => ({ label: team, value: rate.toFixed(2), color: TEAMS[team] || '#999' }));

  const formulaText = selectedProp === 'Hits Allowed'
    ? '(H/IP x IP/G) x Opp H/IP ÷ Lg Avg H/IP, adjusted by WHIP and form'
    : selectedProp === 'Pitching Outs'
      ? '(IP/G x 3) x opponent context, adjusted by WHIP and recent form'
      : selectedProp === 'all'
        ? 'Filter by prop type to view the active pitcher model formula'
        : '(SO/IP x IP/G) x Opp SO/G ÷ Lg Avg SO/G, adjusted by WHIP and form';

  const getValClass = (rec) => {
    if (rec === 'OVER') return 'val-over';
    if (rec === 'UNDER') return 'val-under';
    if (rec === 'NO DATA') return 'val-nodata';
    if (rec === 'NO LINE') return 'val-noline';
    return 'val-push';
  };

  // Color scaling for opponent K% (strikeout rate)
  // High K% (easier for pitcher, more strikeouts) = Green
  // Mid K% (neutral) = Yellow
  // Low K% (tough, fewer strikeouts) = Red
  const oppKPctBg = (val) => {
    if (val == null) return {};
    if (val >= 26.0) return { backgroundColor: '#1a4d1a', color: '#fff' }; // Dark green - very easy
    if (val >= 25.0) return { backgroundColor: '#2ecc40', color: '#222' }; // Green - easy
    if (val >= 24.0) return { backgroundColor: '#ffe066', color: '#222' }; // Yellow - neutral
    if (val >= 23.0) return { backgroundColor: '#ffb347', color: '#222' }; // Orange - slightly tough
    return { backgroundColor: '#ff2222', color: '#fff' }; // Red - very tough
  };

  const oppBaBg = (val) => {
    if (val == null) return {};
    // Low BA = batter not hitting well = easier for pitcher = GREEN
    // High BA = batter hitting well = harder for pitcher = RED
    if (val < 0.235) return { backgroundColor: '#1a4d1a', color: '#fff' }; // Green - easy
    if (val < 0.250) return { backgroundColor: '#2d7f2d', color: '#fff' }; // Green-yellow
    if (val < 0.270) return { backgroundColor: '#4d4d4d', color: '#fff' }; // Gray - neutral
    if (val < 0.285) return { backgroundColor: '#8b5a5a', color: '#fff' }; // Red-gray - tough
    return { backgroundColor: '#802020', color: '#fff' }; // Dark red - very tough
  };

  return (
    <div className="so-container so-k-page">
      <header className="so-header">
        <h1 className="so-title">🇰🇷 ⚾ KBO Pitchers ⚾ 🇰🇷</h1>
        <div className="so-filter-bar">
          {propOptions.map((option) => (
            <button
              key={option.key}
              className={`so-filter-btn ${selectedProp === option.key ? 'active' : ''}`}
              onClick={() => setSelectedProp(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <main className="so-main">

        {/* Projection table */}
        <div className="so-scroll-hint">Swipe left/right to view full pitcher table</div>
        <div className="so-table-wrap">
          <table className="so-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')}>Player {sortIcon('name')}</th>
                <th onClick={() => handleSort('team')}>Team {sortIcon('team')}</th>
                <th onClick={() => handleSort('opponent')}>Matchup {sortIcon('opponent')}</th>
                <th onClick={() => handleSort('opp_ba')} className="col-num">Opp BA {sortIcon('opp_ba')}</th>
                <th onClick={() => handleSort('opp_k_pct')} className="col-num">Opp K% {sortIcon('opp_k_pct')}</th>
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
                  <td className="col-player">
                    <div className="so-player-cell">
                      {photoLookup[normalizeName(p.name)] ? (
                        <img
                          className="so-player-avatar"
                          src={photoLookup[normalizeName(p.name)]}
                          alt={p.name}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="so-player-fallback">{playerInitials(p.name)}</div>
                      )}
                      <span>{p.name}</span>
                    </div>
                  </td>
                  <td><span className="team-text" style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span></td>
                  <td><span className="team-text" style={{ color: TEAMS[p.opponent] || '#999' }}>{p.opponent}</span></td>
                  <td className="col-num mono" style={oppBaBg(p.opp_ba)}>{p.opp_ba != null ? parseFloat(p.opp_ba).toFixed(3) : '—'}</td>
                  <td className="col-num mono" style={oppKPctBg(p.opp_k_pct)}>{p.opp_k_pct != null ? parseFloat(p.opp_k_pct).toFixed(1) + '%' : '—'}</td>
                  <td className="col-prop">{p.prop}</td>
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
            <h3 className="so-panel-title">{contextTitle}</h3>
            <div className="so-team-grid">
              {contextCards.map((item) => (
                  <div key={`${item.label}-${item.value}`} className="so-team-card">
                    <span className="so-team-name" style={{ color: item.color }}>{item.label}</span>
                    <span className="so-team-rate">{item.value}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="so-formula-bar">
          <span className="so-formula-icon">ƒ</span>
          <code>{formulaText}</code>
        </div>
      </main>
    </div>
  );
}

export default StrikeoutProjections;
