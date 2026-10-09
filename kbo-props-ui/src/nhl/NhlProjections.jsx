import { useEffect, useMemo, useState } from 'react'
import { fetchNhlProjections } from './nhlData'
import { sortBoard } from './NhlPropLines'

const TABS = ['ALL', 'Shots On Goal', 'Goalie Saves', 'Points', 'Power Play Points']

function formatValue(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function Card({ item, onSelectPlayer }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const dates = Array.isArray(item.gameDates) ? item.gameDates : []
  const seasons = Array.isArray(item.chartSeasons) ? item.chartSeasons : []
  const score = item.line ? (item.projection / item.line) * 50 : 0
  const isOver = item.projection >= item.line
  const maxValue = Math.max(item.line, ...recent, 1)
  return (
    <article className="nfl-edge-card">
      <div className="nfl-card-topline">
        <span>{item.goalieStatus === 'probable' ? <b className="nhl-probable">PROBABLE</b> : item.oddsType !== 'standard' ? item.oddsType.toUpperCase() : 'FULL GAME'}</span>
        <b className={isOver ? 'over' : 'under'}>{isOver ? 'OVER' : 'UNDER'} {score.toFixed(1)}</b>
      </div>
      <div className="nfl-card-player">
        <div className="nfl-card-avatar">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : initials(item.player)}</div>
        <div>
          <h2 className="nfl-player-link" onClick={() => onSelectPlayer(item)}>{item.player}</h2>
          <p><b>{item.position}</b><span>{item.team}</span><em>vs {item.opponent}</em></p>
        </div>
      </div>
      <div className="nfl-card-prop">{item.prop}</div>
      <div className="nfl-card-metrics">
        <div><small>LINE</small><strong>{formatValue(item.line)}</strong></div>
        <div><small>MODEL</small><strong>{formatValue(item.projection)}</strong></div>
        <div><small>SCORE</small><strong className={isOver ? 'over' : 'under'}>{score.toFixed(1)}</strong></div>
        <div><small>DVP</small><strong>{item.dvpRank || '—'}<i> /32</i></strong></div>
      </div>
      <div className="nfl-card-meta">
        <div><small>2026-27</small><strong>{item.seasonHitRate == null ? '—' : `${item.seasonHitRate}%`}</strong></div>
        <div><small>L10</small><strong>{item.hitRate == null ? '—' : `${item.hitRate}%`}</strong></div>
        <div><small>H2H</small><strong>{item.h2hHitRate == null ? '—' : `${item.h2hHitRate}%`}</strong></div>
      </div>
      <div className="nfl-history-label">
        <span>LAST {recent.length}{item.chartIncludesPriorSeason ? ' · INCLUDES 2025-26' : ''}</span>
        <span>{item.hitRate == null ? '' : `${item.hitRate}% OVER`}</span>
      </div>
      <div className="nfl-history-bars">
        {recent.map((value, index) => (
          <span className={value > item.line ? 'hit' : 'miss'} style={{ height: `${Math.max(12, (value / maxValue) * 52)}px` }} key={`${item.id}-${index}`}>
            <i>{formatValue(value)} · {dates[index] || ''} {seasons[index] === '2025-26' ? 'last season' : ''}</i>
          </span>
        ))}
      </div>
    </article>
  )
}

export default function NhlProjections({ onSelectPlayer }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState('ALL')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    fetchNhlProjections()
      .then(({ projections: next }) => { if (active) { setProjections(next); setLoaded(true) } })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = projections.filter((item) => (tab === 'ALL' || item.prop === tab) && (!needle || item.player.toLowerCase().includes(needle) || item.team.toLowerCase().includes(needle)))
    return sortBoard(filtered, 'CG Score')
  }, [projections, tab, query])

  return (
    <section>
      <div className="nfl-board-header">
        <div><p>NHL / PRIZEPICKS</p><h1>Board</h1></div>
      </div>
      <p className="nhl-note">One card per player and prop. Standard lines are preferred. A demon or goblin is shown only when that is the line PrizePicks posted. Probable goalies are tagged and sorted to the bottom.</p>
      <div className="nfl-edge-controls">
        <label><span>PLAYER</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></label>
        <div className="nfl-position-tabs">
          {TABS.map((name) => <button key={name} className={name === tab ? 'active' : ''} onClick={() => setTab(name)}>{name === 'ALL' ? 'ALL' : name.split(' ')[0]}</button>)}
        </div>
      </div>
      {error && <div className="nfl-notice">Unable to load the board: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading the PrizePicks board.</div>}
      {!error && loaded && !rows.length && <div className="nfl-notice">No cards match.</div>}
      <div className="nfl-edge-grid">
        {rows.map((item) => <Card key={item.id || `${item.player}-${item.prop}`} item={item} onSelectPlayer={onSelectPlayer} />)}
      </div>
    </section>
  )
}
