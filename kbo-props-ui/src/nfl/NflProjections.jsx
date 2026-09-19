import { useEffect, useMemo, useState } from 'react'
import { fetchNflProjections } from './nflData'

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE']

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function ProjectionCard({ item }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const gameDates = Array.isArray(item.gameDates) ? item.gameDates : []
  const maxValue = Math.max(item.line, ...recent, 1)
  const isOver = item.projection >= item.line

  return (
    <article className="nfl-edge-card">
      <div className="nfl-card-topline"><span>{item.snapCount > 0 ? `${item.snapCount}% SNAP` : `${item.gamesPlayed} GAMES`}</span><b className={isOver ? 'over' : 'under'}>{isOver ? 'OVER' : 'UNDER'} {item.score.toFixed(1)}</b></div>
      <div className="nfl-card-player">
        <div className="nfl-card-avatar">{item.imageUrl ? <img src={item.imageUrl} alt={item.player} loading="lazy" /> : initials(item.player)}</div>
        <div><h2>{item.player}</h2><p><b>{item.position}</b><span>{item.team}</span><em>vs {item.opponent}</em></p></div>
      </div>
      <div className="nfl-card-prop">{item.prop}</div>
      <div className="nfl-card-metrics"><div><small>LINE</small><strong>{formatValue(item.line)}</strong></div><div><small>MODEL</small><strong>{formatValue(item.projection)}</strong></div><div><small>SCORE</small><strong className={isOver ? 'over' : 'under'}>{item.score.toFixed(1)}</strong></div><div><small>DVP RANK</small><strong className={item.dvpRatio >= 1 ? 'over' : 'under'}>{item.dvpRank}<i> /32</i></strong></div></div>
      <div className="nfl-card-meta"><div><small>SEASON AVG</small><strong>{formatValue(item.seasonAverage)}</strong></div><div><small>HIT RATE</small><strong>{item.hitRate}%</strong></div><div><small>GAMES</small><strong>{item.gamesPlayed}</strong></div></div>
      <div className="nfl-history-label"><span>LAST {recent.length} GAMES</span><span>{item.hitRate}% OVER LINE</span></div>
      <div className="nfl-history-bars" aria-label={`Last ${recent.length} games for ${item.player}`}>
        {recent.map((value, index) => {
          const hit = value >= item.line
          const date = gameDates[index] || 'Game log'
          return <span className={hit ? 'hit' : 'miss'} style={{ height: `${Math.max(12, (value / maxValue) * 52)}px` }} key={`${item.id}-${index}`} tabIndex={0}><i>{formatValue(value)} · {date}</i></span>
        })}
      </div>
      <div className="nfl-history-dates">{gameDates.map((date, index) => <span key={`${item.id}-date-${index}`}>{date}</span>)}</div>
    </article>
  )
}

export default function NflProjections() {
  const [projections, setProjections] = useState([])
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('ALL')
  const [prop, setProp] = useState('All props')
  const [matchup, setMatchup] = useState('All matchups')
  const [sort, setSort] = useState('Best score')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetchNflProjections().then(({ projections: next }) => active && setProjections(next)).catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const matchupKey = (item) => [item.team, item.opponent].sort().join(' vs ')
  const props = useMemo(() => ['All props', ...new Set(projections.map((item) => item.prop))].sort((a, b) => a === 'All props' ? -1 : a.localeCompare(b)), [projections])
  const matchups = useMemo(() => ['All matchups', ...new Set(projections.map(matchupKey))].sort((a, b) => a === 'All matchups' ? -1 : a.localeCompare(b)), [projections])
  const rows = useMemo(() => projections
    .map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0 }))
    .filter((item) => position === 'ALL' || item.position === position)
    .filter((item) => prop === 'All props' || item.prop === prop)
    .filter((item) => matchup === 'All matchups' || matchupKey(item) === matchup)
    .filter((item) => item.player.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'Best score' ? b.score - a.score : b.hitRate - a.hitRate), [matchup, position, projections, prop, query, sort])

  return (
    <section className="nfl-edge-board">
      <div className="nfl-board-header"><div><p>NFL / PRIZEPICKS</p><h1>Edge Board</h1></div><span>{rows.length} edges</span></div>
      <section className="nfl-edge-controls" aria-label="NFL projection filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player..." />
        <label><span>SORT</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option>Best score</option><option>Best hit rate</option></select></label>
        <label><span>PROP</span><select value={prop} onChange={(event) => setProp(event.target.value)}>{props.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>MATCHUP</span><select value={matchup} onChange={(event) => setMatchup(event.target.value)}>{matchups.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="nfl-position-tabs">{POSITIONS.map((item) => <button key={item} className={position === item ? 'active' : ''} onClick={() => setPosition(item)}>{item}</button>)}</div>
      </section>
      <div className="nfl-board-meta"><span><i /> LIVE MODEL / DVP ADJUSTED</span><span>Projection = L3 50% + L9 25% + L15 25%</span><span><b>30</b> 50 <b>70</b> SCORE SCALE</span></div>
      {error && <div className="nfl-notice">Unable to load the NFL snapshot: {error}</div>}
      {!error && !rows.length && <div className="nfl-notice">Loading the current PrizePicks board.</div>}
      <div className="nfl-edge-grid">{rows.map((item) => <ProjectionCard key={item.id} item={item} />)}</div>
    </section>
  )
}