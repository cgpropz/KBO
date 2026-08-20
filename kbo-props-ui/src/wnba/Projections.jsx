import { useState, useMemo, useEffect } from 'react'
import { fetchWnbaData } from './wnbaData'
import ProjectionTable from './components/ProjectionTable'
import L10HitRateChart from './components/L10HitRateChart'

const POSITIONS = ['All', 'Guard', 'Forward', 'Center']
const LINE_TYPES = ['standard', 'demon', 'goblin']
const MINUTE_TABS = [
  { label: 'All Min', min: 0 },
  { label: '20+ Min', min: 20 },
  { label: '25+ Min', min: 25 },
  { label: '30+ Min', min: 30 },
  { label: '35+ Min', min: 35 },
]
const HIT_RATE_SORTS = [
  { value: 'score', label: 'Sort: Best Score' },
  { value: 'L5', label: 'Sort: L5 Hit Rate' },
  { value: 'L10', label: 'Sort: L10 Hit Rate' },
  { value: 'L15', label: 'Sort: L15 Hit Rate' },
  { value: 'FULL', label: 'Sort: Full Hit Rate' },
  { value: 'sharpOdds', label: 'Sort: Sharp Odds (- to +)' },
]
const EXCLUDED_PROP_LABELS = new Set(['Points - 1st 3 Minutes'])

const PROP_PROJECTION = {
  Points: p => p.projPts,
  Rebounds: p => p.projReb,
  Assists: p => p.projAst,
  '3-PT Made': p => p.projFg3m,
  Steals: p => p.projStl,
  Blocks: p => p.projBlk,
  Turnovers: p => p.projTov,
  'Offensive Rebounds': p => p.projOreb,
  'Defensive Rebounds': p => p.projDreb,
  'Fantasy Score': p => p.projFantasy,
  'Reb+Asts': p => (p.projReb ?? 0) + (p.projAst ?? 0),
  'Rebs+Asts': p => (p.projReb ?? 0) + (p.projAst ?? 0),
  'Pts+Rebs': p => (p.projPts ?? 0) + (p.projReb ?? 0),
  'Pts+Asts': p => (p.projPts ?? 0) + (p.projAst ?? 0),
  'Pts+Rebs+Asts': p => (p.projPts ?? 0) + (p.projReb ?? 0) + (p.projAst ?? 0),
  'Double-Double': p => p.projDoubleDouble,
  'Triple-Double': p => p.projTripleDouble,
}

const PROP_GAME_VALUE = {
  Points: game => game.pts ?? 0,
  Rebounds: game => game.reb ?? 0,
  Assists: game => game.ast ?? 0,
  'FG Made': game => game.fgm ?? 0,
  'FG Attempted': game => game.fga ?? 0,
  'Two Pointers Made': game => game.fg2m ?? Math.max((game.fgm ?? 0) - (game.fg3m ?? 0), 0),
  'Two Pointers Attempted': game => game.fg2a ?? Math.max((game.fga ?? 0) - (game.fg3a ?? 0), 0),
  '3-PT Made': game => game.fg3m ?? 0,
  '3-PT Attempted': game => game.fg3a ?? 0,
  'Free Throws Made': game => game.ftm ?? 0,
  'Free Throws Attempted': game => game.fta ?? 0,
  Steals: game => game.stl ?? 0,
  Blocks: game => game.blk ?? 0,
  'Blocked Shots': game => game.blk ?? 0,
  'Blks+Stls': game => (game.blk ?? 0) + (game.stl ?? 0),
  Turnovers: game => game.tov ?? 0,
  'Offensive Rebounds': game => game.oreb ?? 0,
  'Defensive Rebounds': game => game.dreb ?? 0,
  'Fantasy Score': game => game.fantasy ?? 0,
  'Reb+Asts': game => (game.reb ?? 0) + (game.ast ?? 0),
  'Rebs+Asts': game => (game.reb ?? 0) + (game.ast ?? 0),
  'Pts+Rebs': game => (game.pts ?? 0) + (game.reb ?? 0),
  'Pts+Asts': game => (game.pts ?? 0) + (game.ast ?? 0),
  'Pts+Rebs+Asts': game => (game.pts ?? 0) + (game.reb ?? 0) + (game.ast ?? 0),
  'Double-Double': game => [game.pts, game.reb, game.ast, game.stl, game.blk].filter(value => (value ?? 0) >= 10).length >= 2 ? 1 : 0,
  'Triple-Double': game => [game.pts, game.reb, game.ast, game.stl, game.blk].filter(value => (value ?? 0) >= 10).length >= 3 ? 1 : 0,
}

function hitRateForWindow(games, stat, line, windowSize) {
  const numericLine = Number(line)
  const getValue = PROP_GAME_VALUE[stat]
  if (!getValue || !Number.isFinite(numericLine)) return null

  const eligibleGames = games
    .slice(0, windowSize ?? games.length)
    .map(game => getValue(game))
    .filter(value => value != null)

  if (!eligibleGames.length) return null
  return Math.round((eligibleGames.filter(value => value > numericLine).length / eligibleGames.length) * 100)
}

function fmtScore(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(1)
}

function spreadColor(spread) {
  if (spread == null || Number.isNaN(spread)) return '#4b5563'
  // |3|=green, |5|=neutral, |7|=red — based on absolute value
  const abs = Math.abs(spread)
  const to3 = [34, 197, 94], mid5 = [229, 229, 229], from7 = [239, 68, 68]
  const lerp = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)))
  const [f, t_, pct] = abs <= 5 ? [to3, mid5, (abs - 3) / 2] : [mid5, from7, (abs - 5) / 2]
  return `rgb(${lerp(f[0], t_[0], pct)},${lerp(f[1], t_[1], pct)},${lerp(f[2], t_[2], pct)})`
}

function fmtSpread(spread) {
  if (spread == null || Number.isNaN(spread)) return 'Spread —'
  return `Spread ${spread > 0 ? '+' : ''}${spread.toFixed(1)}`
}

function fmtDvpFactor(value) {
  if (value == null || Number.isNaN(value)) return '1.00x'
  return `${value.toFixed(2)}x`
}

function fmtAmericanOdds(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const numeric = Number(value)
  return numeric > 0 ? `+${numeric}` : `${numeric}`
}

export default function Projections({ onSelectPlayer }) {
  const [lineType, setLineType] = useState('standard')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [propType, setPropType] = useState('All')
  const [viewMode, setViewMode] = useState('cards')
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('All')
  const [matchupFilter, setMatchupFilter] = useState('All')
  const [minMinutes, setMinMinutes] = useState(30)
  const [hitRateSort, setHitRateSort] = useState('score')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const json = await fetchWnbaData(`wnba/projections_${lineType}.json`)
        if (cancelled) return
        setData(Array.isArray(json) ? json : [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [lineType])

  const propTypes = useMemo(() => {
    if (!data) return ['All']
    const set = new Set()
    data.forEach(player => {
      (player.ppAllProps || []).forEach(prop => {
        if (prop?.stat && !EXCLUDED_PROP_LABELS.has(prop.stat)) set.add(prop.stat)
      })
    })
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [data])

  const activeSlateDate = useMemo(() => {
    if (!data) return null
    const dates = [...new Set(
      data.flatMap(player => (player.ppAllProps || [])
        .map(prop => prop?.gameDate)
        .filter(Boolean))
    )].sort()
    return dates[0] || null
  }, [data])

  // Build sorted matchup options grouped by the active slate date
  const matchups = useMemo(() => {
    if (!data) return []

    const seen = new Map() // canonicalKey -> { label, dateLabel, dateStr }
    data.forEach(player => {
      const teamA = (player.team || '').toUpperCase()
      if (!teamA) return
      ;(player.ppAllProps || []).forEach(prop => {
        const teamB = (prop.opponent || '').toUpperCase()
        if (!teamB) return
        // Canonical pair — sort so LVA+LAS and LAS+LVA map to the same key
        const [t1, t2] = [teamA, teamB].sort()
        const key = `${t1}_${t2}`
        if (seen.has(key)) return
        // Date label
        const gd = prop.gameDate || ''
        let dateLabel = ''
        if (gd) {
          const isActiveSlate = gd === activeSlateDate
          if (isActiveSlate) dateLabel = 'Todays slate'
          else {
            const d = new Date(gd + 'T00:00:00Z')
            d.setMinutes(d.getMinutes() + d.getTimezoneOffset())
            dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }
        }
        seen.set(key, { label: `${t1} vs ${t2}`, dateLabel, dateStr: gd || '9999' })
      })
    })
    // Sort: active slate first, then by date string, then alphabetical
    const order = { 'Todays slate': 0 }
    return [...seen.values()].sort((a, b) => {
      const oa = order[a.dateLabel] ?? 2
      const ob = order[b.dateLabel] ?? 2
      if (oa !== ob) return oa - ob
      if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr)
      return a.label.localeCompare(b.label)
    })
  }, [data, activeSlateDate])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.filter(p => {
      const nameMatch = !search || p.name.toLowerCase().includes(search.toLowerCase())
      const posMatch = posFilter === 'All' || p.position === posFilter
      const minMinutesMatch = (p.avgMins ?? 0) >= minMinutes
      const propMatch = propType === 'All'
        ? true
        : (p.ppAllProps || []).some(prop => prop?.stat === propType && !EXCLUDED_PROP_LABELS.has(prop.stat))
      // Matchup filter: include player if their team is one of the two in the selected matchup
      let matchupMatch = true
      if (matchupFilter !== 'All') {
        const [t1, t2] = matchupFilter.split(' vs ')
        const teamUp = (p.team || '').toUpperCase()
        matchupMatch = teamUp === t1 || teamUp === t2
      }
      return nameMatch && posMatch && minMinutesMatch && propMatch && matchupMatch
    })
  }, [data, search, posFilter, matchupFilter, minMinutes, propType])

  const cards = useMemo(() => {
    const rows = []
    filtered.forEach(player => {
      const props = propType === 'All'
        ? (player.ppAllProps || []).filter(prop => !EXCLUDED_PROP_LABELS.has(prop?.stat))
        : (player.ppAllProps || []).filter(prop => prop.stat === propType && !EXCLUDED_PROP_LABELS.has(prop?.stat))

      props.forEach(prop => {
        const line = Number(prop.line)
        const projectionFn = PROP_PROJECTION[prop.stat]
        const projection = prop.projection ?? (projectionFn ? projectionFn(player) : null)
        const score = projection != null && Number.isFinite(line) && line > 0
          ? (projection / line) * 50
          : null
        const hitRateLine = prop.standardLine ?? line
        rows.push({
          key: `${player.name}-${prop.stat}`,
          player,
          stat: prop.stat,
          line,
          standardLine: prop.standardLine ?? null,
          versus: prop.versus ?? null,
          opponent: prop.opponent ?? null,
          gameDate: prop.gameDate ?? null,
          projection,
          score,
          hitRates: {
            L5: hitRateForWindow(player.recentGames || [], prop.stat, hitRateLine, 5),
            L10: hitRateForWindow(player.recentGames || [], prop.stat, hitRateLine, 10),
            L15: hitRateForWindow(player.recentGames || [], prop.stat, hitRateLine, 15),
            FULL: hitRateForWindow(player.recentGames || [], prop.stat, hitRateLine, null),
          },
          dvpFactor: prop.effectiveDvpFactor ?? player.dvpFactor ?? 1,
          spread: player.spread ?? null,
          sharpOdds: prop.sharpOdds ?? null,
          sharpSide: prop.sharpSide ?? null,
          recentGames: player.recentGames || [],
        })
      })
    })

    rows.sort((a, b) => {
      if (hitRateSort === 'sharpOdds') {
        const aOdds = Number(a.sharpOdds)
        const bOdds = Number(b.sharpOdds)
        const aHasOdds = Number.isFinite(aOdds)
        const bHasOdds = Number.isFinite(bOdds)
        if (aHasOdds && bHasOdds && aOdds !== bOdds) return aOdds - bOdds
        if (aHasOdds !== bHasOdds) return aHasOdds ? -1 : 1
      } else if (hitRateSort !== 'score') {
        const hitRateDifference = (b.hitRates[hitRateSort] ?? -1) - (a.hitRates[hitRateSort] ?? -1)
        if (hitRateDifference !== 0) return hitRateDifference
      }
      const as = a.score ?? -Infinity
      const bs = b.score ?? -Infinity
      return bs - as
    })

    return rows
  }, [filtered, propType, hitRateSort])

  return (
    <div className="fade-in edge-board-wrap">
      <div className="edge-board-bg" />

      <div style={{ marginBottom: 18, position: 'relative' }}>
        <h1 className="edge-title">WNBA PrizePicks Edge</h1>
        <p style={{ margin: '6px 0 0', color: '#8b94a9', fontSize: 12 }}>
          Formula: L3 x 0.5 + L7 x 0.3 + L15 x 0.2, then multiplied by expected minutes and DVP
        </p>
      </div>

      <div className="edge-controls" style={{ marginBottom: 18 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', minWidth: 220 }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="search-input edge-search"
            style={{ paddingLeft: 32 }}
            placeholder="Search player..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select className="edge-select" value={propType} onChange={e => setPropType(e.target.value)}>
          {propTypes.map(prop => (
            <option key={prop} value={prop}>{prop === 'All' ? 'Best Score' : prop}</option>
          ))}
        </select>

        <select className="edge-select" value={hitRateSort} onChange={e => setHitRateSort(e.target.value)}>
          {HIT_RATE_SORTS.map(sort => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
        </select>

        <select className="edge-select" value={posFilter} onChange={e => setPosFilter(e.target.value)}>
          {POSITIONS.map(pos => <option key={pos} value={pos}>{pos}</option>)}
        </select>

        <select className="edge-select" value={matchupFilter} onChange={e => setMatchupFilter(e.target.value)}>
          <option value="All">All Matchups</option>
          {matchups.map(m => (
            <option key={m.label} value={m.label}>
              {m.dateLabel ? `${m.dateLabel} · ${m.label}` : m.label}
            </option>
          ))}
        </select>

        <select className="edge-select" value={lineType} onChange={e => setLineType(e.target.value)}>
          {LINE_TYPES.map(type => (
            <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)} Lines</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 6 }}>
          {MINUTE_TABS.map(tab => (
            <button
              key={tab.min}
              className={`btn-ghost${minMinutes === tab.min ? ' active' : ''}`}
              onClick={() => setMinMinutes(tab.min)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`btn-ghost${viewMode === 'cards' ? ' active' : ''}`}
            onClick={() => setViewMode('cards')}
          >
            Edge Board
          </button>
          <button
            className={`btn-ghost${viewMode === 'table' ? ' active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            Table
          </button>
        </div>

        <span style={{ marginLeft: 'auto', color: '#7efc6a', fontSize: 12, fontWeight: 700 }}>
          {viewMode === 'cards' ? `${cards.length} props` : `${filtered.length} players`}
        </span>
      </div>

      {error && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444', background: '#1a0a0a', borderRadius: 12, border: '1px solid #3f1a1a' }}>
          WNBA projections snapshot unavailable. Run the WNBA refresh to publish <code style={{ color: '#f97316' }}>wnba/projections_{lineType}.json</code>.
        </div>
      )}

      {viewMode === 'table' ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          <ProjectionTable data={filtered} loading={loading} selectedPropType={propType} onSelectPlayer={onSelectPlayer} />
        </div>
      ) : (
        <div className="edge-grid">
          {loading && Array.from({ length: 12 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="edge-card" style={{ minHeight: 222, opacity: 0.55 }} />
          ))}

          {!loading && cards.map(card => {
            const { player, line, standardLine, projection, stat, score, dvpFactor, spread, opponent, versus, recentGames, sharpOdds, sharpSide } = card
            const matchupTag = opponent ? `vs ${opponent}` : (versus || 'vs —')
            return (
              <article
                key={card.key}
                className="edge-card"
                onClick={() => onSelectPlayer?.(player.name)}
              >
                <div className="edge-chip-row">
                  <span className="edge-chip">{(player.avgMins ?? 0).toFixed(1)} min</span>
                  <span className="edge-chip" style={{ color: spreadColor(spread) }}>{fmtSpread(spread)}</span>
                </div>

                <div className="edge-player">
                  {player.image ? (
                    <img src={player.image} alt={player.name} className="edge-headshot" loading="lazy" />
                  ) : (
                    <div className="edge-headshot" style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      background: '#12231f',
                      border: '1px solid #1f3f3d',
                      color: '#7efc6a',
                      fontSize: 22,
                      fontWeight: 800,
                    }}>
                      {player.name?.split(' ').map(w => w[0]).join('').slice(0, 2) || '?'}
                    </div>
                  )}
                  <div>
                    <p className="edge-name">{player.name}</p>
                    <div className="edge-tags">
                      <span className="edge-team-tag">{player.team}</span>
                      <span className="edge-vs-tag" title={versus || matchupTag}>{matchupTag}</span>
                    </div>
                  </div>
                </div>

                <div className="edge-prop-pill">{stat}</div>

                <div className="edge-stats-row">
                  <div>
                    <p className="edge-stat-label">Line</p>
                    <p className="edge-stat-value">{line}</p>
                  </div>
                  <div>
                    <p className="edge-stat-label">Projection</p>
                    <p className="edge-stat-value">{projection != null ? projection.toFixed(1) : '—'}</p>
                  </div>
                  <div>
                    <p className="edge-stat-label">Score</p>
                    <p className="edge-stat-value edge-score">{fmtScore(score)}</p>
                  </div>
                  <div>
                    <p className="edge-stat-label">{String(player.position || 'DVP').charAt(0).toUpperCase()} DVP</p>
                    <p className="edge-stat-value">{fmtDvpFactor(dvpFactor)}</p>
                  </div>
                  <div>
                    <p className="edge-stat-label">Sharp</p>
                    <p className={`edge-stat-value edge-score${sharpSide ? ` is-${sharpSide}` : ''}`}>{fmtAmericanOdds(sharpOdds)}</p>
                  </div>
                </div>

                <L10HitRateChart games={recentGames} stat={stat} line={standardLine ?? line} />
              </article>
            )
          })}

          {!loading && cards.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: '#8b94a9', gridColumn: '1 / -1' }}>
              No props available for the current filters.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {[
          { color: '#7efc6a', label: 'Score = (Projection / Line) × 50' },
          { color: '#38bdf8', label: `${lineType} PrizePicks feed active` },
          { color: '#facc15', label: 'DVP uses separate Guard, Forward, Center opponent files' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: color, boxShadow: `0 0 10px ${color}88` }} />
            <span style={{ fontSize: 11, color: '#8b94a9' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
