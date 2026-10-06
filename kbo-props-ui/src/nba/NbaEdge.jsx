import { useEffect, useMemo, useState } from 'react'
import { fetchNbaData } from './nbaData'

const LINE_TYPES = ['standard', 'demon', 'goblin']
const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']
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
]

function pendingText() {
  return 'pending'
}

export default function NbaEdge() {
  const [lineType, setLineType] = useState('standard')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [propType, setPropType] = useState('All')
  const [viewMode, setViewMode] = useState('cards')
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('All')
  const [matchupFilter, setMatchupFilter] = useState('All')
  const [minMinutes, setMinMinutes] = useState(0)
  const [hitRateSort, setHitRateSort] = useState('score')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const json = await fetchNbaData(`nba/projections_${lineType}.json`)
        if (cancelled) return
        setData(Array.isArray(json) ? json : [])
      } catch (err) {
        if (!cancelled) {
          setData(null)
          setError(err.message)
        }
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
    data.forEach((player) => {
      (player.ppAllProps || []).forEach((prop) => {
        if (prop?.stat) set.add(prop.stat)
      })
    })
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [data])

  const activeSlateDate = useMemo(() => {
    if (!data) return null
    const dates = [...new Set(
      data.flatMap((player) => (player.ppAllProps || []).map((prop) => prop?.gameDate).filter(Boolean)),
    )].sort()
    return dates[0] || null
  }, [data])

  const matchups = useMemo(() => {
    if (!data) return []
    const seen = new Map()
    data.forEach((player) => {
      const teamA = (player.team || '').toUpperCase()
      if (!teamA) return
      ;(player.ppAllProps || []).forEach((prop) => {
        const teamB = (prop.opponent || '').toUpperCase()
        if (!teamB) return
        const [t1, t2] = [teamA, teamB].sort()
        const key = `${t1}_${t2}`
        if (seen.has(key)) return
        const gameDate = prop.gameDate || ''
        let dateLabel = ''
        if (gameDate) {
          dateLabel = gameDate === activeSlateDate
            ? 'Todays slate'
            : new Date(`${gameDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        }
        seen.set(key, { label: `${t1} vs ${t2}`, dateLabel, dateStr: gameDate || '9999' })
      })
    })
    return [...seen.values()].sort((a, b) => {
      if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr)
      return a.label.localeCompare(b.label)
    })
  }, [data, activeSlateDate])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.filter((player) => {
      const nameMatch = !search || player.name.toLowerCase().includes(search.toLowerCase())
      const posMatch = posFilter === 'All' || player.position === posFilter
      const minutesKnown = player.avgMins != null
      const minMinutesMatch = minMinutes === 0 || (minutesKnown && player.avgMins >= minMinutes)
      const propMatch = propType === 'All'
        ? (player.ppAllProps || []).length > 0
        : (player.ppAllProps || []).some((prop) => prop?.stat === propType)
      let matchupMatch = true
      if (matchupFilter !== 'All') {
        const [t1, t2] = matchupFilter.split(' vs ')
        const teamUp = (player.team || '').toUpperCase()
        matchupMatch = teamUp === t1 || teamUp === t2
      }
      return nameMatch && posMatch && minMinutesMatch && propMatch && matchupMatch
    })
  }, [data, search, posFilter, matchupFilter, minMinutes, propType])

  const cards = useMemo(() => {
    const rows = []
    filtered.forEach((player) => {
      const props = propType === 'All'
        ? (player.ppAllProps || [])
        : (player.ppAllProps || []).filter((prop) => prop.stat === propType)
      props.forEach((prop) => {
        rows.push({
          key: `${player.athleteId || player.name}-${prop.stat}-${prop.line}`,
          player,
          stat: prop.stat,
          line: prop.line,
          versus: prop.versus || '',
          opponent: prop.opponent || '',
          gameDate: prop.gameDate || '',
        })
      })
    })
    rows.sort((a, b) => a.player.name.localeCompare(b.player.name) || a.stat.localeCompare(b.stat))
    return rows
  }, [filtered, propType])

  return (
    <div className="fade-in edge-board-wrap">
      <div className="edge-board-bg" />
      <div style={{ marginBottom: 18, position: 'relative' }}>
        <h1 className="edge-title">NBA PrizePicks Edge</h1>
        <p style={{ margin: '6px 0 0', color: '#8b94a9', fontSize: 12 }}>
          Live PrizePicks lines{activeSlateDate ? ` for ${activeSlateDate}` : ''}. Projections and edge are pending.
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
            aria-label="Search player"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select className="edge-select" aria-label="Prop type" value={propType} onChange={(event) => setPropType(event.target.value)}>
          {propTypes.map((prop) => (
            <option key={prop} value={prop}>{prop === 'All' ? 'All props' : prop}</option>
          ))}
        </select>

        <select className="edge-select" aria-label="Sort" value={hitRateSort} onChange={(event) => setHitRateSort(event.target.value)}>
          {HIT_RATE_SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
        </select>

        <select className="edge-select" aria-label="Position" value={posFilter} onChange={(event) => setPosFilter(event.target.value)}>
          {POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
        </select>

        <select className="edge-select" aria-label="Matchup" value={matchupFilter} onChange={(event) => setMatchupFilter(event.target.value)}>
          <option value="All">All Matchups</option>
          {matchups.map((matchup) => (
            <option key={matchup.label} value={matchup.label}>
              {matchup.dateLabel ? `${matchup.dateLabel} · ${matchup.label}` : matchup.label}
            </option>
          ))}
        </select>

        <select className="edge-select" aria-label="Odds type" value={lineType} onChange={(event) => setLineType(event.target.value)}>
          {LINE_TYPES.map((type) => (
            <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)} Lines</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MINUTE_TABS.map((tab) => (
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
          <button className={`btn-ghost${viewMode === 'cards' ? ' active' : ''}`} onClick={() => setViewMode('cards')}>
            Edge Board
          </button>
          <button className={`btn-ghost${viewMode === 'table' ? ' active' : ''}`} onClick={() => setViewMode('table')}>
            Table
          </button>
        </div>

        <span style={{ marginLeft: 'auto', color: '#7efc6a', fontSize: 12, fontWeight: 700 }}>
          {viewMode === 'cards' ? `${cards.length} props` : `${filtered.length} players`}
        </span>
      </div>

      {error && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444', background: '#1a0a0a', borderRadius: 12, border: '1px solid #3f1a1a' }}>
          NBA lines snapshot unavailable. Run <code style={{ color: '#f97316' }}>python nba/nba-pp-odds.py</code> to write the board.
        </div>
      )}

      {viewMode === 'table' ? (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Pos</th>
                <th>Prop</th>
                <th>Line</th>
                <th>Matchup</th>
                <th>Projection</th>
                <th>Edge</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.key}>
                  <td>{card.player.name}</td>
                  <td>{card.player.team}</td>
                  <td>{card.player.position || '—'}</td>
                  <td>{card.stat}</td>
                  <td>{card.line}</td>
                  <td>{card.opponent ? `vs ${card.opponent}` : (card.versus || '—')}</td>
                  <td className="nba-edge-pending">{pendingText()}</td>
                  <td className="nba-edge-pending">{pendingText()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && cards.length === 0 && (
            <p style={{ padding: 24, textAlign: 'center', color: '#8b94a9' }}>No props available for the current filters.</p>
          )}
        </div>
      ) : (
        <div className="edge-grid">
          {loading && Array.from({ length: 6 }).map((_, index) => (
            <div key={`skeleton-${index}`} className="edge-card nba-edge-card" style={{ minHeight: 180, opacity: 0.55 }} />
          ))}
          {!loading && cards.map((card) => {
            const matchupTag = card.opponent ? `vs ${card.opponent}` : (card.versus || 'vs —')
            const initials = card.player.name?.split(' ').map((word) => word[0]).join('').slice(0, 2) || '?'
            return (
              <article key={card.key} className="edge-card nba-edge-card">
                <div className="edge-chip-row">
                  <span className="edge-chip">{card.player.avgMins == null ? 'min pending' : `${Number(card.player.avgMins).toFixed(1)} min`}</span>
                  <span className="edge-chip">{card.gameDate || 'slate'}</span>
                </div>
                <div className="edge-player">
                  {card.player.image ? (
                    <img src={card.player.image} alt="" className="edge-headshot" loading="lazy" />
                  ) : (
                    <div className="edge-headshot" style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
                      background: '#12231f', border: '1px solid #1f3f3d', color: '#7efc6a', fontSize: 18, fontWeight: 800,
                    }}
                    >
                      {initials}
                    </div>
                  )}
                  <div>
                    <p className="edge-name">{card.player.name}</p>
                    <div className="edge-tags">
                      <span className="edge-team-tag" style={{ background: card.player.teamColor || '#1f2937' }}>{card.player.team}</span>
                      <span className="edge-vs-tag" title={card.versus || matchupTag}>{matchupTag}</span>
                      {card.player.position ? <span className="edge-vs-tag">{card.player.position}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="edge-prop-pill">{card.stat}</div>
                <div className="edge-stats-row">
                  <div>
                    <p className="edge-stat-label">Line</p>
                    <p className="edge-stat-value">{card.line}</p>
                  </div>
                  <div>
                    <p className="edge-stat-label">Projection</p>
                    <p className="edge-stat-value nba-edge-pending">{pendingText()}</p>
                  </div>
                  <div>
                    <p className="edge-stat-label">Edge</p>
                    <p className="edge-stat-value nba-edge-pending">{pendingText()}</p>
                  </div>
                </div>
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
    </div>
  )
}
