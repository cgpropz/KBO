import { useEffect, useMemo, useState } from 'react'
import { fetchNflProjections } from './nflData'
import { teamLogoUrl } from './nflTeams'

const PROP_PRIORITY = ['Pass Yards', 'Pass+Rush Yds', 'Pass Completions', 'Pass Attempts', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets', 'Touchdowns', 'Interceptions']

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function formatDelta(value) {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1))
  return `${rounded >= 0 ? '+' : ''}${rounded}`
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function TeamLogo({ team, className }) {
  const url = teamLogoUrl(team)
  return url ? <img className={className} src={url} alt={team} loading="lazy" /> : null
}

function sortProps(rows) {
  return [...rows].sort((a, b) => {
    const ai = PROP_PRIORITY.indexOf(a.prop)
    const bi = PROP_PRIORITY.indexOf(b.prop)
    if (ai === -1 && bi === -1) return a.prop.localeCompare(b.prop)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export default function NflPlayerPage({ player, prop, onBack }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [selectedProp, setSelectedProp] = useState(prop)

  useEffect(() => {
    let active = true
    fetchNflProjections().then(({ projections: next }) => active && setProjections(next)).catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const playerRows = useMemo(() => sortProps(projections
    .filter((item) => item.player === player)
    .map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0 }))), [projections, player])

  const currentRow = useMemo(() => playerRows.find((item) => item.prop === selectedProp) || playerRows[0], [playerRows, selectedProp])

  if (error) return <div className="nfl-notice">Unable to load player data: {error}</div>
  if (!playerRows.length) return <div className="nfl-notice">Loading player data for {player}.</div>

  const recent = Array.isArray(currentRow.recent) ? currentRow.recent : []
  const gameDates = Array.isArray(currentRow.gameDates) ? currentRow.gameDates : []
  const gameOpponents = Array.isArray(currentRow.gameOpponents) ? currentRow.gameOpponents : []
  const maxValue = Math.max(currentRow.line, ...recent, 1)
  const isOver = currentRow.projection >= currentRow.line
  const hits = Math.round((currentRow.hitRate / 100) * currentRow.gamesPlayed)
  const linePct = Math.min(100, (currentRow.line / maxValue) * 100)
  const modelDelta = currentRow.projection - currentRow.line

  return (
    <section className="nfl-player-page">
      <button className="nfl-player-back" onClick={onBack}>&larr; Back</button>
      <div className="nfl-player-header">
        <div className="nfl-player-avatar">
          {currentRow.imageUrl ? <img className="nfl-player-avatar-photo" src={currentRow.imageUrl} alt={player} loading="lazy" /> : initials(player)}
        </div>
        <div className="nfl-player-title"><h1>{player}<span>{currentRow.position}</span></h1><p>{currentRow.team} vs {currentRow.opponent}</p></div>
        <div className="nfl-player-prop-pill">
          <TeamLogo team={currentRow.opponent} className="nfl-player-prop-icon" />
          <span>{formatValue(currentRow.line)} {currentRow.prop}</span>
          <b className={isOver ? 'over' : 'under'}>{isOver ? 'OVER' : 'UNDER'} {currentRow.score.toFixed(1)}</b>
        </div>
      </div>

      <div className="nfl-player-tabs">
        {playerRows.map((row) => (
          <button key={row.prop} className={row.prop === currentRow.prop ? 'active' : ''} onClick={() => setSelectedProp(row.prop)}>{row.prop}</button>
        ))}
      </div>

      <div className="nfl-player-summary">
        <div className="nfl-player-hitrate"><small>HIT RATE</small><strong className={hits / currentRow.gamesPlayed >= 0.5 ? 'over' : 'under'}>{currentRow.hitRate}%</strong><span>({hits}/{currentRow.gamesPlayed})</span></div>
        <div><small>LINE</small><strong>{formatValue(currentRow.line)}</strong></div>
        <div><small>MODEL</small><strong>{formatValue(currentRow.projection)}</strong><span className={modelDelta >= 0 ? 'over' : 'under'}>{formatDelta(modelDelta)}</span></div>
        <div><small>SEASON AVG</small><strong>{formatValue(currentRow.seasonAverage)}</strong></div>
        <div><small>DVP RANK</small><strong className={currentRow.dvpRatio >= 1 ? 'over' : 'under'}>{currentRow.dvpRank}<i> /32</i></strong></div>
        <div><small>SNAPS</small><strong>{currentRow.snapCount > 0 ? `${currentRow.snapCount}%` : 'N/A'}</strong></div>
      </div>

      <div className="nfl-player-chart">
        <div className="nfl-player-chart-line" style={{ bottom: `${linePct}%` }}><span>{formatValue(currentRow.line)}</span></div>
        <div className="nfl-player-bars">
          {recent.map((value, index) => {
            const hit = value >= currentRow.line
            return (
              <div className="nfl-player-bar-col" key={`${currentRow.id}-${index}`}>
                <div className={`nfl-player-bar ${hit ? 'hit' : 'miss'}`} style={{ height: `${Math.max(4, (value / maxValue) * 100)}%` }}><i>{formatValue(value)}</i></div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="nfl-player-dates">
        {gameDates.map((date, index) => (
          <span key={`${currentRow.id}-date-${index}`}>
            <TeamLogo team={gameOpponents[index]} className="nfl-player-date-logo" />
            {date}
          </span>
        ))}
      </div>
    </section>
  )
}
