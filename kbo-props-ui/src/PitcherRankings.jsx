import { useState, useEffect, useCallback, useMemo } from 'react';
import './PitcherRankings.css';
import { fetchDataSnapshot } from './dataUrl';

const TEAMS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
};

const TEAM_ALIASES = {
  DOO: 'Doosan',
  DOOSAN: 'Doosan',
  HAN: 'Hanwha',
  HANWHA: 'Hanwha',
  KIA: 'Kia',
  KIW: 'Kiwoom',
  KIWOOM: 'Kiwoom',
  KT: 'KT',
  KTW: 'KT',
  LG: 'LG',
  LOT: 'Lotte',
  LOTTE: 'Lotte',
  NC: 'NC',
  NCD: 'NC',
  SAM: 'Samsung',
  SAMSUNG: 'Samsung',
  SSG: 'SSG',
};

const canonicalTeam = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return TEAM_ALIASES[text] || TEAM_ALIASES[text.toUpperCase()] || text;
};

function PitcherRankings() {
  const [data, setData] = useState(null);
  const [ppProjections, setPpProjections] = useState([]);
  const [prizepicksData, setPrizepicksData] = useState(null);
  const [matchupData, setMatchupData] = useState(null);
  const [ppOnly, setPpOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('rk');
  const [sortDir, setSortDir] = useState('asc');
  const [lastUpdated, setLastUpdated] = useState(null);

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

  const parseIso = (value) => {
    if (!value) return null;
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const debugLog = (...args) => { if (typeof window !== 'undefined') console.log('[PitcherRankings]', ...args); };

  const loadRankings = useCallback((background = false) => {
    if (!background) setLoading(true);
    debugLog('Fetching rankings...', { background });
    Promise.all([
      fetchDataSnapshot('pitcher_rankings.json'),
      fetchDataSnapshot('strikeout_projections.json').catch(() => null),
      fetchDataSnapshot('prizepicks_props.json').catch(() => null),
      fetchDataSnapshot('matchup_data.json').catch(() => null),
    ])
      .then(([rankingsSnap, kSnap, ppSnap, matchupSnap]) => {
        const rankings = (rankingsSnap?.data || []).map((row) => ({
          ...row,
          team: canonicalTeam(row?.team || ''),
          opp_team: canonicalTeam(row?.opp_team || ''),
        }));
        const ppProj = (kSnap?.data?.projections || []).filter((p) => p?.line != null);
        debugLog('Data loaded:', {
          rankings: rankings.length,
          ppProjections: ppProj.length,
          ppCards: ppSnap?.data?.cards?.length || 0,
          slateGames: matchupSnap?.data?.matchups?.length || 0,
          generatedAt: kSnap?.data?.generated_at,
        });
        setData(rankings);
        setPpProjections(ppProj);
        setPrizepicksData(ppSnap?.data || null);
        setMatchupData(matchupSnap?.data || null);
        setLastUpdated(
          ppSnap?.updatedAt
          || matchupSnap?.updatedAt
          || kSnap?.updatedAt
          || rankingsSnap?.updatedAt
          || kSnap?.data?.generated_at
          || rankingsSnap?.data?.generated_at
          || new Date().toISOString(),
        );
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
    loadRankings(false);
    const interval = setInterval(() => loadRankings(true), 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadRankings]);

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

  const rankings = data || [];
  const slateOppByTeam = useMemo(() => {
    const map = new Map();
    const games = matchupData?.matchups || [];
    for (const game of games) {
      const away = canonicalTeam(game?.away || '');
      const home = canonicalTeam(game?.home || '');
      if (!away || !home) continue;
      map.set(away, home);
      map.set(home, away);
    }
    return map;
  }, [matchupData]);

  const slatePairSet = useMemo(() => {
    const set = new Set();
    for (const [team, opp] of slateOppByTeam.entries()) {
      if (!team || !opp) continue;
      set.add(`${team}@@${opp}`);
    }
    return set;
  }, [slateOppByTeam]);

  const prizepicksIsFresh = useMemo(() => {
    const ppTs = parseIso(prizepicksData?.generated_at);
    if (!ppTs) return false;

    const matchupTs = parseIso(matchupData?.generated_at);
    const now = new Date();
    const ageHours = (now.getTime() - ppTs.getTime()) / (1000 * 60 * 60);
    if (ageHours > 18) return false;

    if (matchupTs) {
      const driftHours = Math.abs(ppTs.getTime() - matchupTs.getTime()) / (1000 * 60 * 60);
      if (driftHours > 8) return false;
    }
    return true;
  }, [prizepicksData, matchupData]);

  const rankingsWithSlateOpp = rankings.map((row) => ({
      ...row,
      team: canonicalTeam(row?.team || ''),
      opp_team: slateOppByTeam.get(canonicalTeam(row?.team || '')) || canonicalTeam(row?.opp_team || ''),
    }));

  const byNormTeam = new Map(rankingsWithSlateOpp.map((p) => [`${normalizeName(p.name)}@@${canonicalTeam(p.team)}`, p]));
  const bySigTeam = new Map(rankingsWithSlateOpp.map((p) => [`${nameSignature(p.name)}@@${canonicalTeam(p.team)}`, p]));
  const byNorm = new Map();
  const bySig = new Map();
  const normCounts = new Map();
  const sigCounts = new Map();

  for (const p of rankingsWithSlateOpp) {
    const norm = normalizeName(p?.name);
    const sig = nameSignature(p?.name);
    if (norm) {
      normCounts.set(norm, (normCounts.get(norm) || 0) + 1);
      if (!byNorm.has(norm)) byNorm.set(norm, p);
    }
    if (sig) {
      sigCounts.set(sig, (sigCounts.get(sig) || 0) + 1);
      if (!bySig.has(sig)) bySig.set(sig, p);
    }
  }
  const bestProjectionByKey = (() => {
    const map = new Map();
    for (const pp of ppProjections) {
      const team = canonicalTeam(pp?.team || '');
      const key = `${normalizeName(pp?.name)}@@${team}`;
      const score =
        (String(pp?.prop_key || '').toLowerCase() === 'strikeouts' ? 4 : 0)
        + (pp?.so_per_ip != null ? 2 : 0)
        + (pp?.ip_per_g != null ? 1 : 0);
      const existing = map.get(key);
      if (!existing || score > existing.score) {
        map.set(key, { score, row: pp });
      }
    }
    return map;
  })();

  const ppRows = (() => {
    const hasLivePitcherLine = (card) => (card?.props || []).some((prop) => Number.isFinite(Number(prop?.line)));
    const livePitcherCards = (prizepicksData?.cards || []).filter((card) => {
      if (card?.type !== 'pitcher' || !hasLivePitcherLine(card)) return false;
      const team = canonicalTeam(card?.team || '');
      const opponent = canonicalTeam(card?.opponent || '');
      if (!team || !opponent) return false;
      return slatePairSet.has(`${team}@@${opponent}`);
    });
    const useLiveCards = prizepicksIsFresh && livePitcherCards.length > 0;
    const sourceRows = useLiveCards
      ? livePitcherCards.map((card) => ({
        name: card?.name,
        team: canonicalTeam(card?.team || ''),
        opponent: canonicalTeam(card?.opponent || ''),
      }))
      : ppProjections
          .filter((p) => slateOppByTeam.has(canonicalTeam(p?.team || '')))
          .map((p) => ({
            name: p?.name,
            team: canonicalTeam(p?.team || ''),
            opponent: canonicalTeam(p?.opponent || ''),
          }));

    const out = [];
    const seen = new Set();
    for (const src of sourceRows) {
      const name = src?.name || '';
      const team = canonicalTeam(src?.team || '');
      if (!name || !team) continue;

      const norm = normalizeName(name);
      const sig = nameSignature(name);
      const ppStat = bestProjectionByKey.get(`${norm}@@${team}`)?.row || null;
      const match =
        byNormTeam.get(`${norm}@@${team}`)
        || bySigTeam.get(`${sig}@@${team}`);
      const uniqueNameFallback =
        (normCounts.get(norm) === 1 ? byNorm.get(norm) : null)
        || (sigCounts.get(sig) === 1 ? bySig.get(sig) : null);
      const statsSource = match || uniqueNameFallback;
      const projectedSoPerG = (ppStat?.so_per_ip != null && ppStat?.ip_per_g != null)
        ? Number((ppStat.so_per_ip * ppStat.ip_per_g).toFixed(1))
        : null;

      const base = statsSource || {
        name,
        team,
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

      const oppFromSlate = slateOppByTeam.get(team);
      const opp = oppFromSlate || src?.opponent || base?.opp_team || null;

      const row = {
        ...base,
        name,
        team,
        opp_team: canonicalTeam(opp),
        gs: base.gs ?? ppStat?.games_used ?? null,
        whip: base.whip ?? ppStat?.whip ?? null,
        ip_per_g: base.ip_per_g ?? ppStat?.ip_per_g ?? null,
        so_per_g: base.so_per_g ?? projectedSoPerG,
      };

      const key = `${normalizeName(row.name)}@@${canonicalTeam(row.team || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  })();

  const visibleRows = ppOnly ? ppRows : rankingsWithSlateOpp;

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

  if (loading) {
    return <div className="rk-container"><div className="rk-loading"><div className="rk-spinner" /><p>Loading rankings...</p></div></div>;
  }
  if (error) {
    return <div className="rk-container"><div className="rk-loading"><p className="rk-error">Error: {error}</p></div></div>;
  }

  return (
    <div className="rk-container">
      <header className="rk-header">
        <h1 className="rk-title">KBO Pitcher Rankings</h1>
        {lastUpdated ? <p className="rk-updated">Updated {new Date(lastUpdated).toLocaleString()}</p> : null}
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
                <th onClick={() => handleSort('opp_team')}>Opp {sortIcon('opp_team')}</th>
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
                  <td><span className="team-text" style={{ color: TEAMS[p.opp_team] || '#999' }}>{p.opp_team ?? '—'}</span></td>
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
