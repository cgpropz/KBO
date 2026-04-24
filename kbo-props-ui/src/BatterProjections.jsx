import { useState, useEffect, useCallback, useMemo } from 'react';
import './BatterProjections.css';
import { fetchDataSnapshot } from './dataUrl';

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

const HITRATE_MIN = 30;
const HITRATE_MID = 50;
const HITRATE_MAX = 75;

const WHIP_TOUGH = 1.1;
const WHIP_NEUTRAL = 1.3;
const WHIP_EASY = 1.45;

const SCALE_RED = { r: 239, g: 68, b: 68 };
const SCALE_NEUTRAL = { r: 203, g: 213, b: 225 };
const SCALE_GREEN = { r: 34, g: 197, b: 94 };

// Field-relative wind arrow. arrowDeg=0 → up = Out to CF, 90 → right = Out to RF.
// Falls back to absolute compass if arrowDeg is unavailable.
function WindArrow({ arrowDeg, deg, size = 12 }) {
  let rotate;
  if (arrowDeg != null) {
    rotate = (Number(arrowDeg) - 90 + 360) % 360;
  } else if (deg != null) {
    rotate = ((Number(deg) + 180) - 90 + 360) % 360;
  } else {
    return null;
  }
  return (
    <span
      style={{ display: 'inline-block', transform: `rotate(${rotate}deg)`, width: size, height: size, lineHeight: 1, fontSize: size }}
      aria-hidden="true"
    >➤</span>
  );
}

function BatterProjections() {
  const [data, setData] = useState(null);
  const [prizepicksData, setPrizepicksData] = useState(null);
  const [photos, setPhotos] = useState({});
  const [matchupData, setMatchupData] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('edge');
  const [sortDir, setSortDir] = useState('desc');
  const [propFilter, setPropFilter] = useState('all');
  const [oddsTypeFilter, setOddsTypeFilter] = useState('all');
  const [hitRateFilter, setHitRateFilter] = useState('all');
  const [playerSearch, setPlayerSearch] = useState('');

  const debugLog = (...args) => { if (typeof window !== 'undefined') console.log('[BatterProjections]', ...args); };

  const loadBatterData = useCallback((background = false) => {
    if (!background) setLoading(true);
    debugLog('Fetching batter data...', { background });
    return Promise.all([
      fetchDataSnapshot('batter_projections.json'),
      fetchDataSnapshot('prizepicks_props.json').catch(() => null),
      fetchDataSnapshot('player_photos.json').catch(() => null),
      fetchDataSnapshot('matchup_data.json').catch(() => null),
    ])
      .then(([batterSnap, ppSnap, photoSnap, matchupSnap]) => {
        const projections = batterSnap?.data?.projections || [];
        debugLog('Data loaded:', { projections: projections.length, ppCards: ppSnap?.data?.cards?.length || 0, photos: Object.keys(photoSnap?.data || {}).length, generatedAt: batterSnap?.data?.generated_at });
        setData(batterSnap?.data || null);
        setPrizepicksData(ppSnap?.data || null);
        setPhotos(photoSnap?.data || {});
        setMatchupData(matchupSnap?.data || null);
        setLastUpdated(batterSnap?.updatedAt || batterSnap?.data?.generated_at || new Date().toISOString());
        setError(null);
        setLoading(false);
      })
      .catch(err => {
        debugLog('Error loading data:', err.message);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadBatterData(false);
    const interval = setInterval(() => loadBatterData(true), 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadBatterData]);

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

  const photoLookup = useMemo(() => {
    const lookup = {};
    for (const [name, url] of Object.entries(photos || {})) {
      lookup[normalizeName(name)] = url;
    }
    return lookup;
  }, [photos]);

  // Map home_team -> weather (used for wind column)
  const weatherByHome = useMemo(() => {
    const map = {};
    const list = matchupData?.matchups || [];
    for (const m of list) {
      if (m?.home && m?.weather) map[m.home] = m.weather;
    }
    return map;
  }, [matchupData]);

  const playerInitials = (name) => String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';

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
    debugLog('Loading state active');
    return (
      <div className="bp-container">
        <div className="bp-loading">
          <div className="bp-spinner" /><p>Loading batter projections...</p>
        </div>
      </div>
    );
  }
  if (error) {
    debugLog('Error state:', error);
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

  const propToPrizepicksStat = {
    'Hits+Runs+RBIs': 'Hits+Runs+RBIs',
    'Total Bases': 'Total Bases',
  };

  // Map keyed by `${stat}@@${team}@@${opp}@@${nameKey}` -> array of
  // { line, odds_type } variants from the live PrizePicks card. Multiple
  // variants exist when PP offers standard + goblin/demon for the same prop.
  const ppVariantsByKey = (() => {
    const map = new Map();
    const cards = prizepicksData?.cards || [];
    for (const card of cards) {
      if (card?.type !== 'batter') continue;
      const team = card?.team || '';
      const opp = card?.opponent || '';
      const norm = normalizeName(card?.name);
      const sig = nameSignature(card?.name);
      const byStat = new Map();

      for (const prop of card?.props || []) {
        const stat = prop?.stat;
        const line = Number(prop?.line);
        if (!Number.isFinite(line)) continue;
        if (!['Hits+Runs+RBIs', 'Total Bases'].includes(stat)) continue;
        if (!byStat.has(stat)) byStat.set(stat, []);
        byStat.get(stat).push({
          line,
          odds_type: (prop?.odds_type || 'standard').toLowerCase(),
        });
      }

      for (const [stat, variants] of byStat.entries()) {
        // Sort by line ascending so picks are stable.
        variants.sort((a, b) => a.line - b.line);
        map.set(`${stat}@@${team}@@${opp}@@${norm}`, variants);
        map.set(`${stat}@@${team}@@${opp}@@sig:${sig}`, variants);
      }
    }
    return map;
  })();

  // Pick the variant that best matches the projection's stored line/odds_type.
  // 1) Exact line match preferred (and odds_type-equal break-tie if duplicates)
  // 2) Same odds_type if the projection's odds_type appears live
  // 3) Otherwise: median variant
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

  const mergedProjections = (data?.projections || []).map((p) => {
    const ppStat = propToPrizepicksStat[p.prop];
    if (!ppStat) return p;
    const team = p.team || '';
    const opp = p.opponent || '';
    const norm = normalizeName(p.name);
    const sig = nameSignature(p.name);
    const variants =
      ppVariantsByKey.get(`${ppStat}@@${team}@@${opp}@@${norm}`)
      ?? ppVariantsByKey.get(`${ppStat}@@${team}@@${opp}@@sig:${sig}`);

    const variant = pickVariant(
      variants,
      Number(p.line),
      (p.odds_type || 'standard').toLowerCase(),
    );
    if (!variant) return p;

    const liveLine = variant.line;
    const oddsType = variant.odds_type;

    const projection = Number(p.projection);
    const edge = Number.isFinite(projection) ? projection - liveLine : null;
    const isPromo = oddsType === 'demon' || oddsType === 'goblin';
    let recommendation =
      edge == null
        ? 'NO LINE'
        : edge > 0
          ? 'OVER'
          : edge < 0
            ? 'UNDER'
            : 'PUSH';
    if (isPromo && recommendation === 'UNDER') recommendation = 'PUSH';

    return {
      ...p,
      line: liveLine,
      odds_type: oddsType,
      edge: edge != null ? Number(edge.toFixed(2)) : null,
      rating: Number.isFinite(projection) && liveLine
        ? Number(((projection / liveLine) * 50).toFixed(1))
        : null,
      recommendation,
    };
  });

  const filtered = mergedProjections.filter((p) => {
    if (propFilter !== 'all' && p.prop !== propFilter) return false;
    if (oddsTypeFilter !== 'all') {
      const ot = (p.odds_type || 'standard').toLowerCase();
      if (oddsTypeFilter === 'promo' && ot !== 'goblin' && ot !== 'demon') return false;
      if (oddsTypeFilter !== 'promo' && ot !== oddsTypeFilter) return false;
    }
    if (playerSearch.trim()) {
      const query = playerSearch.trim().toLowerCase();
      if (!String(p.name || '').toLowerCase().includes(query)) return false;
    }
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

  const oddsTypeBadge = (oddsType) => {
    if (oddsType === 'demon' || oddsType === 'goblin') {
      return <span className={`odds-type-badge ${oddsType}`}>{oddsType.toUpperCase()}</span>;
    }
    return null;
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  const blendColor = (from, to, t) => ({
    r: Math.round(lerp(from.r, to.r, t)),
    g: Math.round(lerp(from.g, to.g, t)),
    b: Math.round(lerp(from.b, to.b, t)),
  });

  const getHitRateStyle = (rate) => {
    if (rate == null || Number.isNaN(rate)) return undefined;

    const clamped = Math.max(HITRATE_MIN, Math.min(HITRATE_MAX, rate));
    let rgb;

    if (clamped <= HITRATE_MID) {
      const t = (clamped - HITRATE_MIN) / (HITRATE_MID - HITRATE_MIN);
      rgb = blendColor(SCALE_RED, SCALE_NEUTRAL, t);
    } else {
      const t = (clamped - HITRATE_MID) / (HITRATE_MAX - HITRATE_MID);
      rgb = blendColor(SCALE_NEUTRAL, SCALE_GREEN, t);
    }

    return {
      color: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`,
      fontWeight: 700,
    };
  };

  const getWhipStyle = (whip) => {
    if (whip == null || Number.isNaN(whip)) return undefined;

    const clamped = Math.max(WHIP_TOUGH, Math.min(WHIP_EASY, whip));
    let rgb;

    if (clamped <= WHIP_NEUTRAL) {
      const t = (clamped - WHIP_TOUGH) / (WHIP_NEUTRAL - WHIP_TOUGH);
      rgb = blendColor(SCALE_RED, SCALE_NEUTRAL, t);
    } else {
      const t = (clamped - WHIP_NEUTRAL) / (WHIP_EASY - WHIP_NEUTRAL);
      rgb = blendColor(SCALE_NEUTRAL, SCALE_GREEN, t);
    }

    return {
      color: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`,
      fontWeight: 700,
    };
  };

  const AVG_RED  = 0.200;
  const AVG_MID  = 0.250;
  const AVG_GREEN = 0.350;

  const OPS_RED = 0.750;
  const OPS_MID = 0.900;
  const OPS_GREEN = 1.000;

  const getSplitAvgStyle = (avg) => {
    if (avg == null || Number.isNaN(avg)) return undefined;
    const clamped = Math.max(AVG_RED, Math.min(AVG_GREEN, avg));
    let rgb;
    if (clamped <= AVG_MID) {
      const t = (clamped - AVG_RED) / (AVG_MID - AVG_RED);
      rgb = blendColor(SCALE_RED, SCALE_NEUTRAL, t);
    } else {
      const t = (clamped - AVG_MID) / (AVG_GREEN - AVG_MID);
      rgb = blendColor(SCALE_NEUTRAL, SCALE_GREEN, t);
    }
    return {
      color: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`,
      fontWeight: 700,
    };
  };

  const getOpsStyle = (ops) => {
    if (ops == null || Number.isNaN(ops)) return undefined;
    const clamped = Math.max(OPS_RED, Math.min(OPS_GREEN, ops));
    let rgb;
    if (clamped <= OPS_MID) {
      const t = (clamped - OPS_RED) / (OPS_MID - OPS_RED);
      rgb = blendColor(SCALE_RED, SCALE_NEUTRAL, t);
    } else {
      const t = (clamped - OPS_MID) / (OPS_GREEN - OPS_MID);
      rgb = blendColor(SCALE_NEUTRAL, SCALE_GREEN, t);
    }
    return {
      color: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`,
      fontWeight: 700,
    };
  };

  return (
    <div className="bp-container">
      <header className="bp-header">
        <h1 className="bp-title">🇰🇷 ⚾️ KBO Batter Projections ⚾️ 🇰🇷</h1>
        {lastUpdated ? <p className="bp-subtitle">Updated {new Date(lastUpdated).toLocaleString()}</p> : null}
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

          {[
            { key: 'all', label: 'Any Line' },
            { key: 'standard', label: 'Standard' },
            { key: 'goblin', label: '🟢 Goblin' },
            { key: 'demon', label: '🔴 Demon' },
            { key: 'promo', label: 'Promos' },
          ].map(({ key, label }) => (
            <button
              key={`ot-${key}`}
              className={`bp-filter-btn bp-filter-btn-ot ${oddsTypeFilter === key ? 'active' : ''}`}
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

          <input
            className="bp-player-search"
            type="text"
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search player..."
            aria-label="Search player"
          />
        </div>
      </header>

      <main className="bp-main">
        <div className="bp-table-wrap">
          <table className="bp-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')}>Player {sortIcon('name')}</th>
                <th onClick={() => handleSort('team')}>Team {sortIcon('team')}</th>
                <th onClick={() => handleSort('batter_hand')} className="col-center">Bat {sortIcon('batter_hand')}</th>
                <th onClick={() => handleSort('opponent')}>Matchup {sortIcon('opponent')}</th>
                <th onClick={() => handleSort('opp_pitcher')}>Opp Pitcher {sortIcon('opp_pitcher')}</th>
                <th onClick={() => handleSort('opp_pitcher_hand')} className="col-center">Opp Hand {sortIcon('opp_pitcher_hand')}</th>
                <th className="col-center" title="Wind direction at home stadium (field-relative)">Wind</th>
                <th onClick={() => handleSort('ba')} className="col-num">2026{sortIcon('ba')}</th>
                <th onClick={() => handleSort('vs_rhp_avg')} className="col-num">vs RHP {sortIcon('vs_rhp_avg')}</th>
                <th onClick={() => handleSort('vs_lhp_avg')} className="col-num">vs LHP {sortIcon('vs_lhp_avg')}</th>
                <th onClick={() => handleSort('opp_pitcher_whip')} className="col-num">WHIP {sortIcon('opp_pitcher_whip')}</th>
                <th onClick={() => handleSort('ops')} className="col-num">OPS {sortIcon('ops')}</th>
                <th onClick={() => handleSort('prop')}>Prop {sortIcon('prop')}</th>
                <th onClick={() => handleSort('line')} className="col-num"><span className="pp-icon">P</span> {sortIcon('line')}</th>
                <th onClick={() => handleSort('projection')} className="col-num">Projection {sortIcon('projection')}</th>
                <th onClick={() => handleSort('avg_per_g')} className="col-num">Avg/G {sortIcon('avg_per_g')}</th>
                <th onClick={() => handleSort('hit_rate_l5')} className="col-num">L5 {sortIcon('hit_rate_l5')}</th>
                <th onClick={() => handleSort('hit_rate_l10')} className="col-num">L10 {sortIcon('hit_rate_l10')}</th>
                <th onClick={() => handleSort('hit_rate_full')} className="col-num">FULL {sortIcon('hit_rate_full')}</th>
                <th onClick={() => handleSort('rating')} className="col-num">Rating {sortIcon('rating')}</th>
                <th onClick={() => handleSort('edge')} className="col-num">Variance {sortIcon('edge')}</th>
                <th onClick={() => handleSort('recommendation')} className="col-center">VALUE {sortIcon('recommendation')}</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p, i) => (
                <tr key={i} className="bp-row">
                  <td className="col-player">
                    <div className="bp-player-cell">
                      {photoLookup[normalizeName(p.name)] ? (
                        <img
                          className="bp-player-avatar"
                          src={photoLookup[normalizeName(p.name)]}
                          alt={p.name}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="bp-player-fallback">{playerInitials(p.name)}</div>
                      )}
                      <span>{p.name}</span>
                    </div>
                  </td>
                  <td><span className="team-text" style={{ color: TEAMS[p.team] || '#999' }}>{p.team}</span></td>
                  <td className={`col-center mono ${!p.batter_hand || p.batter_hand === 'UNK' ? 'cell-na' : ''}`}>{p.batter_hand && p.batter_hand !== 'UNK' ? p.batter_hand : 'UNK'}</td>
                  <td><span className="team-text" style={{ color: TEAMS[p.opponent] || '#999' }}>{p.opponent}</span></td>
                  <td className="col-player">{p.opp_pitcher || '—'}</td>
                  <td className={`col-center mono ${!p.opp_pitcher_hand || p.opp_pitcher_hand === 'UNK' ? 'cell-na' : ''}`}>{p.opp_pitcher_hand && p.opp_pitcher_hand !== 'UNK' ? p.opp_pitcher_hand : 'UNK'}</td>
                  {(() => {
                    const w = weatherByHome[p.home_team];
                    if (!w) return <td className="col-center cell-na">—</td>;
                    if (w.is_dome) return <td className="col-center mono" title="Dome — no wind"><span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Dome</span></td>;
                    const effect = w.wind_effect || w.wind_compass || '';
                    const mph = w.wind_mph != null ? `${Math.round(w.wind_mph)}` : '';
                    return (
                      <td className="col-center mono" title={`${effect} · ${mph} mph`}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: '#cbd5e1' }}>
                          <WindArrow arrowDeg={w.wind_arrow_deg} deg={w.wind_deg} />
                          <span>{mph} mph</span>
                        </span>
                      </td>
                    );
                  })()}
                  <td className={`col-num mono ${p.ba == null ? 'cell-na' : ''}`} style={getSplitAvgStyle(p.ba)}>{p.ba != null ? Number(p.ba).toFixed(3) : '—'}</td>
                  <td className={`col-num mono ${p.vs_rhp_avg == null ? 'cell-na' : ''}`} style={getSplitAvgStyle(p.vs_rhp_avg)}>{p.vs_rhp_avg != null ? Number(p.vs_rhp_avg).toFixed(3) : '—'}</td>
                  <td className={`col-num mono ${p.vs_lhp_avg == null ? 'cell-na' : ''}`} style={getSplitAvgStyle(p.vs_lhp_avg)}>{p.vs_lhp_avg != null ? Number(p.vs_lhp_avg).toFixed(3) : '—'}</td>
                  <td
                    className={`col-num mono whip-cell ${p.opp_pitcher_whip == null ? 'cell-na' : ''}`}
                    style={getWhipStyle(p.opp_pitcher_whip)}
                  >
                    {p.opp_pitcher_whip != null ? Number(p.opp_pitcher_whip).toFixed(2) : '—'}
                  </td>
                  <td
                    className={`col-num mono ${p.ops == null ? 'cell-na' : ''}`}
                    style={getOpsStyle(p.ops)}
                  >
                    {p.ops != null ? Number(p.ops).toFixed(3) : '—'}
                  </td>
                  <td className="col-prop">{p.prop === 'Hits+Runs+RBIs' ? 'H+R+RBI' : 'TB'}</td>
                  <td className="col-num col-pp">
                    <span className="pp-cell"><span className="pp-icon-sm">P</span><span className="mono">{p.line != null ? p.line.toFixed(1) : '—'}</span></span>
                  </td>
                  <td className={`col-num mono ${p.projection == null ? 'cell-na' : 'col-projection'}`}>
                    {p.projection != null ? p.projection.toFixed(2) : '—'}
                  </td>
                  <td className={`col-num mono ${p.avg_per_g == null ? 'cell-na' : ''}`}>
                    {p.avg_per_g != null ? p.avg_per_g.toFixed(2) : '—'}
                  </td>
                  <td
                    className={`col-num mono hitrate-cell ${p.hit_rate_l5 == null ? 'cell-na' : ''}`}
                    style={getHitRateStyle(p.hit_rate_l5)}
                  >
                    {p.hit_rate_l5 != null ? `${p.hit_rate_l5.toFixed(1)}%` : '—'}
                  </td>
                  <td
                    className={`col-num mono hitrate-cell ${p.hit_rate_l10 == null ? 'cell-na' : ''}`}
                    style={getHitRateStyle(p.hit_rate_l10)}
                  >
                    {p.hit_rate_l10 != null ? `${p.hit_rate_l10.toFixed(1)}%` : '—'}
                  </td>
                  <td
                    className={`col-num mono hitrate-cell ${p.hit_rate_full == null ? 'cell-na' : ''}`}
                    style={getHitRateStyle(p.hit_rate_full)}
                  >
                    {p.hit_rate_full != null ? `${p.hit_rate_full.toFixed(1)}%` : '—'}
                  </td>
                  <td className={`col-num mono ${p.rating != null ? (p.rating >= 75 ? 'rate-high' : p.rating < 30 ? 'rate-low' : p.rating >= 50 ? 'rate-mid' : 'rate-cool') : ''}`}>
                    {p.rating != null ? p.rating.toFixed(1) : ''}
                  </td>
                  <td className={`col-num mono ${p.edge != null ? (p.edge > 0 ? 'var-pos' : p.edge < -0.3 ? 'var-neg' : '') : 'cell-na'}`}>
                    {p.edge != null ? p.edge.toFixed(2) : '—'}
                  </td>
                  <td className="col-center">
                    <span className={`val-badge ${getValClass(p.recommendation)}`}>{p.recommendation}</span>
                    {oddsTypeBadge(p.odds_type)}
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
              <div className="bp-legend-item"><span className="val-badge val-over">OVER</span><span>Projection &gt; Line</span></div>
              <div className="bp-legend-item"><span className="val-badge val-under">UNDER</span><span>Projection &lt; Line</span></div>
              <div className="bp-legend-item"><span className="val-badge val-push">PUSH</span><span>Projection = Line</span></div>
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
