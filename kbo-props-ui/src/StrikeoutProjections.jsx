import React, { useState, useEffect, useMemo } from 'react';
import './StrikeoutProjections.css';
import { fetchData } from './dataUrl';

// Hit rate color scale (matches BatterProjections)
const HITRATE_MIN = 30;
const HITRATE_MID = 50;
const HITRATE_MAX = 75;
const SCALE_RED = [239, 68, 68];
const SCALE_NEUTRAL = [203, 213, 225];
const SCALE_GREEN = [34, 197, 94];
const lerp = (a, b, t) => a + (b - a) * t;
const blendColor = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
const getHitRateStyle = (rate) => {
  if (rate == null || !Number.isFinite(Number(rate))) return {};
  const r = Math.max(HITRATE_MIN, Math.min(HITRATE_MAX, Number(rate)));
  let rgb;
  if (r <= HITRATE_MID) {
    const t = (r - HITRATE_MIN) / (HITRATE_MID - HITRATE_MIN);
    rgb = blendColor(SCALE_RED, SCALE_NEUTRAL, t);
  } else {
    const t = (r - HITRATE_MID) / (HITRATE_MAX - HITRATE_MID);
    rgb = blendColor(SCALE_NEUTRAL, SCALE_GREEN, t);
  }
  const [rr, gg, bb] = rgb;
  return {
    color: `rgb(${rr}, ${gg}, ${bb})`,
    backgroundColor: `rgba(${rr}, ${gg}, ${bb}, 0.18)`,
    fontWeight: 700,
  };
};

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

function StrikeoutProjections({ onNavigate }) {
  const [data, setData] = useState(null);
  const [matchupData, setMatchupData] = useState(null);
  const [opponentStatsData, setOpponentStatsData] = useState(null);
  const [prizepicksData, setPrizepicksData] = useState(null);
  const [photos, setPhotos] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProp, setSelectedProp] = useState('all');
  const [oddsTypeFilter, setOddsTypeFilter] = useState('all');
  const [sortField, setSortField] = useState('edge');
  const [sortDir, setSortDir] = useState('desc');
  const [parlayPicks, setParlayPicks] = useState([]); // array of {name, team, opponent, prop, line, projection, edge, side}
  const [expandedRow, setExpandedRow] = useState(null); // index of expanded row or null

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

  // Parlay builder helpers
  const pickKey = (p) => `${p.name}@@${p.prop}@@${p.team}@@${p.opponent}`;
  const isPicked = (p) => parlayPicks.some(pk => pickKey(pk) === pickKey(p));

  const togglePick = (p) => {
    const key = pickKey(p);
    if (parlayPicks.some(pk => pickKey(pk) === key)) {
      setParlayPicks(prev => prev.filter(pk => pickKey(pk) !== key));
    } else {
      const isPromo = p.odds_type === 'demon' || p.odds_type === 'goblin';
      const side = isPromo ? 'OVER' : (p.edge != null && p.edge >= 0) ? 'OVER' : 'UNDER';
      setParlayPicks(prev => [...prev, {
        name: p.name, team: p.team, opponent: p.opponent,
        prop: p.prop, line: p.line, projection: p.projection,
        edge: p.edge, rating: p.rating, side, odds_type: p.odds_type,
      }]);
    }
  };

  const sendToSlipBuilder = () => {
    try { localStorage.setItem('kbo_parlay_import', JSON.stringify(parlayPicks)); } catch {}
    if (onNavigate) onNavigate('optimizer');
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

  const ppVariantsByKey = (() => {
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
        buckets.get(stat).push({
          line,
          odds_type: (prop?.odds_type || 'standard').toLowerCase(),
        });
      }

      for (const [stat, variants] of buckets.entries()) {
        variants.sort((a, b) => a.line - b.line);
        const exactKey = `${stat}@@${team}@@${opp}@@${norm}`;
        const sigKey = `${stat}@@${team}@@${opp}@@sig:${sig}`;
        const teamOppKey = `${stat}@@${team}@@${opp}@@teamOpp`;
        const nameTeamKey = `${stat}@@${team}@@${norm}`;
        const sigTeamKey = `${stat}@@${team}@@sig:${sig}`;
        map.set(exactKey, variants);
        map.set(sigKey, variants);
        if (!map.has(nameTeamKey)) map.set(nameTeamKey, variants);
        if (!map.has(sigTeamKey)) map.set(sigTeamKey, variants);
        if (!teamOppBuckets.has(teamOppKey)) teamOppBuckets.set(teamOppKey, []);
        teamOppBuckets.get(teamOppKey).push(variants);
      }
    }

    for (const [key, lists] of teamOppBuckets.entries()) {
      // Only safe to use if exactly one variant-list across the bucket
      const flat = lists.flat();
      if (lists.length === 1) {
        map.set(key, flat);
      }
    }
    return map;
  })();

  const pickVariant = (variants, projLine, projOddsType) => {
    if (!variants?.length) return null;
    if (Number.isFinite(projLine)) {
      const exact = variants.filter((v) => v.line === projLine);
      if (exact.length) {
        const match = exact.find((v) => v.odds_type === projOddsType);
        return match || exact[0];
      }
    }
    if (projOddsType) {
      const sameType = variants.find((v) => v.odds_type === projOddsType);
      if (sameType) return sameType;
    }
    return variants[Math.floor(variants.length / 2)];
  };

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
    let variants = null;
    for (const ppStat of ppStats) {
      const exactKey = `${ppStat}@@${p.team}@@${p.opponent}@@${norm}`;
      const sigKey = `${ppStat}@@${p.team}@@${p.opponent}@@sig:${sig}`;
      const teamOppKey = `${ppStat}@@${p.team}@@${p.opponent}@@teamOpp`;
      const nameTeamKey = `${ppStat}@@${p.team}@@${norm}`;
      const sigTeamKey = `${ppStat}@@${p.team}@@sig:${sig}`;
      variants =
        ppVariantsByKey.get(exactKey)
        ?? ppVariantsByKey.get(sigKey)
        ?? ppVariantsByKey.get(teamOppKey)
        ?? ppVariantsByKey.get(nameTeamKey)
        ?? ppVariantsByKey.get(sigTeamKey);
      if (variants?.length) break;
    }

    const variant = pickVariant(
      variants,
      Number(p.line),
      (p.odds_type || 'standard').toLowerCase(),
    );
    const liveLine = variant?.line ?? null;
    const liveOddsType = variant?.odds_type ?? p.odds_type ?? 'standard';

    const projection = Number(p.projection);
    const edge = Number.isFinite(projection) && liveLine ? projection - liveLine : null;

    return {
      ...p,
      line: liveLine,
      odds_type: liveOddsType,
      edge: edge != null ? Number(edge.toFixed(1)) : null,
      rating: Number.isFinite(projection) && liveLine ? Number(((projection / liveLine) * 50).toFixed(1)) : null,
      opp_k_pct: oppStats.k_pct,
      opp_ba: oppStats.ba,
    };
  });

  const filtered = mergedScoped.filter((p) => {
    if (selectedProp !== 'all' && p.prop !== selectedProp) return false;
    if (oddsTypeFilter !== 'all') {
      const ot = (p.odds_type || 'standard').toLowerCase();
      if (oddsTypeFilter === 'promo' && ot !== 'goblin' && ot !== 'demon') return false;
      if (oddsTypeFilter !== 'promo' && ot !== oddsTypeFilter) return false;
    }
    return true;
  });

  // Always sort by highest rating by default
  const projections = [...filtered].sort((a, b) => {
    let aVal = a[sortField], bVal = b[sortField];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    return bVal - aVal; // Always descending by rating
  });
  const debugLog = (...args) => { if (typeof window !== 'undefined') { console.log('[StrikeoutProjections]', ...args); } };
  debugLog('Filtered projections:', projections);

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

  const deriveValue = (proj, line) => {
    if (proj == null || line == null) return 'PUSH';
    if (proj > line) return 'OVER';
    if (proj < line) return 'UNDER';
    return 'PUSH';
  };

  const getValClass = (val) => {
    if (val === 'OVER') return 'val-over';
    if (val === 'UNDER') return 'val-under';
    return 'val-push';
  };

  // Color scaling for opponent K% (strikeout rate)
  // Low K% (like 21.5%) = Red (hard - fewer strikeouts)
  // Mid K% (like 24%) = Neutral gray
  // High K% (like 26.3%) = Green (easy - more strikeouts)
  const oppKPctBg = (val) => {
    if (val == null) return {};
    if (val >= 25.0) return { backgroundColor: '#1a4d1a', color: '#fff' }; // Dark green - very easy
    if (val >= 24.0) return { backgroundColor: '#2d7f2d', color: '#fff' }; // Green - easy
    if (val >= 23.0) return { backgroundColor: '#4d4d4d', color: '#fff' }; // Gray - neutral
    if (val >= 22.0) return { backgroundColor: '#8b5a5a', color: '#fff' }; // Dark gray - slightly tough
    return { backgroundColor: '#802020', color: '#fff' }; // Red - tough
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

  // Matchup detail lookup: find the matchup + pitcher data for a projection row
  const getMatchupDetail = (p) => {
    const matchups = matchupData?.matchups || [];
    for (const m of matchups) {
      // Determine if this pitcher is home or away
      if (m.home_pitcher?.profile?.name && normalizeName(m.home_pitcher.profile.name) === normalizeName(p.name) && m.home === p.team) {
        return { matchup: m, pitcher: m.home_pitcher, oppBatting: m.away_batting, side: 'home' };
      }
      if (m.away_pitcher?.profile?.name && normalizeName(m.away_pitcher.profile.name) === normalizeName(p.name) && m.away === p.team) {
        return { matchup: m, pitcher: m.away_pitcher, oppBatting: m.home_batting, side: 'away' };
      }
    }
    return null;
  };

  const weatherIcon = (condition) => {
    if (!condition) return '🌤';
    const c = condition.toLowerCase();
    if (c.includes('rain') || c.includes('shower')) return '🌧';
    if (c.includes('cloud') || c.includes('overcast')) return '☁️';
    if (c.includes('clear') || c.includes('sunny')) return '☀️';
    if (c.includes('partly')) return '⛅';
    if (c.includes('fog') || c.includes('mist')) return '🌫';
    return '🌤';
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
          <span className="so-filter-divider" aria-hidden="true" />
          {[
            { key: 'all', label: 'Any Line' },
            { key: 'standard', label: 'Standard' },
            { key: 'goblin', label: '\uD83D\uDFE2 Goblin' },
            { key: 'demon', label: '\uD83D\uDD34 Demon' },
            { key: 'promo', label: 'Promos' },
          ].map(({ key, label }) => (
            <button
              key={`ot-${key}`}
              className={`so-filter-btn ${oddsTypeFilter === key ? 'active' : ''}`}
              onClick={() => setOddsTypeFilter(key)}
              title={
                key === 'goblin' ? 'Easier line / lower payout'
                : key === 'demon' ? 'Harder line / higher payout'
                : key === 'promo' ? 'Goblin or Demon'
                : key === 'standard' ? 'Standard PrizePicks line'
                : 'Show all line types'
              }
            >
              {label}
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
                <th className="col-pick"></th>
                <th onClick={() => handleSort('name')}>Player {sortIcon('name')}</th>
                <th onClick={() => handleSort('team')}>Team {sortIcon('team')}</th>
                <th onClick={() => handleSort('opponent')}>Matchup {sortIcon('opponent')}</th>
                <th onClick={() => handleSort('opp_ba')} className="col-num">Opp BA {sortIcon('opp_ba')}</th>
                <th onClick={() => handleSort('opp_k_pct')} className="col-num">Opp K% {sortIcon('opp_k_pct')}</th>
                <th>Prop</th>
                <th onClick={() => handleSort('line')} className="col-num"><span className="pp-icon">P</span> {sortIcon('line')}</th>
                <th onClick={() => handleSort('projection')} className="col-num">Projection {sortIcon('projection')}</th>
                <th onClick={() => handleSort('hit_rate_l5')} className="col-num">L5 Hit% {sortIcon('hit_rate_l5')}</th>
                <th onClick={() => handleSort('hit_rate_full')} className="col-num">Full Hit% {sortIcon('hit_rate_full')}</th>
                <th onClick={() => handleSort('rating')} className="col-num">Rating {sortIcon('rating')}</th>
                <th onClick={() => handleSort('edge')} className="col-num">Variance {sortIcon('edge')}</th>
                <th onClick={() => handleSort('recommendation')} className="col-center">VALUE {sortIcon('recommendation')}</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p, i) => {
                const isExpanded = expandedRow === i;
                const detail = isExpanded ? getMatchupDetail(p) : null;
                const profile = detail?.pitcher?.profile || {};
                const recent = profile.recent || [];
                const weather = detail?.matchup?.weather;
                const park = detail?.matchup?.park_factor;
                const oppBat = detail?.oppBatting;
                return (
                <React.Fragment key={i}>
                <tr className={`so-row ${isPicked(p) ? 'so-row-picked' : ''} ${isExpanded ? 'so-row-expanded' : ''}`}
                    onClick={(e) => { if (!e.target.closest('.parlay-check')) setExpandedRow(isExpanded ? null : i); }}
                    style={{ cursor: 'pointer' }}
                >
                  <td className="col-pick">
                    <div
                      className={`parlay-check ${isPicked(p) ? 'checked' : ''}`}
                      onClick={(e) => { e.stopPropagation(); togglePick(p); }}
                    >
                      {isPicked(p) && '✓'}
                    </div>
                  </td>
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
                      <span className="expand-arrow">{isExpanded ? '▾' : '▸'}</span>
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
                  <td className="col-num mono" style={getHitRateStyle(p.hit_rate_l5)}>
                    {p.hit_rate_l5 != null ? `${Math.round(p.hit_rate_l5)}%` : '—'}
                  </td>
                  <td className="col-num mono" style={getHitRateStyle(p.hit_rate_full)}>
                    {p.hit_rate_full != null ? `${Math.round(p.hit_rate_full)}%` : '—'}
                  </td>
                  <td className={`col-num mono ${p.rating != null ? (p.rating >= 75 ? 'rate-high' : p.rating < 30 ? 'rate-low' : p.rating >= 50 ? 'rate-mid' : 'rate-cool') : ''}`}>
                    {p.rating != null ? p.rating.toFixed(1) : ''}
                  </td>
                  <td className={`col-num mono ${p.edge != null ? (p.edge > 0 ? 'var-pos' : p.edge < -0.5 ? 'var-neg' : '') : 'cell-na'}`}>
                    {p.edge != null ? p.edge.toFixed(1) : '#N/A'}
                  </td>
                  <td className="col-center">
                    {(() => { const val = deriveValue(p.projection, p.line); return (
                    <span className={`val-badge ${getValClass(val)}`}>
                      {val}
                    </span>
                    ); })()}
                    {(p.odds_type === 'demon' || p.odds_type === 'goblin') && (
                      <span className={`odds-type-badge ${p.odds_type}`}>{p.odds_type.toUpperCase()}</span>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="so-detail-row">
                    <td colSpan="14">
                      <div className="so-detail-panel">
                        {detail ? (
                          <>
                            {/* Pitcher profile stats */}
                            <div className="so-detail-section">
                              <h4 className="so-detail-heading">📊 Season Profile</h4>
                              <div className="so-detail-stats">
                                <div className="so-detail-stat">
                                  <span className="so-detail-label">ERA</span>
                                  <span className="so-detail-val">{profile.era != null ? Number(profile.era).toFixed(2) : '—'}</span>
                                </div>
                                <div className="so-detail-stat">
                                  <span className="so-detail-label">WHIP</span>
                                  <span className="so-detail-val">{profile.whip != null ? Number(profile.whip).toFixed(2) : '—'}</span>
                                </div>
                                <div className="so-detail-stat">
                                  <span className="so-detail-label">K/9</span>
                                  <span className="so-detail-val">{profile.k_per_9 != null ? Number(profile.k_per_9).toFixed(1) : '—'}</span>
                                </div>
                                <div className="so-detail-stat">
                                  <span className="so-detail-label">IP/G</span>
                                  <span className="so-detail-val">{profile.ip_per_g != null ? Number(profile.ip_per_g).toFixed(1) : '—'}</span>
                                </div>
                                <div className="so-detail-stat">
                                  <span className="so-detail-label">Starts</span>
                                  <span className="so-detail-val">{profile.starts ?? '—'}</span>
                                </div>
                                <div className="so-detail-stat">
                                  <span className="so-detail-label">Total K</span>
                                  <span className="so-detail-val">{profile.total_so ?? '—'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Recent games */}
                            {recent.length > 0 && (
                              <div className="so-detail-section">
                                <h4 className="so-detail-heading">🔥 Recent Starts</h4>
                                <div className="so-recent-table-wrap">
                                  <table className="so-recent-table">
                                    <thead>
                                      <tr>
                                        <th>Date</th>
                                        <th>Opp</th>
                                        <th>IP</th>
                                        <th>K</th>
                                        <th>HA</th>
                                        <th>BB</th>
                                        <th>ER</th>
                                        <th>ERA</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {recent.slice(0, 5).map((g, gi) => (
                                        <tr key={gi}>
                                          <td className="mono">{g.date}</td>
                                          <td><span style={{ color: TEAMS[g.opp] || '#999' }}>{g.opp}</span></td>
                                          <td className="mono">{g.ip}</td>
                                          <td className="mono so-recent-k">{g.so}</td>
                                          <td className="mono">{g.ha}</td>
                                          <td className="mono">{g.bb}</td>
                                          <td className="mono">{g.er}</td>
                                          <td className="mono">{Number(g.era).toFixed(2)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Weather + Park Factor row */}
                            <div className="so-detail-context">
                              {weather && (
                                <div className="so-detail-section so-detail-weather">
                                  <h4 className="so-detail-heading">{weatherIcon(weather.condition)} Weather</h4>
                                  <div className="so-detail-stats">
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">Temp</span>
                                      <span className="so-detail-val">{weather.temp_f}°F</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">Wind</span>
                                      <span className="so-detail-val">{weather.wind_kmh} km/h</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">Rain</span>
                                      <span className="so-detail-val">{weather.precip_pct}%</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">Sky</span>
                                      <span className="so-detail-val">{weather.condition}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {park && (
                                <div className="so-detail-section so-detail-park">
                                  <h4 className="so-detail-heading">🏟 {park.stadium}</h4>
                                  <div className="so-detail-stats">
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">R Factor</span>
                                      <span className={`so-detail-val ${park.r_factor > 1 ? 'var-pos' : park.r_factor < 1 ? 'edge-neg' : ''}`}>{Number(park.r_factor).toFixed(3)}</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">HR Factor</span>
                                      <span className={`so-detail-val ${park.hr_factor > 1 ? 'var-pos' : park.hr_factor < 1 ? 'edge-neg' : ''}`}>{Number(park.hr_factor).toFixed(3)}</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">H/G</span>
                                      <span className="so-detail-val">{Number(park.h_per_g).toFixed(1)}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {oppBat && (
                                <div className="so-detail-section so-detail-opp">
                                  <h4 className="so-detail-heading">🏏 vs {p.opponent} Lineup</h4>
                                  <div className="so-detail-stats">
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">BA</span>
                                      <span className="so-detail-val">{Number(oppBat.ba).toFixed(3)}</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">OPS</span>
                                      <span className="so-detail-val">{Number(oppBat.ops).toFixed(3)}</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">K/G</span>
                                      <span className="so-detail-val">{Number(oppBat.so_per_g).toFixed(1)}</span>
                                    </div>
                                    <div className="so-detail-stat">
                                      <span className="so-detail-label">R/G</span>
                                      <span className="so-detail-val">{Number(oppBat.r_per_g).toFixed(1)}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="so-detail-empty">No matchup data available for this pitcher today.</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom panels */}
        <div className="so-bottom-panels">
          <div className="so-panel so-legend">
            <h3 className="so-panel-title">Legend</h3>
            <div className="so-legend-items">
              <div className="so-legend-item"><span className="val-badge val-over">OVER</span><span>Projection &gt; Line</span></div>
              <div className="so-legend-item"><span className="val-badge val-under">UNDER</span><span>Projection &lt; Line</span></div>
              <div className="so-legend-item"><span className="val-badge val-push">PUSH</span><span>Projection = Line</span></div>
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

        {/* Parlay Builder Tray */}
        {parlayPicks.length > 0 && (
          <div className="parlay-tray">
            <div className="parlay-tray-header">
              <span className="parlay-tray-title">
                Parlay Builder
                <span className="parlay-tray-count">{parlayPicks.length}</span>
              </span>
              <button className="parlay-tray-clear" onClick={() => setParlayPicks([])}>Clear</button>
            </div>
            <div className="parlay-tray-legs">
              {parlayPicks.map((pk, i) => (
                <div key={i} className="parlay-tray-leg">
                  <span className="parlay-tray-name">{pk.name}</span>
                  <span className="parlay-tray-prop">{pk.prop === 'Strikeouts' ? 'K' : pk.prop === 'Hits Allowed' ? 'HA' : 'OUTS'}</span>
                  <span className="parlay-tray-line"><span className="pp-icon-sm">P</span>{pk.line != null ? pk.line.toFixed(1) : '—'}</span>
                  <span className={`parlay-tray-side ${pk.side === 'OVER' ? 'side-over' : 'side-under'}`}
                    onClick={() => setParlayPicks(prev => prev.map((p, j) => j === i ? { ...p, side: p.side === 'OVER' ? 'UNDER' : 'OVER' } : p))}
                  >{pk.side}</span>
                  <span className={`parlay-tray-edge ${pk.edge > 0 ? 'edge-pos' : 'edge-neg'}`}>
                    {pk.edge != null ? (pk.edge > 0 ? '+' : '') + pk.edge.toFixed(1) : ''}
                  </span>
                  <button className="parlay-tray-remove" onClick={() => setParlayPicks(prev => prev.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
            <button className="parlay-tray-send" onClick={sendToSlipBuilder}>
              Send to Slip Builder →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default StrikeoutProjections;
